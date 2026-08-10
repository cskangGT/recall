import { describe, it, expect } from 'vitest';
import { keywordsFor, filterByKeywords, memoryMatches } from '../../src/arc/keywords';
import type { GraphPayload, Memory } from '../../src/core/types';

/**
 * The keyword lens: chips derived from what is on screen, each pick narrowing
 * the list and re-deriving the chips from what remains. The rules under test:
 * chips must discriminate (never match everything, never match one thing in a
 * big set), Korean stems match their inflected forms, entities outrank bare
 * terms, and selected keywords never reappear as chips.
 */

let seq = 0;
const mem = (text: string, entity_ids: string[] = []): Memory => ({
  id: `m${++seq}`,
  source_id: 's1',
  text,
  kind: 'fact',
  confidence: 0.8,
  category_id: 'c1',
  category_locked: false,
  entity_ids,
  vector: [1, 0],
  x: null,
  y: null,
  pinned: false,
  created_at: '2026-08-01T00:00:00.000Z',
});

const payloadWith = (memories: Memory[], entities: GraphPayload['entities'] = []): GraphPayload =>
  ({
    workspace: { id: 'w', name: 'w', auto_reorganize: true },
    sources: [],
    memories,
    categories: [],
    entities,
    edges: [],
  }) as unknown as GraphPayload;

const entity = (id: string, name: string): GraphPayload['entities'][number] => ({
  id,
  name,
  kind: 'tool',
  x: null,
  y: null,
  pinned: false,
});

describe('keywordsFor', () => {
  it('ranks by how many memories a chip would keep', () => {
    const memories = [
      mem('채용 파이프라인을 다시 설계했다'),
      mem('채용 면접 루프가 너무 길다'),
      mem('채용 공고 문구를 고쳤다'),
      mem('에이전트 평가 도구를 비교했다'),
      mem('에이전트 런타임을 교체했다'),
      mem('디자인 시스템 토큰 정리'),
    ];
    const chips = keywordsFor(memories, [], payloadWith(memories));
    expect(chips[0]!.label).toBe('채용');
    expect(chips[0]!.count).toBe(3);
    expect(chips[1]!.label).toBe('에이전트');
    expect(chips[1]!.count).toBe(2);
  });

  it('drops chips that match everything — they narrow nothing', () => {
    const memories = [
      mem('러닝 기록: 5km'),
      mem('러닝 페이스 개선'),
      mem('러닝화 교체 시기'),
      mem('러닝 후 스트레칭'),
    ];
    const chips = keywordsFor(memories, [], payloadWith(memories));
    expect(chips.map((c) => c.label)).not.toContain('러닝');
  });

  it('matches Korean stems across particle inflections', () => {
    const memories = [
      mem('사워도우를 다시 구웠다'),
      mem('사워도우가 무너졌다'),
      mem('오토리즈 시간을 늘렸다'),
      mem('오토리즈 실험은 성공'),
      mem('밀가루 배합 메모'),
    ];
    const payload = payloadWith(memories);
    const chips = keywordsFor(memories, [], payload);
    const sourdough = chips.find((c) => c.label === '사워도우');
    expect(sourdough?.count).toBe(2);
    expect(filterByKeywords(memories, ['사워도우'], payload)).toHaveLength(2);
  });

  it('prefers an entity over a bare term at the same count', () => {
    const memories = [
      mem('Braintrust looks strong for agent evals', ['e1']),
      mem('Braintrust pricing is usage based', ['e1']),
      mem('LangChain versus direct SDK calls debated again'),
      mem('Direct SDK calls won for the runtime'),
      mem('Sourdough starter needs feeding'),
    ];
    const payload = payloadWith(memories, [entity('e1', 'Braintrust')]);
    const chips = keywordsFor(memories, [], payload);
    const braintrust = chips.find((c) => c.label === 'Braintrust');
    expect(braintrust?.kind).toBe('entity');
    expect(braintrust?.count).toBe(2);
  });

  it('never re-offers a selected keyword, and re-splits the remainder', () => {
    const memories = [
      mem('채용 면접 루프 정리'),
      mem('채용 면접 질문 은행'),
      mem('채용 공고 초안'),
      mem('디자인 리뷰 회의록'),
      mem('디자인 토큰 정리'),
    ];
    const payload = payloadWith(memories);
    const narrowed = filterByKeywords(memories, ['채용'], payload);
    expect(narrowed).toHaveLength(3);
    const chips = keywordsFor(narrowed, ['채용'], payload);
    expect(chips.map((c) => c.label)).not.toContain('채용');
    const interview = chips.find((c) => c.label === '면접');
    expect(interview?.count).toBe(2);
  });

  it('stays silent on sets too small to split', () => {
    const memories = [mem('한 줄뿐인 카테고리')];
    expect(keywordsFor(memories, [], payloadWith(memories))).toEqual([]);
  });
});

describe('memoryMatches', () => {
  it('matches through an entity link even when the text used an alias', () => {
    const m = mem('평가 도구는 이걸로 정착', ['e1']);
    const payload = payloadWith([m], [entity('e1', 'Braintrust')]);
    expect(memoryMatches(m, 'Braintrust', payload)).toBe(true);
    expect(memoryMatches(m, 'LangChain', payload)).toBe(false);
  });
});
