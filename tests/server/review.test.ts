import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { buildExtractPrompt } from '../../server/ai/prompts';

/**
 * The review (spec §21): one source's verdicts applied atomically, every
 * verdict recorded — the curation signal — and the last discards riding into
 * the next extraction as negative examples.
 */

const WS = 'ws_demo';
let repo: SqliteRepository;
let deps: Deps;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  deps = {
    repo,
    ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
    ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
    reset: () => {},
  };
});

afterEach(() => repo.close());

const post = (path: string, body: unknown = null) => handle({ method: 'POST', path, body }, deps);
const base = `/api/workspaces/${WS}`;

/** A source with at least two memories, for verdict variety. */
const richSource = () => {
  const counts = new Map<string, number>();
  for (const m of repo.listMemories(WS)) counts.set(m.source_id, (counts.get(m.source_id) ?? 0) + 1);
  const id = [...counts.entries()].find(([, n]) => n >= 2)![0];
  return { id, memories: repo.listMemories(WS).filter((m) => m.source_id === id) };
};

describe('POST sources/:id/review', () => {
  it('applies drop and rewrite, records every verdict, stamps the source', async () => {
    const { id, memories } = richSource();
    const [drop, edit, ...kept] = memories;

    const res = await post(`${base}/sources/${id}/review`, {
      discard: [drop!.id],
      edits: [{ memoryId: edit!.id, text: '내가 다시 쓴 문장.' }],
    });
    expect(res.status).toBe(200);

    // The drop is gone; the rewrite carries new text, a new vector, and a lock.
    const after = repo.listMemories(WS);
    expect(after.some((m) => m.id === drop!.id)).toBe(false);
    const edited = after.find((m) => m.id === edit!.id)!;
    expect(edited.text).toBe('내가 다시 쓴 문장.');
    expect(edited.vector).not.toEqual(edit!.vector);
    expect(repo.isAssignmentLocked(edit!.id)).toBe(true);

    // Every verdict recorded — keeps included; the discard keeps its text.
    const rows = repo.listCuration(WS);
    expect(rows).toHaveLength(memories.length);
    expect(rows.find((r) => r.verdict === 'discard')!.memory_text).toBe(drop!.text);
    expect(rows.find((r) => r.verdict === 'edit')!.edited_text).toBe('내가 다시 쓴 문장.');
    expect(rows.filter((r) => r.verdict === 'keep')).toHaveLength(kept.length);

    // The stamp reaches the payload the client reads.
    const source = repo.getGraphPayload(WS).sources.find((s) => s.id === id)!;
    expect(source.reviewed_at).toBeTruthy();
  });

  it('is atomic — one bad memory id and nothing changes', async () => {
    const { id, memories } = richSource();
    const before = repo.listMemories(WS).length;

    const res = await post(`${base}/sources/${id}/review`, {
      discard: [memories[0]!.id, 'mem_ghost'],
    });
    expect(res.status).toBe(400);
    expect(repo.listMemories(WS)).toHaveLength(before);
    expect(repo.listCuration(WS)).toHaveLength(0);
  });

  it('refuses a memory that is both edited and discarded, and an empty rewrite', async () => {
    const { id, memories } = richSource();
    const m = memories[0]!;
    expect(
      (await post(`${base}/sources/${id}/review`, {
        discard: [m.id],
        edits: [{ memoryId: m.id, text: 'x' }],
      })).status,
    ).toBe(400);
    expect(
      (await post(`${base}/sources/${id}/review`, {
        edits: [{ memoryId: m.id, text: '   ' }],
      })).status,
    ).toBe(400);
  });

  it('404s an unknown source', async () => {
    expect((await post(`${base}/sources/src_ghost/review`, { discard: [] })).status).toBe(404);
  });
});

describe('the signal teaches the next extraction', () => {
  it('recent discards ride into the extract prompt as negative examples', async () => {
    const { id, memories } = richSource();
    await post(`${base}/sources/${id}/review`, { discard: [memories[0]!.id] });

    const rejected = repo.listCuration(WS, 'discard', 5).map((c) => c.memory_text);
    expect(rejected).toContain(memories[0]!.text);

    const prompt = buildExtractPrompt({ content: 'anything', type: 'text', rejectedExamples: rejected });
    expect(prompt).toContain('REMOVED ones like these');
    expect(prompt).toContain(memories[0]!.text);

    // And without any signal, the section simply is not there.
    expect(buildExtractPrompt({ content: 'anything', type: 'text' })).not.toContain('REMOVED');
  });
});
