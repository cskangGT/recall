import { describe, it, expect } from 'vitest';
import { buildSourceRows } from '../../src/components/SourcesView';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import type { GraphPayload, Source } from '../../src/core/types';

const payload = validateSeed(workspaceJson);

const source = (id: string, type: Source['type'], createdAt: string): Source => ({
  id, type, title: `Source ${id}`, raw_content: 'x',
  scene_description: null, url: null, image_path: null, created_at: createdAt,
});

describe('buildSourceRows', () => {
  it('lists every source with the number of memories it produced', () => {
    const rows = buildSourceRows(payload);
    expect(rows).toHaveLength(22);
    expect(rows.reduce((n, r) => n + r.memoryCount, 0)).toBe(47);
  });

  it('sorts newest first', () => {
    const rows = buildSourceRows(payload);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.source.created_at >= rows[i]!.source.created_at).toBe(true);
    }
  });

  it('breaks date ties deterministically', () => {
    const same = '2026-05-01T09:00:00Z';
    const custom: GraphPayload = {
      ...payload,
      sources: [source('src_b', 'text', same), source('src_a', 'text', same)],
      memories: [],
    };
    expect(buildSourceRows(custom).map((r) => r.source.id)).toEqual(['src_a', 'src_b']);
  });

  it('filters by type', () => {
    for (const type of ['text', 'link', 'screenshot'] as const) {
      const rows = buildSourceRows(payload, type);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.source.type === type)).toBe(true);
    }
    expect(buildSourceRows(payload, 'text')).toHaveLength(9);
    expect(buildSourceRows(payload, 'link')).toHaveLength(8);
    expect(buildSourceRows(payload, 'screenshot')).toHaveLength(5);
  });

  it('marks a source that produced nothing', () => {
    // The state the "It's in your Sources" toast points at. Before this screen
    // existed, that copy pointed at nothing.
    const custom: GraphPayload = {
      ...payload,
      sources: [...payload.sources, source('src_empty', 'text', '2026-09-01T00:00:00Z')],
    };
    const rows = buildSourceRows(custom);
    const empty = rows.find((r) => r.source.id === 'src_empty')!;
    expect(empty.empty).toBe(true);
    expect(empty.memoryCount).toBe(0);
    // Newest, so it is the first thing the user sees after being sent here.
    expect(rows[0]!.source.id).toBe('src_empty');
  });

  it('never marks a source that produced memories as empty', () => {
    for (const row of buildSourceRows(payload)) {
      expect(row.empty).toBe(row.memoryCount === 0);
      expect(row.empty).toBe(false);
    }
  });

  it('returns nothing for an empty workspace rather than throwing', () => {
    const bare: GraphPayload = { ...payload, sources: [], memories: [] };
    expect(buildSourceRows(bare)).toEqual([]);
  });
});

describe('a failed source is not an empty one', () => {
  const base = (over: Partial<Source> = {}): Source => ({
    id: 'src_x', type: 'text', title: 'A capture', raw_content: '',
    scene_description: null, url: null, image_path: null,
    created_at: '2026-07-01T00:00:00Z', ...over,
  });

  const payloadWith = (source: Source): GraphPayload => ({
    workspace: { id: 'ws', name: 'ws', auto_reorganize: true },
    sources: [source], memories: [], categories: [], entities: [], edges: [],
  });

  it('marks a failed source failed rather than empty', () => {
    const [row] = buildSourceRows(payloadWith(base({ status: 'failed', error_message: 'timeout' })));
    expect(row!.failed).toBe(true);
    // Calling it empty would hide that it can be retried.
    expect(row!.empty).toBe(false);
    expect(row!.error).toBe('timeout');
  });

  it('still calls a successful source with no memories empty', () => {
    const [row] = buildSourceRows(payloadWith(base({ status: 'no_memories' })));
    expect(row!.empty).toBe(true);
    expect(row!.failed).toBe(false);
  });

  it('treats a source with no status at all as fine — seed payloads predate it', () => {
    const [row] = buildSourceRows(payloadWith(base()));
    expect(row!.failed).toBe(false);
    expect(row!.error).toBeNull();
  });
});


describe('a link saved but not read', () => {
  const link = (over: Partial<Source> = {}): Source => ({
    id: 'src_link', type: 'link', title: 'Things You Should Never Do',
    raw_content: 'An essay about rewriting software from scratch.',
    scene_description: null, url: 'https://example.com/a', image_path: null,
    status: 'no_memories', error_message: null, created_at: '2026-01-01T00:00:00Z',
    ...over,
  });
  const graph = (sources: Source[]): GraphPayload => ({
    ...payload, sources, memories: [], categories: [], entities: [], edges: [],
  });

  it('is not the same thing as an empty capture', () => {
    // Both produce zero memories. Only one of them has somewhere to go.
    const [row] = buildSourceRows(graph([link()]), 'all');
    expect(row!.unread).toBe(true);
    expect(row!.empty).toBe(false);
  });

  it('is an empty capture when there is nothing to open', () => {
    const [row] = buildSourceRows(graph([link({ type: 'text', url: null })]), 'all');
    expect(row!.unread).toBe(false);
    expect(row!.empty).toBe(true);
  });

  it('is a failure when it failed, whatever its type', () => {
    const [row] = buildSourceRows(graph([link({ status: 'failed', error_message: 'rate limited' })]), 'all');
    expect(row!.failed).toBe(true);
    expect(row!.unread).toBe(false);
  });

  it('stops being unread once its page has been captured', () => {
    const withMemory: GraphPayload = {
      ...graph([link()]),
      memories: [{
        id: 'm1', source_id: 'src_link', category_id: 'c1', text: 'A claim', kind: 'fact',
        confidence: 0.9, vector: [1, 0, 0], entity_ids: [], created_at: '2026-01-02T00:00:00Z',
        x: null, y: null, pinned: false, category_locked: false,
      }],
    };
    expect(buildSourceRows(withMemory, 'all')[0]!.unread).toBe(false);
  });
});
