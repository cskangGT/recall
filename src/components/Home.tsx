import { useMemo, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { briefingOf } from '../core/briefing';
import { groupMeetings, isOver } from '../core/meetings';
import { SourceChips } from './SourceChips';
import { t, PRODUCT } from '../i18n';

/**
 * Home.
 *
 * Where the logo goes and where the app opens: the sky, one question, and a
 * few doors hung in it as stars. Nothing here is a report — the first
 * attempt at home was a briefing, and a briefing is a page you go to, not a
 * place you arrive. So the briefing became the first door ("start today"),
 * and home went back to being the quiet room the doors open from: the day,
 * the pile, the memory, the diary. The question at the bottom of the screen
 * is, as everywhere, the fifth.
 *
 * The first door says what is behind it in a few counts, so the day is
 * glanceable from here without being laid out here.
 */
export function Home() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const [fillOpen, setFillOpen] = useState(false);

  const todayHint = useMemo(() => {
    if (!payload) return '';
    const brief = briefingOf(payload);
    const now = new Date();
    const ahead = meetings?.connected
      ? (groupMeetings(meetings.meetings, now).find((g) => g.key === 'today')?.meetings ?? []).filter(
          (m) => !isOver(m, now),
        ).length
      : 0;
    const parts = [
      ahead > 0 ? t('briefing.sum.meetings', { count: ahead }) : null,
      brief.concerns.length > 0 ? t('briefing.sum.concerns', { count: brief.concerns.length }) : null,
      brief.organizing.awaitingReview > 0 ? t('briefing.sum.review', { count: brief.organizing.awaitingReview }) : null,
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.slice(0, 2).join(' · ') : t('home.todayHint');
  }, [payload, meetings]);

  if (!payload) return null;
  const ui = useUiStore.getState();
  const empty = payload.memories.length === 0;
  const topLevel = payload.categories.filter((c) => c.parent_id === null).length;

  const door = (i: number, testId: string, name: string, hint: string, go: () => void, lead = false) => (
    <button
      className={`arc__door${lead ? ' arc__door--fill' : ''}`}
      style={{ '--i': i } as React.CSSProperties}
      data-testid={testId}
      onClick={go}
    >
      <span className="arc__door-star" aria-hidden="true" />
      <span className="arc__door-name">{name}</span>
      <span className="arc__door-hint">{hint}</span>
    </button>
  );

  return (
    <div className="arc__greeting arc__greeting--home" data-testid="home">
      <p className="arc__greeting-line">{t('home.title')}</p>
      <p className="arc__greeting-aside">
        {empty
          ? t('welcome.emptyPrompt')
          : t('home.aside', { sources: payload.sources.length, memories: payload.memories.length })}
      </p>
      <div className="arc__doors" data-testid="home-doors">
        {door(0, 'door-today', t('home.today'), todayHint, () => ui.goToday(), true)}
        {door(1, 'door-fill', t('home.fill'), t('home.fillHint', { product: PRODUCT }), () => setFillOpen((v) => !v))}
        {!empty &&
          door(2, 'door-memory', t('home.memory'), t('home.memoryHint', { count: topLevel }), () => ui.goBrowse())}
        {door(3, 'door-diary', t('home.diary'), t('home.diaryHint'), () => ui.setView('diary'))}
      </div>
      {fillOpen && <SourceChips />}
    </div>
  );
}
