import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { imageSaver } from '../../server/link/saveImage';

/**
 * A photo written alongside a thought: the client sends the image itself as a
 * data URL, the server keeps it on disk, and the capture proceeds down the
 * ordinary imagePath pipeline.
 */

// A 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const WS = 'ws_demo';
let repo: SqliteRepository;
let dir: string;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  dir = mkdtempSync(path.join(tmpdir(), 'mado-img-'));
});

afterEach(() => {
  repo.close();
  rmSync(dir, { recursive: true, force: true });
});

const depsWith = (extra: Partial<Deps>): Deps => ({
  repo,
  ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  reset: () => {},
  ...extra,
});

const capture = (deps: Deps, body: Record<string, unknown>) =>
  handle({ method: 'POST', path: `/api/workspaces/${WS}/capture`, body }, deps);

describe('capture with imageData', () => {
  it('stores the photo and captures through the imagePath pipeline', async () => {
    const deps = depsWith({ saveImage: imageSaver(dir) });
    const res = await capture(deps, {
      type: 'screenshot',
      content: '오늘 본 하늘',
      imageData: PNG,
    });
    expect(res.status).toBe(200);
    const source = repo.listSources(WS).find((s) => s.image_path?.startsWith(dir));
    expect(source).toBeTruthy();
    expect(existsSync(source!.image_path!)).toBe(true);
  });

  it('says plainly when it cannot store images', async () => {
    const res = await capture(depsWith({}), {
      type: 'screenshot',
      content: 'x',
      imageData: PNG,
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('cannot store files');
  });

  it('refuses what is not an image data URL', async () => {
    const deps = depsWith({ saveImage: imageSaver(dir) });
    const res = await capture(deps, {
      type: 'screenshot',
      content: 'x',
      imageData: 'data:text/html;base64,PGI+aGk8L2I+',
    });
    expect(res.status).toBe(400);
  });
});

/**
 * A PDF rides the same road as a photo: kept on disk, read by normalize — as
 * a document — and what was read becomes the source's own text, so a PDF is a
 * text source whose original is its words. The fixture cannot read a
 * document, so the door is closed on it; a reading provider is stood in here.
 */
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')}`;

class ReadingProvider extends FixtureProvider {
  readonly readsPdf = true;
  seen: string | undefined;
  async normalize(input: Parameters<FixtureProvider['normalize']>[0]) {
    this.seen = input.imagePath;
    return {
      ocr_text: 'Seed funds decide within two meetings.\nRunway should cover eighteen months.',
      scene_description: 'A two-page memo on seed fundraising.',
      detected_context: 'document' as const,
      has_meaningful_text: true,
    };
  }
}

describe('capture with a PDF', () => {
  it('keeps the file, has it read, and stores what was read as the original', async () => {
    const ai = new ReadingProvider();
    const deps = depsWith({
      saveImage: imageSaver(dir),
      ingest: new IngestPipeline(repo, ai, new FixtureEmbeddings()),
    });
    const res = await capture(deps, { type: 'text', title: 'Seed memo', content: '', fileData: PDF });
    expect(res.status).toBe(200);

    expect(ai.seen?.endsWith('.pdf')).toBe(true);
    expect(existsSync(ai.seen!)).toBe(true);
    const source = repo.listSources(WS).find((s) => s.image_path === ai.seen)!;
    expect(source.type).toBe('text');
    expect(source.title).toBe('Seed memo');
    expect(source.raw_content).toContain('Runway should cover eighteen months');
    expect(source.scene_description).toBe('A two-page memo on seed fundraising.');
  });

  it('opens the door only where the model reads documents and files can be kept', async () => {
    const caps = (deps: Deps) => handle({ method: 'GET', path: '/api/capabilities', body: null }, deps);
    const reading = new IngestPipeline(repo, new ReadingProvider(), new FixtureEmbeddings());
    expect(((await caps(depsWith({ saveImage: imageSaver(dir), ingest: reading }))).body as { pdf: boolean }).pdf).toBe(true);
    expect(((await caps(depsWith({ ingest: reading }))).body as { pdf: boolean }).pdf).toBe(false);
    expect(((await caps(depsWith({ saveImage: imageSaver(dir) }))).body as { pdf: boolean }).pdf).toBe(false);
  });

  it('refuses a file that only claims to be a PDF', async () => {
    const deps = depsWith({ saveImage: imageSaver(dir) });
    const fake = `data:application/pdf;base64,${Buffer.from('<html>not a pdf</html>').toString('base64')}`;
    const res = await capture(deps, { type: 'text', content: '', fileData: fake });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('not a PDF');
  });

  it('a PDF nothing could be read from fails as a source, not silently', async () => {
    class Blank extends ReadingProvider {
      async normalize() {
        return { ocr_text: '', scene_description: '', detected_context: 'document' as const, has_meaningful_text: false };
      }
    }
    const deps = depsWith({
      saveImage: imageSaver(dir),
      ingest: new IngestPipeline(repo, new Blank(), new FixtureEmbeddings()),
    });
    await capture(deps, { type: 'text', title: 'Blank', content: '', fileData: PDF });
    const source = repo.listSources(WS).find((s) => s.title === 'Blank')!;
    expect(source.status).toBe('failed');
    expect(source.error_message).toContain('nothing could be read');
  });
});

/*
 * The look before keeping, for a file: `files/read` stores the document and
 * hands back what the model read, keeping nothing; a keep that then arrives
 * with the words in hand and the stored path is not read a second time.
 */
describe('POST files/read, and a pre-read keep', () => {
  const read = (deps: Deps, body: Record<string, unknown>) =>
    handle({ method: 'POST', path: `/api/workspaces/${WS}/files/read`, body }, deps);

  it('answers 501 where files cannot be kept or read', async () => {
    expect((await read(depsWith({}), { fileData: PDF })).status).toBe(501);
    expect((await read(depsWith({ saveImage: imageSaver(dir) }), { fileData: PDF })).status).toBe(501);
  });

  it('reads the document out and keeps no source', async () => {
    const ai = new ReadingProvider();
    const deps = depsWith({ saveImage: imageSaver(dir), ingest: new IngestPipeline(repo, ai, new FixtureEmbeddings()) });
    const before = repo.listSources(WS).length;
    const res = await read(deps, { fileData: PDF });
    expect(res.status).toBe(200);
    const body = res.body as { path: string; text: string; chars: number; redacted: number };
    expect(body.path.endsWith('.pdf')).toBe(true);
    expect(existsSync(body.path)).toBe(true);
    expect(body.text).toContain('Runway should cover eighteen months');
    expect(body.chars).toBe(body.text.length);
    expect(repo.listSources(WS).length).toBe(before);
    expect((await read(deps, {})).status).toBe(400);
  });

  it('a keep that brings the words and the stored path is not read again', async () => {
    const ai = new ReadingProvider();
    const deps = depsWith({ saveImage: imageSaver(dir), ingest: new IngestPipeline(repo, ai, new FixtureEmbeddings()) });
    const stored = (await read(deps, { fileData: PDF })).body as { path: string };
    ai.seen = undefined;
    const res = await capture(deps, { type: 'text', title: 'Seed memo', content: 'My note: the part on runway.\n\nRunway should cover eighteen months.', imagePath: stored.path });
    expect(res.status).toBe(200);
    expect(ai.seen).toBeUndefined();
    const source = repo.listSources(WS).find((s) => s.image_path === stored.path)!;
    expect(source.raw_content).toContain('My note: the part on runway.');
  });
});
