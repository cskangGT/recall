import { describe, it, expect, beforeEach } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { extractClaims } from '../../src/capture/extractLocal';
import { localVector, lexicalSimilarity } from '../../src/capture/embedLocal';
import { runBatchPipeline, resetBatchIds, type BatchItem } from '../../src/capture/batch';
import { DUPLICATE_SIMILARITY } from '../../src/core/thresholds';
import { cosine } from '../../src/core/vectorMath';

const base = validateSeed(workspaceJson);
const NOW = '2026-08-04T00:00:00.000Z';

/** Content that lexically echoes the seed's AI Tooling memories. */
const AI_NOTE: BatchItem = {
  title: 'agent notes',
  content: [
    'Considering LangChain against direct SDK calls for the agent runtime rewrite.',
    'Braintrust looks like the strongest option for agent evals right now.',
  ].join('\n'),
};

/** Content that shares no vocabulary with the seed corpus. */
const ALIEN_NOTE: BatchItem = {
  title: 'sourdough log',
  content: [
    'Third sourdough bake collapsed because the starter was underfed overnight.',
    'Doubling the autolyse window made the crumb noticeably more open.',
  ].join('\n'),
};

beforeEach(() => resetBatchIds());

describe('extractClaims', () => {
  it('splits lines and sentences into claims, stripping bullets', () => {
    const claims = extractClaims(
      '- Decided to drop the old importer for the new one.\n' +
        '## heading noise\n' +
        '1) The migration script needs a dry-run mode before launch.',
    );
    expect(claims).toEqual([
      'Decided to drop the old importer for the new one.',
      'The migration script needs a dry-run mode before launch.',
    ]);
  });

  it('drops URL-only lines, short fragments, and exact repeats', () => {
    const claims = extractClaims(
      'https://example.com/post\n' +
        'too short\n' +
        'A real claim that says something worth keeping later.\n' +
        'A real claim that says something worth keeping later.',
    );
    expect(claims).toEqual(['A real claim that says something worth keeping later.']);
  });

  it('caps at six claims per source (spec §10.2 volume rule)', () => {
    const content = Array.from(
      { length: 12 },
      (_, i) => `Claim number ${i} says something distinct about topic ${i}.`,
    ).join('\n');
    expect(extractClaims(content)).toHaveLength(6);
  });
});

describe('localVector', () => {
  it('is deterministic and unit-length', () => {
    const a = localVector('The same sentence every time.', base.memories);
    const b = localVector('The same sentence every time.', base.memories);
    expect(a).toEqual(b);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(a).toHaveLength(base.memories[0]!.vector.length);
  });

  it('lands lexical echoes near their anchors and aliens far from everything', () => {
    const echo = localVector(
      'Decided to drop LangChain for direct SDK calls in the agent runtime.',
      base.memories,
    );
    const alien = localVector('Sourdough starter hydration schedule for the weekend bake.', base.memories);

    const nearest = (v: number[]) => Math.max(...base.memories.map((m) => cosine(v, m.vector)));
    expect(nearest(echo)).toBeGreaterThan(0.28); // files into an existing category
    expect(nearest(echo)).toBeLessThan(DUPLICATE_SIMILARITY); // but is not a duplicate
    expect(nearest(alien)).toBeLessThan(0.24); // opens its own category
  });

  it('scores disjoint texts at zero lexical similarity', () => {
    expect(lexicalSimilarity('alpha beta gamma', 'delta epsilon zeta')).toBe(0);
  });
});

describe('runBatchPipeline', () => {
  it('attaches echoes to existing categories and opens new ones for aliens', () => {
    const result = runBatchPipeline(base, [AI_NOTE, ALIEN_NOTE], NOW);

    expect(result.sourceIds).toHaveLength(2);
    expect(result.addedMemoryIds.length).toBeGreaterThan(0);
    expect(result.payload.memories.length).toBe(
      base.memories.length + result.addedMemoryIds.length,
    );

    const existing = result.categories.filter((c) => !c.isNew);
    const opened = result.categories.filter((c) => c.isNew);
    expect(existing.length).toBeGreaterThan(0);
    expect(opened.length).toBeGreaterThan(0);

    // Opened categories carry a sayable name, not a placeholder or a container.
    for (const c of opened) {
      expect(c.name).not.toBe('');
      expect(c.name.toLowerCase()).not.toBe('miscellaneous');
      expect(c.name.split(/\s+/).length).toBeLessThanOrEqual(3);
    }
  });

  it('never produces two categories with the same name', () => {
    const result = runBatchPipeline(base, [AI_NOTE, ALIEN_NOTE], NOW);
    const names = result.payload.categories.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the taxonomy two levels deep (spec 8.5)', () => {
    const result = runBatchPipeline(base, [AI_NOTE, ALIEN_NOTE], NOW);
    const byId = new Map(result.payload.categories.map((c) => [c.id, c]));
    for (const c of result.payload.categories) {
      if (c.parent_id === null) continue;
      expect(byId.get(c.parent_id)!.parent_id).toBeNull();
    }
  });

  it('re-dropping the same batch writes nothing the second time', () => {
    const first = runBatchPipeline(base, [AI_NOTE, ALIEN_NOTE], NOW);
    const second = runBatchPipeline(first.payload, [AI_NOTE, ALIEN_NOTE], NOW);

    expect(second.addedMemoryIds).toHaveLength(0);
    expect(second.skippedCount).toBe(second.claimCount);
    expect(second.payload.memories).toHaveLength(first.payload.memories.length);
  });

  it('runs the gates to convergence, capped, and reports every operation', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      title: `note ${i}`,
      content: `Braintrust eval harness observation number ${i} about the agent tooling stack.`,
    }));
    const result = runBatchPipeline(base, items, NOW);
    // A first fill may settle through several operations — but never past the cap.
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeLessThanOrEqual(5);
  });

  it('respects auto_reorganize off — memories file, structure holds still', () => {
    const frozen = {
      ...base,
      workspace: { ...base.workspace, auto_reorganize: false },
    };
    const result = runBatchPipeline(frozen, [AI_NOTE, ALIEN_NOTE], NOW);
    expect(result.events).toHaveLength(0);
    expect(result.addedMemoryIds.length).toBeGreaterThan(0);
  });

  it('marks a source that yields nothing as no_memories, never dropping it', () => {
    const result = runBatchPipeline(base, [{ title: 'empty', content: 'short\nhttps://x.co' }], NOW);
    const source = result.payload.sources.find((s) => result.sourceIds.includes(s.id))!;
    expect(source.status).toBe('no_memories');
    expect(result.addedMemoryIds).toHaveLength(0);
  });
});
