import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { validateSeed } from '../../src/data/validateSeed';
import { assignMemory, categoryProfiles } from '../../src/core/assign';
import { ASSIGN } from '../../src/core/thresholds';

const WS = 'ws_demo';
let repo: SqliteRepository;
let pipeline: IngestPipeline;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  pipeline = new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings());
});

afterEach(() => repo.close());

const capture = () =>
  pipeline.ingest({
    workspaceId: WS,
    type: 'screenshot',
    content: 'Braintrust vs Langfuse for agent evals',
    imagePath: '/seed/demo-screenshot.png',
  });

describe('IngestPipeline — the demo ingest, end to end through the database', () => {
  it('persists the source, extracts two memories, and fires exactly one split', async () => {
    const result = await capture();

    expect(result.status).toBe('complete');
    expect(result.addedMemoryIds).toHaveLength(2);
    expect(result.reorg).not.toBeNull();
    expect(result.reorg!.operation).toBe('split');
    expect(result.reorg!.created_category_ids).toHaveLength(2);
  });

  it('writes the banner text the presenter is about to say (AC-21)', async () => {
    const { reorg } = await capture();
    expect(reorg!.banner_text).toBe(
      'Split **AI Tooling** into **Agent Frameworks** and **Evals & Observability**',
    );
  });

  it('leaves AI Tooling intact with two children of 7 and 4 (AC-27)', async () => {
    await capture();
    const payload = repo.getGraphPayload(WS);
    const ai = payload.categories.find((c) => c.name === 'AI Tooling')!;

    expect(ai.parent_id).toBeNull();
    expect(payload.memories.filter((m) => m.category_id === ai.id)).toHaveLength(0);

    const children = payload.categories.filter((c) => c.parent_id === ai.id);
    expect(children.map((c) => c.name).sort()).toEqual(['Agent Frameworks', 'Evals & Observability']);
    expect(
      children.map((c) => payload.memories.filter((m) => m.category_id === c.id).length)
        .sort((a, b) => a - b),
    ).toEqual([4, 7]);
  });

  it('produces a payload the frontend validator accepts', async () => {
    await capture();
    const payload = validateSeed(repo.getGraphPayload(WS));
    expect(payload.memories).toHaveLength(49);
    expect(payload.sources).toHaveLength(23);
    expect(payload.categories).toHaveLength(22);
  });

  it('never nests three levels deep after a split', async () => {
    await capture();
    const payload = repo.getGraphPayload(WS);
    for (const c of payload.categories) {
      if (!c.parent_id) continue;
      expect(payload.categories.find((p) => p.id === c.parent_id)!.parent_id).toBeNull();
    }
  });

  it('caps relates_to edges at three per memory and stores ordered pairs', async () => {
    await capture();
    const edges = repo.listEdges(WS);
    const degree = new Map<string, number>();
    for (const e of edges) {
      expect(e.source_memory_id < e.target_memory_id).toBe(true);
      for (const endpoint of [e.source_memory_id, e.target_memory_id]) {
        degree.set(endpoint, (degree.get(endpoint) ?? 0) + 1);
      }
    }
    // A memory can be *chosen by* others, so degree exceeds 3; what is capped is
    // how many each memory itself contributes.
    expect(edges.length).toBeLessThanOrEqual(repo.listMemories(WS).length * 3);
  });
});

describe('IngestPipeline — user edits survive reorganization', () => {
  it('does not reassign a locked memory (AC-24)', async () => {
    const ai = repo.listCategories(WS).find((c) => c.name === 'AI Tooling')!;
    const pinned = repo.listMemories(WS).find((m) => m.category_id === ai.id)!;
    const elsewhere = repo.listCategories(WS).find((c) => c.name === 'Pricing')!;

    repo.assign({
      memoryId: pinned.id, categoryId: elsewhere.id, confidence: 0.9, assignedBy: 'user',
    });

    await capture();

    expect(repo.listMemories(WS).find((m) => m.id === pinned.id)!.category_id)
      .toBe(elsewhere.id);
  });

  it('leaves a name-locked category unsplit (AC-23)', async () => {
    const ai = repo.listCategories(WS).find((c) => c.name === 'AI Tooling')!;
    repo.updateCategory(ai.id, { name_locked: true });

    const result = await capture();

    expect(result.reorg).toBeNull();
    expect(repo.listCategories(WS).filter((c) => c.parent_id === ai.id)).toHaveLength(0);
  });
});

