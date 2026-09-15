import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { isReflectiveQuestion, recentSample, REFLECTIVE_DAYS } from '../../src/core/reflect';

/**
 * "What have I been into lately?" has no memory that resembles it — retrieval
 * finds nothing and the pipeline refuses. But it is exactly the question a
 * memory should be able to answer by looking around: the last two weeks,
 * grouped by interest, biggest first.
 */
const payload = validateSeed(workspaceJson);

describe('isReflectiveQuestion', () => {
  it('hears the Korean ways of asking what has been on my mind', () => {
    for (const q of [
      '내가 요즘 관심있는게 뭐야?',
      '요즘 나 뭐에 빠져 있지',
      '최근에 내가 저장한 것들 어떤 거야',
      '요새 무슨 생각 많이 했어?',
      '이번 주에 뭐 기억해뒀어?',
    ]) expect(isReflectiveQuestion(q), q).toBe(true);
  });

  it('hears the English ways too', () => {
    for (const q of [
      'What have I been into lately?',
      "what's been on my mind recently",
      'What am I interested in these days?',
      'what did I save this week',
    ]) expect(isReflectiveQuestion(q), q).toBe(true);
  });

  it('leaves ordinary questions to retrieval', () => {
    for (const q of [
      'What did we decide about our eval stack?',
      '성수동 카페 이름이 뭐였지?',
      'How much runway should a seed buy?',
      '요즘 트렌드인 러닝화 이름이 뭐야?',
    ]) expect(isReflectiveQuestion(q), q).toBe(false);
  });
});

describe('recentSample', () => {
  it('takes the fortnight behind the newest memory, interests biggest first', () => {
    const sample = recentSample(payload);
    const newest = payload.memories.map((m) => m.created_at).sort().at(-1)!;
    expect(sample.to).toBe(newest.slice(0, 10));
    const cutoff = Date.parse(newest) - REFLECTIVE_DAYS * 864e5;
    for (const m of sample.picks) expect(Date.parse(m.created_at)).toBeGreaterThanOrEqual(cutoff);
    const counts = sample.interests.map((i) => i.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(sample.interests[0]!.name.length).toBeGreaterThan(0);
  });

  it('spreads the picks across interests rather than draining the biggest', () => {
    const sample = recentSample(payload, { cap: 6 });
    expect(sample.picks.length).toBeLessThanOrEqual(6);
    const perCategory = new Map<string, number>();
    for (const m of sample.picks) perCategory.set(m.category_id, (perCategory.get(m.category_id) ?? 0) + 1);
    if (sample.interests.length > 1) expect(perCategory.size).toBeGreaterThan(1);
  });

  it('an empty corpus has nothing to look back on', () => {
    const empty = { ...payload, memories: [] };
    const sample = recentSample(empty);
    expect(sample.picks).toEqual([]);
    expect(sample.interests).toEqual([]);
    expect(sample.from).toBeNull();
  });
});

describe('the seed answerer looks around too', () => {
  it('answers a reflective question from the counts, with citations that resolve', async () => {
    const { answerQuestion, REFUSAL } = await import('../../src/ask/scriptedAsk');
    const result = answerQuestion('내가 요즘 관심있는게 뭐야?', payload);
    expect(result.refused).toBe(false);
    expect(result.answer).not.toBe(REFUSAL);
    expect(result.answer).toContain(recentSample(payload).interests[0]!.name);
    expect(result.citations.length).toBeGreaterThan(0);
    for (const c of result.citations) {
      expect(payload.memories.some((m) => m.id === c.memory_id)).toBe(true);
      expect(result.highlighted_node_ids).toContain(c.memory_id);
    }
    expect(result.answer).toMatch(/\[1\]/);
  });

  it('an ordinary question still goes to the script', async () => {
    const { answerQuestion } = await import('../../src/ask/scriptedAsk');
    expect(answerQuestion('What did we decide about our eval stack?', payload).refused).toBe(false);
    expect(answerQuestion('What is the capital of France?', payload).refused).toBe(true);
  });
});

describe('the demo answers speak Korean in the memory’s own register', () => {
  it('every scripted answer has a Korean twin with the same citations', async () => {
    const { answerQuestion } = await import('../../src/ask/scriptedAsk');
    const { setLocaleForTest: setLocale } = await import('../../src/i18n');
    const { KO_ANSWERS } = await import('../../src/ask/answersKo');
    const answers = (await import('../../seed/answers.json')).default as { match: string[]; answer: string }[];
    for (const a of answers) {
      const ko = KO_ANSWERS[a.match.join('+')];
      expect(ko, a.match.join('+')).toBeTruthy();
      const enMarks = a.answer.match(/\[\d+\]/g)!.sort();
      expect(ko!.match(/\[\d+\]/g)!.sort()).toEqual(enMarks);
      expect(ko).not.toMatch(/하셨습니다|당신/);
    }
    setLocale('ko');
    try {
      const result = answerQuestion('What did we decide about our eval stack?', payload);
      expect(result.answer).toMatch(/LangChain/);
      expect(result.answer).toMatch(/였지|잖아|했지|거야|있어/);
    } finally {
      setLocale('en');
    }
  });
});
