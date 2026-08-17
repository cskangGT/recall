import { describe, it, expect, beforeEach } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { extractClaims } from '../../src/capture/extractLocal';
import { relatedMemories } from '../../src/core/related';
import { runBatchPipeline, resetBatchIds } from '../../src/capture/batch';
import { RELATES_TO_MIN_SIMILARITY } from '../../src/core/thresholds';

/**
 * The memory charter, as executable rules:
 * - packaging (CTAs, hashtags, promo) never becomes a memory
 * - a duplicate arrival reinforces (times_seen), never repeats
 * - relatedness is visible, at the same floor the map draws edges with
 */

const base = validateSeed(workspaceJson);
const NOW = '2026-08-07T00:00:00.000Z';

beforeEach(() => resetBatchIds());

describe('charter: packaging is not content', () => {
  it('drops calls to action in both languages', () => {
    const claims = extractClaims(
      [
        '오토리즈 시간을 두 배로 늘렸더니 빵 기공이 눈에 띄게 좋아졌다.',
        '더 많은 꿀팁은 팔로우하고 저장해 두세요!',
        'Doubling the autolyse window made the crumb noticeably more open.',
        'Follow for more tips and save this post for later reference.',
      ].join('\n'),
    );
    expect(claims).toEqual([
      '오토리즈 시간을 두 배로 늘렸더니 빵 기공이 눈에 띄게 좋아졌다.',
      'Doubling the autolyse window made the crumb noticeably more open.',
    ]);
  });

  it('drops hashtag piles and profile-link lines', () => {
    const claims = extractClaims(
      [
        '#베이킹 #홈베이킹 #sourdough #빵스타그램 오늘도 굽기',
        '자세한 레시피 링크는 프로필에 있어요.',
        'A real observation about proofing time that deserves to be kept.',
      ].join('\n'),
    );
    expect(claims).toEqual(['A real observation about proofing time that deserves to be kept.']);
  });
});

describe('charter: duplicates reinforce', () => {
  const NOTE = {
    title: '베이킹 노트',
    content: '사워도우 반죽이 스타터 부족으로 밤새 무너졌다.\n오토리즈 시간을 두 배로 늘렸더니 빵 기공이 눈에 띄게 좋아졌다.',
  };

  it('a re-dropped batch bumps times_seen on the held memories', () => {
    const first = runBatchPipeline(base, [NOTE], NOW);
    expect(first.addedMemoryIds.length).toBeGreaterThan(0);

    resetBatchIds();
    const second = runBatchPipeline(first.payload, [NOTE], NOW);
    expect(second.addedMemoryIds).toHaveLength(0);

    const reinforced = second.payload.memories.filter((m) => (m.times_seen ?? 1) > 1);
    expect(reinforced.length).toBe(first.addedMemoryIds.length);
    for (const m of reinforced) expect(m.times_seen).toBe(2);
  });

  it('a third arrival counts to three — the importance signal accumulates', () => {
    const first = runBatchPipeline(base, [NOTE], NOW);
    resetBatchIds();
    const second = runBatchPipeline(first.payload, [NOTE], NOW);
    resetBatchIds();
    const third = runBatchPipeline(second.payload, [NOTE], NOW);
    const most = Math.max(...third.payload.memories.map((m) => m.times_seen ?? 1));
    expect(most).toBe(3);
  });
});

describe('charter: relatedness is visible', () => {
  it('lists nearest memories above the same floor the map draws with', () => {
    // Find a memory that has at least one relates_to edge in the seed.
    const edge = base.edges[0]!;
    const related = relatedMemories(base, edge.source_memory_id);
    expect(related.length).toBeGreaterThan(0);
    for (const r of related) {
      expect(r.similarity).toBeGreaterThanOrEqual(RELATES_TO_MIN_SIMILARITY);
      expect(r.memory.id).not.toBe(edge.source_memory_id);
    }
    // Best first.
    const sims = related.map((r) => r.similarity);
    expect([...sims].sort((a, b) => b - a)).toEqual(sims);
  });

  it('excludes same-source siblings — provenance is not relatedness', () => {
    const anchor = base.memories[0]!;
    for (const r of relatedMemories(base, anchor.id)) {
      expect(r.memory.source_id).not.toBe(anchor.source_id);
    }
  });
});
