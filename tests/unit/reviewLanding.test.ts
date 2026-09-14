import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { landingOf } from '../../src/capture/reviewLanding';

/**
 * Where a review lands when it is done: the category that took most of
 * what this source produced, with one of those memories selected — so
 * "where did it go?" is answered by the screen, not by a toast alone.
 */
const payload = validateSeed(workspaceJson);

describe('landingOf', () => {
  it('picks the category holding most of the source’s memories, and a memory in it', () => {
    // src_seed_deck_notes: both memories live in cat_investor_notes.
    const landing = landingOf(payload, 'src_seed_deck_notes')!;
    expect(landing.categoryId).toBe('cat_investor_notes');
    const memory = payload.memories.find((m) => m.id === landing.memoryId)!;
    expect(memory.source_id).toBe('src_seed_deck_notes');
    expect(memory.category_id).toBe('cat_investor_notes');
  });

  it('breaks a tie toward the memory that comes first', () => {
    const split = {
      ...payload,
      memories: payload.memories.map((m, i) =>
        m.source_id === 'src_pitch_review' && i % 2 === 0 ? { ...m, category_id: 'cat_ai_tooling' } : m,
      ),
    };
    const first = split.memories.find((m) => m.source_id === 'src_pitch_review')!;
    expect(landingOf(split, 'src_pitch_review')!.categoryId).toBe(first.category_id);
  });

  it('nowhere to land when the source kept nothing, or is unknown', () => {
    expect(landingOf(payload, 'src_nope')).toBeNull();
    const emptied = {
      ...payload,
      memories: payload.memories.filter((m) => m.source_id !== 'src_seed_deck_notes'),
    };
    expect(landingOf(emptied, 'src_seed_deck_notes')).toBeNull();
  });
});