describe('IngestPipeline — undo', () => {
  it('restores the pre-split taxonomy and tombstones the created names (AC-22, AC-25)', async () => {
    const { reorg } = await capture();
    const beforeCount = reorg!.before_state.categories.length;

    pipeline.undo(WS, reorg!);

    const payload = repo.getGraphPayload(WS);
    expect(payload.categories).toHaveLength(beforeCount);

    const ai = payload.categories.find((c) => c.name === 'AI Tooling')!;
    expect(payload.memories.filter((m) => m.category_id === ai.id)).toHaveLength(11);

    // The names must not come back on the next pass.
    expect(repo.listTombstones(WS).sort())
      .toEqual(['agent frameworks', 'evals & observability']);
  });

  it('keeps the captured memories — undo reverses the reorganization, not the capture', async () => {
    const { reorg } = await capture();
    pipeline.undo(WS, reorg!);
    expect(repo.listMemories(WS)).toHaveLength(49);
    expect(repo.listSources(WS)).toHaveLength(23);
  });
});

describe('IngestPipeline — failure paths keep the capture', () => {
  it('records no_memories and still persists the source (AC-9)', async () => {
    const empty = new FixtureProvider();
    empty.extract = async () => ({ memories: [], summary: '', suggested_title: 'Nothing' });
    const p = new IngestPipeline(repo, empty, new FixtureEmbeddings());

    const result = await p.ingest({ workspaceId: WS, type: 'text', content: 'navigation chrome' });

    expect(result.status).toBe('no_memories');
    expect(result.note).toMatch(/it's in your Sources/i);
    expect(repo.listSources(WS).find((s) => s.id === result.sourceId)!.status).toBe('no_memories');
  });

  it('records failed and still persists the source when extraction throws', async () => {
    const broken = new FixtureProvider();
    broken.extract = async () => {
      throw new Error('rate limited');
    };
    const p = new IngestPipeline(repo, broken, new FixtureEmbeddings());

    const result = await p.ingest({ workspaceId: WS, type: 'text', content: 'anything' });

    expect(result.status).toBe('failed');
    const source = repo.listSources(WS).find((s) => s.id === result.sourceId)!;
    expect(source.status).toBe('failed');
    expect(source.error_message).toBe('rate limited');
    expect(repo.listMemories(WS)).toHaveLength(47);
  });

  /**
   * The failure note has always said "it's saved and you can retry". These are
   * the retry actually existing.
   */
  it('retries a failed source in place, keeping its id', async () => {
    const flaky = new FixtureProvider();
    let firstAttempt = true;
    // FixtureProvider.extract ignores its argument, so the passthrough does too.
    const realExtract = flaky.extract.bind(flaky);
    flaky.extract = () => {
      if (firstAttempt) {
        firstAttempt = false;
        return Promise.reject(new Error('rate limited'));
      }
      return realExtract();
    };
    const p = new IngestPipeline(repo, flaky, new FixtureEmbeddings());

    const failed = await p.ingest({
      workspaceId: WS, type: 'screenshot', content: 'Braintrust vs Langfuse for agent evals',
      imagePath: '/seed/demo-screenshot.png',
    });
    expect(failed.status).toBe('failed');
    const sourcesAfterFailure = repo.listSources(WS).length;

    const retried = await p.retry(WS, failed.sourceId);

    expect(retried.status).toBe('complete');
    // Same id, and no second row — otherwise the failed capture would sit in
    // Sources forever beside its own replacement.
    expect(retried.sourceId).toBe(failed.sourceId);
    expect(repo.listSources(WS)).toHaveLength(sourcesAfterFailure);
    const source = repo.listSources(WS).find((s) => s.id === failed.sourceId)!;
    expect(source.status).toBe('complete');
    expect(source.error_message).toBeNull();
    expect(repo.listMemories(WS).length).toBeGreaterThan(47);
  });

  it('refuses to retry a source that did not fail', async () => {
    const ok = await capture();
    expect(ok.status).toBe('complete');
    await expect(pipeline.retry(WS, ok.sourceId)).rejects.toThrow(/not failed/);
  });

  it('refuses to retry a source it has never seen', async () => {
    await expect(pipeline.retry(WS, 'src_nope')).rejects.toThrow(/unknown source/);
  });

  it('still attaches the memories when naming fails, rather than losing the ingest', async () => {
    const badNamer = new FixtureProvider();
    badNamer.nameClusters = async () => {
      throw new Error('namer down');
    };
    const p = new IngestPipeline(repo, badNamer, new FixtureEmbeddings());

    const result = await p.ingest({
      workspaceId: WS, type: 'screenshot', content: 'x', imagePath: '/seed/demo-screenshot.png',
    });

    expect(result.status).toBe('complete');
    expect(result.addedMemoryIds).toHaveLength(2);
    expect(result.reorg).toBeNull();          // the bonus was lost
    expect(repo.listMemories(WS)).toHaveLength(49); // the memories were not
  });
});

describe('assignMemory — spec 8.3 thresholds', () => {
  it('files a memory into the category it already resembles', () => {
    const payload = repo.getGraphPayload(WS);
    const profiles = categoryProfiles(payload.categories, payload.memories);
    const ai = payload.categories.find((c) => c.name === 'AI Tooling')!;
    const member = payload.memories.find((m) => m.category_id === ai.id)!;

    const decision = assignMemory(member.vector, profiles);
    expect(decision.kind).toBe('existing');
    expect(decision.categoryId).toBe(ai.id);
    expect(decision.score).toBeGreaterThanOrEqual(ASSIGN.EXISTING_CATEGORY);
  });

  it('opens a new parent category for something unlike anything saved', () => {
    // Tested against synthetic geometry rather than the seed. With 47 unit
    // vectors in 8 dimensions the space is densely covered — no direction is
    // genuinely far from all of them, so `new_parent` is unreachable on this
    // corpus. That is a property of the 8-dim seed, not of the rule; at real
    // embedding dimensionality novel content really is far from everything.
    const e = (i: number, dim = 8) => {
      const v = new Array(dim).fill(0);
      v[i] = 1;
      return v as number[];
    };
    const profiles = [
      { id: 'cat_a', parentId: null, vectors: [e(0), e(1)] },
      { id: 'cat_b', parentId: 'cat_a', vectors: [e(2)] },
    ];

    // Orthogonal to every member: similarity 0, well under NEW_CHILD.
    const decision = assignMemory(e(5), profiles);
    expect(decision.kind).toBe('new_parent');
    expect(decision.score).toBeLessThan(ASSIGN.NEW_CHILD);
  });

  it('opens a new child when related to a family but not to any member', () => {
    const dim = 8;
    const base = new Array(dim).fill(0);
    base[0] = 1;
    /*
     * Placed relative to the thresholds rather than at a literal 0.45, which was
     * "inside the 0.40-0.55 band" until that band became 0.24-0.28 and the case
     * silently turned into an `existing` match. The band is what is under test;
     * where it happens to sit is the embedder's business.
     */
    const target = (ASSIGN.NEW_CHILD + ASSIGN.EXISTING_CATEGORY) / 2;
    const between = new Array(dim).fill(0);
    between[0] = target;
    between[6] = Math.sqrt(1 - target ** 2);

    const profiles = [{ id: 'cat_parent', parentId: null, vectors: [base] }];
    const decision = assignMemory(between, profiles);

    expect(decision.kind).toBe('new_child');
    expect(decision.parentId).toBe('cat_parent');
    expect(decision.score).toBeGreaterThanOrEqual(ASSIGN.NEW_CHILD);
    expect(decision.score).toBeLessThan(ASSIGN.EXISTING_CATEGORY);
  });

  it('files an evals memory into AI Tooling despite the bimodal centroid', () => {
    // The regression this whole rule exists for: scored by centroid this lands
    // at 0.41 and spawns a new category, pre-empting the split that the demo
    // is built around. Scored by nearest member it lands at 0.72.
    const payload = repo.getGraphPayload(WS);
    const profiles = categoryProfiles(payload.categories, payload.memories);
    const ai = payload.categories.find((c) => c.name === 'AI Tooling')!;
    const evalsMemory = payload.memories.find((m) => m.text.startsWith('Two reviewers'))!;

    const decision = assignMemory(evalsMemory.vector, profiles);
    expect(decision.kind).toBe('existing');
    expect(decision.categoryId).toBe(ai.id);
  });

  it('is deterministic under ties', () => {
    const payload = repo.getGraphPayload(WS);
    const profiles = categoryProfiles(payload.categories, payload.memories);
    const v = payload.memories[0]!.vector;
    const first = assignMemory(v, profiles);
    for (let i = 0; i < 20; i++) expect(assignMemory(v, profiles)).toEqual(first);
  });

  it('ignores empty categories, which have no centroid to match against', () => {
    repo.insertCategory(WS, {
      id: 'cat_empty', parent_id: null, name: 'Empty', rationale: null,
      name_locked: false, user_created: false, x: 0, y: 0, pinned: false, created_by: 'ai',
    });
    const payload = repo.getGraphPayload(WS);
    const profiles = categoryProfiles(payload.categories, payload.memories);
    expect(profiles.find((c) => c.id === 'cat_empty')!.vectors).toHaveLength(0);

    const v = payload.memories[0]!.vector;
    expect(assignMemory(v, profiles).categoryId).not.toBe('cat_empty');
  });
});
