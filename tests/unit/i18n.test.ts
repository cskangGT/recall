import { describe, it, expect, afterEach } from 'vitest';
import { resolveLocale, t, josa, setLocaleForTest, PRODUCT } from '../../src/i18n';
import { nameTokens } from '../../src/core/naming';
import { extractClaims } from '../../src/capture/extractLocal';
import { runBatchPipeline, resetBatchIds } from '../../src/capture/batch';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';

afterEach(() => setLocaleForTest('en'));

describe('resolveLocale', () => {
  it('the URL wins, then the stored choice, then the region, then English', () => {
    expect(resolveLocale('?lang=ko', 'en', 'en-US', 'America/New_York')).toBe('ko');
    expect(resolveLocale('?lang=en', 'ko', 'ko-KR', 'Asia/Seoul')).toBe('en');
    expect(resolveLocale('', 'ko', 'en-US', 'America/New_York')).toBe('ko');
    expect(resolveLocale('', null, 'ko-KR', 'Asia/Seoul')).toBe('ko');
    expect(resolveLocale('', null, 'fr-FR', 'Europe/Paris')).toBe('en');
  });

  it('a Seoul clock defaults to Korean even on an English-language browser', () => {
    expect(resolveLocale('', null, 'en-US', 'Asia/Seoul')).toBe('ko');
    expect(resolveLocale('', null, 'en-US', 'America/Los_Angeles')).toBe('en');
  });
});

describe('t', () => {
  it('interpolates params and speaks the product name', () => {
    expect(t('toast.added', { count: 3 })).toBe('Added 3 memories.');
    expect(t('banner.title')).toBe(`${PRODUCT} reorganized your map`);
  });

  it('switches wholesale to Korean', () => {
    setLocaleForTest('ko');
    expect(t('toast.added', { count: 3 })).toBe('기억 3개를 추가했어요.');
    expect(t('banner.title')).toContain(PRODUCT);
    expect(t('stage.reading')).toBe('읽는 중…');
  });
});

describe('josa', () => {
  it('follows the final consonant', () => {
    expect(josa('지도', '을', '를')).toBe('지도를');
    expect(josa('기억', '을', '를')).toBe('기억을');
    expect(josa('Mado', '이', '가')).toBe('Mado가'); // loanword → vowel form
  });
});

describe('Korean through the local pipeline', () => {
  const base = validateSeed(workspaceJson);

  it('nameTokens keeps Hangul and drops standalone function words', () => {
    expect(nameTokens('사워도우 반죽이 그리고 무너졌다')).toEqual(['사워도우', '반죽', '무너졌다']);
    expect(nameTokens('LangChain 대신 직접 SDK 호출')).toEqual(['langchain', '대신', '직접', 'sdk', '호출']);
  });

  it('extractClaims accepts Korean sentences at the lower word floor', () => {
    const claims = extractClaims(
      '사워도우 반죽이 밤새 무너졌다.\n짧음\n오토리즈 시간을 두 배로 늘렸더니 기공이 좋아졌다.',
    );
    expect(claims).toEqual([
      '사워도우 반죽이 밤새 무너졌다.',
      '오토리즈 시간을 두 배로 늘렸더니 기공이 좋아졌다.',
    ]);
  });

  it('a Korean batch files, names a Korean category, and dedupes on re-drop', () => {
    resetBatchIds();
    const items = [
      {
        title: '베이킹 노트',
        content:
          '사워도우 반죽이 스타터 부족으로 밤새 무너졌다.\n오토리즈 시간을 두 배로 늘렸더니 빵 기공이 눈에 띄게 좋아졌다.',
      },
    ];
    const first = runBatchPipeline(base, items, '2026-08-06T00:00:00.000Z');
    expect(first.addedMemoryIds.length).toBeGreaterThan(0);

    const opened = first.categories.filter((c) => c.isNew);
    expect(opened.length).toBeGreaterThan(0);
    for (const c of opened) expect(c.name.length).toBeGreaterThan(0);

    resetBatchIds();
    const second = runBatchPipeline(first.payload, items, '2026-08-06T00:00:00.000Z');
    expect(second.addedMemoryIds).toHaveLength(0);
  });
});
