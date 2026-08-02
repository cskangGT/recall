import { describe, it, expect } from 'vitest';
import { partitionDuplicates } from '../../src/capture/duplicate';
import { DUPLICATE_SIMILARITY } from '../../src/core/thresholds';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { Memory } from '../../src/core/types';

const payload = validateSeed(workspaceJson);
const demoMemories = demoItem.memories as unknown as Memory[];

/** A unit vector at a chosen cosine from `base`, in a fresh direction. */
function at(base: number[], similarity: number, axis: number): number[] {
  const v = base.map((x) => x * similarity);
  v[axis] = (v[axis] ?? 0) + Math.sqrt(1 - similarity ** 2);
  return v;
}

const mem = (id: string, vector: number[]) => ({ id, vector }) as unknown as Memory;

describe('partitionDuplicates', () => {
  const base = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0));

  it('keeps everything when the corpus is empty', () => {
    const v = partitionDuplicates([mem('a', base)], []);
    expect(v.kept).toHaveLength(1);
    expect(v.skipped).toHaveLength(0);
  });

  it('skips a candidate that matches something already held', () => {
    const v = partitionDuplicates([mem('new', base)], [mem('old', base)]);
    expect(v.kept).toHaveLength(0);
    expect(v.skipped[0]!.of.id).toBe('old');
    expect(v.skipped[0]!.similarity).toBeCloseTo(1, 6);
  });

  it('keeps a candidate that is merely nearby', () => {
    const nearby = at(base, DUPLICATE_SIMILARITY - 0.05, 3);
    expect(partitionDuplicates([mem('new', nearby)], [mem('old', base)]).kept).toHaveLength(1);
  });

  it('is inclusive at the threshold — at it is already the same thing', () => {
    const exactly = at(base, DUPLICATE_SIMILARITY, 3);
    expect(partitionDuplicates([mem('new', exactly)], [mem('old', base)]).skipped).toHaveLength(1);
  });

  /**
   * A source that says the same thing twice would otherwise sail through: both
   * copies are new to the corpus, and only one of them should survive.
   */
  it('catches a batch that duplicates itself', () => {
    const v = partitionDuplicates([mem('a', base), mem('b', base)], []);
    expect(v.kept.map((m) => m.id)).toEqual(['a']);
    expect(v.skipped[0]!.of.id).toBe('a');
  });

  it('keeps the first occurrence, whichever order the batch arrives in', () => {
    const forward = partitionDuplicates([mem('a', base), mem('b', base)], []);
    const backward = partitionDuplicates([mem('b', base), mem('a', base)], []);
    expect(forward.kept).toHaveLength(1);
    expect(backward.kept).toHaveLength(1);
    expect(backward.kept[0]!.id).toBe('b');
  });

  it('reports what each skipped candidate duplicated, not merely that it did', () => {
    const other = at(base, 0.1, 5);
    const v = partitionDuplicates([mem('new', base)], [mem('unrelated', other), mem('old', base)]);
    expect(v.skipped[0]!.of.id).toBe('old');
  });
});

describe('the shipped corpus', () => {
  /**
   * The safety argument, asserted rather than remembered.
   *
   * A false positive here is silent data loss — something pasted, judged
   * already held, and never saved. The whole defence is that the closest pair
   * of genuinely distinct memories sits far below the threshold. Measured at
   * 0.5597 against a cutoff of 0.68; if the corpus ever grows a pair that
   * crosses it, this fails before a user does.
   */
  it('contains no two memories the threshold would call the same', () => {
    let worst = { similarity: 0, a: '', b: '' };
    for (let i = 0; i < payload.memories.length; i++) {
      const v = partitionDuplicates(
        [payload.memories[i]!],
        payload.memories.filter((_, j) => j !== i),
      );
      const hit = v.skipped[0];
      if (hit && hit.similarity > worst.similarity) {
        worst = { similarity: hit.similarity, a: payload.memories[i]!.id, b: hit.of.id };
      }
    }
    expect(worst, `${worst.a} and ${worst.b} would be treated as one memory`).toEqual({
      similarity: 0,
      a: '',
      b: '',
    });
  });

  /**
   * The demo must be untouched. Its two memories score 0.3567 and 0.3304
   * against the corpus, so nothing is skipped and the eighteen assertions on
   * 47/49 memory counts elsewhere do not move. If this fails, the demo is being
   * de-duplicated and the threshold is wrong.
   */
  it('does not treat the demo capture as something already saved', () => {
    const v = partitionDuplicates(demoMemories, payload.memories);
    expect(v.kept).toHaveLength(2);
    expect(v.skipped).toHaveLength(0);
  });

  /** Re-running the same capture is the case this exists for. */
  it('skips the demo capture the second time it arrives', () => {
    const once = [...payload.memories, ...demoMemories];
    const v = partitionDuplicates(demoMemories, once);
    expect(v.kept).toHaveLength(0);
    expect(v.skipped).toHaveLength(2);
    expect(v.skipped.every((s) => s.similarity > 0.99)).toBe(true);
  });
});
