import { describe, it, expect } from 'vitest';
import {
  EXPORT_VERSION, exportFilename, exportStamp, toJson, toMarkdown,
} from '../../src/core/exportCorpus';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import type { Category, GraphPayload, Memory, Source } from '../../src/core/types';

/**
 * A memory tool whose contents you cannot get out of it is one you cannot
 * leave. Snapshots are `.db` files — right for recovery, useless to anything
 * that does not already know this schema.
 */

const seed = validateSeed(workspaceJson) as GraphPayload;
const AT = new Date('2026-08-04T09:15:00Z');

const cat = (id: string, name: string, parent: string | null = null): Category => ({
  id, parent_id: parent, name, rationale: null, name_locked: false,
  user_created: false, x: null, y: null, pinned: false, created_by: 'ai',
});

const mem = (id: string, categoryId: string, text: string, sourceId = 'src_1'): Memory => ({
  id, source_id: sourceId, category_id: categoryId, text, kind: 'fact',
  confidence: 0.9, vector: [1, 0, 0], entity_ids: [],
  created_at: '2026-01-01T00:00:00Z', x: null, y: null, pinned: false,
  category_locked: false,
});

const src = (id: string, title: string, url: string | null = null): Source => ({
  id, type: url ? 'link' : 'text', title, raw_content: 'body',
  scene_description: null, url, image_path: null,
  status: 'complete', error_message: null, created_at: '2026-01-01T00:00:00Z',
});

const graph = (
  categories: Category[], memories: Memory[], sources: Source[] = [src('src_1', 'A note')],
): GraphPayload => ({
  categories, memories, sources, entities: [], edges: [],
  workspace: { id: 'ws', name: 'Recall', auto_reorganize: true },
});

describe('JSON', () => {
  it('carries the whole payload, vectors included, so it can be read back', () => {
    // The point of the JSON one: a `.db` snapshot is for recovery, this is for
    // moving. Dropping vectors would make it un-importable.
    const out = toJson(seed, AT);
    expect(out.payload.memories[0]!.vector.length).toBeGreaterThan(0);
    expect(out.payload.memories).toHaveLength(seed.memories.length);
    expect(out.payload.categories).toHaveLength(seed.categories.length);
  });

  it('is the shape the seed validator already accepts', () => {
    // Not a coincidence — the seed corpus is a file of exactly this shape, so
    // an export is a workspace something else could load.
    expect(() => validateSeed(toJson(seed, AT).payload)).not.toThrow();
  });

  it('says what it is, so a future reader knows what they have', () => {
    const out = toJson(seed, AT);
    expect(out.recall_export_version).toBe(EXPORT_VERSION);
    expect(out.exported_at).toBe(AT.toISOString());
    expect(out.counts).toEqual({ sources: 22, memories: 47, categories: 20, entities: 31 });
  });
});

describe('Markdown', () => {
  it('follows the structure the app built, not a flat dump', () => {
    // A flat list of 400 sentences is a backup. The structure is the thing this
    // tool made for you, and it is most of why the export is worth having.
    const md = toMarkdown(
      graph(
        [cat('c_root', 'Product'), cat('c_kid', 'Pricing', 'c_root')],
        [mem('m1', 'c_root', 'A loose thought'), mem('m2', 'c_kid', 'A pricing thought')],
      ),
      AT,
    );
    expect(md).toContain('## Product');
    expect(md).toContain('### Pricing');
    expect(md.indexOf('## Product')).toBeLessThan(md.indexOf('### Pricing'));
    expect(md.indexOf('A loose thought')).toBeLessThan(md.indexOf('### Pricing'));
  });

  it('puts the source beside every memory, and links it when there is a link', () => {
    const md = toMarkdown(
      graph(
        [cat('c1', 'Reading')],
        [mem('m1', 'c1', 'A claim', 'src_link')],
        [src('src_link', 'Things You Should Never Do', 'https://example.com/a')],
      ),
      AT,
    );
    expect(md).toContain('- A claim — [Things You Should Never Do](https://example.com/a)');
  });

  it('names the source plainly when there is nothing to link to', () => {
    const md = toMarkdown(graph([cat('c1', 'Notes')], [mem('m1', 'c1', 'A claim')]), AT);
    expect(md).toContain('- A claim — A note');
  });

  it('keeps a memory whose category is gone, under a heading that says so', () => {
    // An export that quietly drops rows is worse than no export.
    const md = toMarkdown(graph([cat('c1', 'Notes')], [mem('m1', 'c_deleted', 'Still mine')]), AT);
    expect(md).toContain('## Unfiled');
    expect(md).toContain('Still mine');
  });

  it('says so rather than producing a confusing empty file', () => {
    expect(toMarkdown(graph([], []), AT)).toContain('Nothing saved yet');
  });

  it('reports what it holds and when it was taken', () => {
    const md = toMarkdown(seed, AT);
    expect(md).toContain('47 memories from 22 sources, exported 2026-08-04.');
  });

  it('counts one of a thing as one', () => {
    const md = toMarkdown(graph([cat('c1', 'Notes')], [mem('m1', 'c1', 'Alone')]), AT);
    expect(md).toContain('1 memory from 1 source');
  });

  it('has no runs of blank lines, so it renders as written', () => {
    expect(toMarkdown(seed, AT)).not.toMatch(/\n{3,}/);
  });

  it('ends with exactly one newline', () => {
    const md = toMarkdown(seed, AT);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('orders categories predictably, so two exports of the same corpus match', () => {
    expect(toMarkdown(seed, AT)).toBe(toMarkdown(seed, AT));
  });
});

describe('filenames', () => {
  it('carries a date a person can read and a filesystem accepts', () => {
    expect(exportStamp(AT)).toBe('2026-08-04');
    expect(exportFilename('md', AT)).toBe('recall-2026-08-04.md');
    expect(exportFilename('json', AT)).toBe('recall-2026-08-04.json');
  });
});
