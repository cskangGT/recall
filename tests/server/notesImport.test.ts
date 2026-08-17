import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { stripSecrets } from '../../server/notes/appleNotes';

/**
 * The Notes button's server half. Reading Notes is injected (only a local Mac
 * can), so the route is tested with a fake reader — and the secret filter is
 * tested directly, because it is the part that must never regress.
 */

const WS = 'ws_demo';
let repo: SqliteRepository;
let deps: Deps;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  const provider = new FixtureProvider();
  const embeddings = new FixtureEmbeddings();
  deps = {
    repo,
    ingest: new IngestPipeline(repo, provider, embeddings),
    ask: new AskPipeline(repo, provider, embeddings),
    reset: () => {},
  };
});

afterEach(() => repo.close());

const post = (path: string, body: unknown = null) => handle({ method: 'POST', path, body }, deps);
const base = `/api/workspaces/${WS}`;

describe('POST import/apple-notes', () => {
  it('answers 501 where the capability does not exist — a hosted box', async () => {
    const res = await post(`${base}/import/apple-notes`, {});
    expect(res.status).toBe(501);
  });

  it('reads via the injected capability and runs the batch path', async () => {
    deps.readNotes = async () => ({
      notes: [
        { title: '회의 메모', content: '다음 분기 목표를 정리했다.', modified: new Date() },
      ],
      droppedSecretLines: 2,
      total: 5,
    });

    const res = await post(`${base}/import/apple-notes`, { days: 14, locale: 'ko' });
    expect(res.status).toBe(200);
    const body = res.body as {
      results: unknown[];
      notes: { total: number; imported: number; droppedSecretLines: number };
      graph: { sources: unknown[] };
    };
    expect(body.results).toHaveLength(1);
    expect(body.notes).toEqual({ total: 5, imported: 1, droppedSecretLines: 2 });
    expect(repo.listSources(WS).some((s) => s.title === '회의 메모')).toBe(true);
  });

  it('surfaces a reader failure as 502 with its own words', async () => {
    deps.readNotes = async () => {
      throw new Error('macOS declined access to Notes — allow it under System Settings');
    };
    const res = await post(`${base}/import/apple-notes`, {});
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toContain('macOS declined');
  });

  it('imports nothing gracefully when the window is empty', async () => {
    deps.readNotes = async () => ({ notes: [], droppedSecretLines: 0, total: 3 });
    const res = await post(`${base}/import/apple-notes`, {});
    expect(res.status).toBe(200);
    expect((res.body as { notes: { imported: number } }).notes.imported).toBe(0);
  });
});

describe('stripSecrets', () => {
  it('drops credential-shaped lines and keeps the rest', () => {
    const { kept, dropped } = stripSecrets(
      '결제 연동 메모\nsk_live_' + 'a'.repeat(24) + '\nprod_V1f624pSwxhhr1 는 프로덕트 아이디\npassword: hunter2',
    );
    expect(dropped).toBe(2);
    expect(kept).toContain('결제 연동 메모');
    expect(kept).toContain('prod_V1f624pSwxhhr1'); // product ids are not secrets
    expect(kept).not.toContain('sk_live_');
    expect(kept).not.toContain('hunter2');
  });
});

describe('concurrent ingest', () => {
  it('two batches racing come out serialized — no FOREIGN KEY carnage', async () => {
    const items = (tag: string) => [
      { workspaceId: WS, type: 'text' as const, content: `racing note ${tag} one`, title: `${tag}-1` },
      { workspaceId: WS, type: 'text' as const, content: `racing note ${tag} two`, title: `${tag}-2` },
    ];
    // Fired together, unawaited — the exact shape the Notes button produced
    // when two tabs pressed it at once.
    const [a, b] = await Promise.all([
      deps.ingest.ingestBatch(items('a')),
      deps.ingest.ingestBatch(items('b')),
    ]);

    for (const r of [...a.results, ...b.results]) {
      expect(r.status).not.toBe('failed');
    }
    expect(repo.listSources(WS).filter((s) => s.status === 'failed')).toHaveLength(0);
  });
});
