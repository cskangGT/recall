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
    expect((res.body as { error: string }).error).toContain('cannot store images');
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
