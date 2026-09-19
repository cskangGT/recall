import { useMemo, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';
import { groupMeetings, attendeeLine, isOver } from '../core/meetings';
import { readStep, writeStep, type OnboardingStep } from '../core/onboarding';
import { SourceChips } from './SourceChips';
import { t, PRODUCT } from '../i18n';
import type { GraphPayload, Memory } from '../core/types';

/**
 * The first hour.
 *
 * The greeting used to be a menu — four kinds of thing, pick one, find the
 * way in. A menu has no moment in it: nothing on the screen had read
 * anything of yours until you had found a file to give it. So the first
 * screen now asks for the cheapest thing a person has — one thought, typed —
 * and answers it in the memory's own voice: what it kept, what kind of thing
 * it was, where it put it. That is the whole product in thirty seconds.
 *
 * Two optional beats follow, each with its own payoff: the calendar (the
 * week, read back) where the server has that door, and what has piled up
 * (the bulk reveal). Every beat can be skipped, and "look around first"
 * skips them all. The step survives a trip to Google's consent screen
 * (core/onboarding), and however the greeting is left, ArcBrowser closes
 * the hour and stamps the first day for the card home shows next.
 */

const CONCERN_KINDS = new Set<Memory['kind']>(['question', 'decision', 'task']);
const KIND_KEY = {
  question: 'briefing.kind.question',
  decision: 'briefing.kind.decision',
  task: 'briefing.kind.task',
} as const;

/** A quoted memory should read as a quote, not a paragraph. */
const QUOTE_CHARS = 64;
const quote = (text: string) => (text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS - 1)}…` : text);

/** What the memory says back about the thought it was just handed. */
function replyFor(payload: GraphPayload, addedIds: string[]): string[] {
  const added = addedIds
    .map((id) => payload.memories.find((m) => m.id === id))
    .filter((m): m is Memory => m !== undefined);
  const first = added[0];
  if (!first) return [t('welcome.read.nothing')];

  const took = added.length === 1 ? t('welcome.read.took.one') : t('welcome.read.took', { count: added.length });
  // A question, a decision or a task is what the briefing calls "on the
  // table" — say so, because that is where they will meet it tomorrow.
  const concern = added.find((m) => CONCERN_KINDS.has(m.kind));
  const where = concern
    ? t('welcome.read.concern', {
        text: quote(concern.text),
        kind: t(KIND_KEY[concern.kind as keyof typeof KIND_KEY]),
      })
    : t('welcome.read.filed', {
        text: quote(first.text),
        category: payload.categories.find((c) => c.id === first.category_id)?.name ?? '',
      });
  return [took, where, t('welcome.read.ask')];
}

export function Welcome() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const canConnect = Boolean(useWorkspaceStore((s) => s.source.connectGoogle));
  const dismissWelcome = useUiStore((s) => s.dismissWelcome);

  const [step, setStep] = useState<OnboardingStep>(() => {
    const stored = readStep();
    return stored === 'done' ? 'thought' : stored;
  });
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState(false);
  const [reply, setReply] = useState<string[] | null>(null);
  const [connecting, setConnecting] = useState(false);

  // A step whose door this server does not have is not drawn — it is passed.
  const current: OnboardingStep = step === 'calendar' && !canConnect ? 'pile' : step;
  const steps: OnboardingStep[] = canConnect ? ['thought', 'calendar', 'pile'] : ['thought', 'pile'];

  const go = (next: OnboardingStep) => {
    writeStep(next);
    setStep(next);
  };
  const after = (from: OnboardingStep): OnboardingStep => steps[steps.indexOf(from) + 1] ?? 'done';
  const advance = () => {
    const next = after(current);
    if (next === 'done') dismissWelcome();
    else go(next);
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content || reading) return;
    setReading(true);
    try {
      const store = useWorkspaceStore.getState();
      const title = t('welcome.firstTitle');
      let addedIds: string[] = [];
      if (store.source.capture) {
        const result = await store.source.capture({ type: 'text', title, content });
        store.applyPayload(result.graph);
        addedIds = result.addedMemoryIds ?? [];
      } else {
        // Seed mode: the same thought through the local pipeline — quietly,
        // the way the diary does it. One line does not deserve the bulk reveal.
        const result = runBatchPipeline(store.payload!, [{ title, content }]);
        store.applyPayload(result.payload);
        addedIds = result.addedMemoryIds;
      }
      const next = useWorkspaceStore.getState().payload;
      setReply(next ? replyFor(next, addedIds) : [t('welcome.read.nothing')]);
      // The hour has begun: from here on, leaving the greeting is a first day.
      if (addedIds.length > 0) writeStep('thought');
      setDraft('');
    } catch {
      useUiStore.getState().toast(t('toast.captureFailed'));
    } finally {
      setReading(false);
    }
  };

  const connect = async () => {
    const source = useWorkspaceStore.getState().source;
    if (!source.connectGoogle || connecting) return;
    setConnecting(true);
    try {
      // Remember the beat before leaving for Google; the return lands on it.
      writeStep('calendar');
      const { url } = await source.connectGoogle();
      window.location.assign(url);
    } catch {
      useUiStore.getState().toast(t('toast.googleFailed'));
      setConnecting(false);
    }
  };

  /* The week, read back — what is still ahead between now and Sunday. */
  const week = useMemo(() => {
    if (!meetings?.connected) return null;
    const now = new Date();
    const ahead = groupMeetings(meetings.meetings, now)
      .filter((g) => g.key === 'today' || g.key === 'tomorrow' || g.key === 'week')
      .flatMap((g) => g.meetings)
      .filter((m) => !isOver(m, now));
    return { count: ahead.length, first: ahead[0] ?? null };
  }, [meetings]);

  if (!payload) return null;

  return (
    <div className="arc__greeting" data-testid="welcome" data-step={current}>
      <span className="welcome__step" data-testid="welcome-step">
        {t('welcome.step', { n: steps.indexOf(current) + 1, total: steps.length })}
      </span>

      {current === 'thought' && (
        <>
          <p className="arc__greeting-line">{t('welcome.brain', { product: PRODUCT })}</p>
          {/* Once it has been answered, the ask steps back — the reply is the screen. */}
          {!reply && <p className="arc__greeting-aside">{t('welcome.first')}</p>}
          {reply ? (
            <div className="welcome__reply" data-testid="welcome-reply">
              {reply.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : (
            <textarea
              id="welcome-first-input"
              className="welcome__input"
              data-testid="welcome-first-input"
              aria-label={t('welcome.firstTitle')}
              placeholder={t('welcome.firstPlaceholder')}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  // Hand the keyboard back, like the composer does.
                  e.stopPropagation();
                  e.currentTarget.blur();
                  return;
                }
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                void submit();
              }}
            />
          )}
          <div className="welcome__actions">
            {reply ? (
              <>
                <button className="arc__source" data-testid="welcome-next" onClick={advance}>
                  {t('welcome.next')}
                </button>
                <button className="welcome__quiet" data-testid="welcome-another" onClick={() => setReply(null)}>
                  {t('welcome.another')}
                </button>
              </>
            ) : (
              <button
                className="arc__source"
                data-testid="welcome-first-send"
                disabled={reading || draft.trim().length === 0}
                onClick={() => void submit()}
              >
                {reading ? t('stage.reading') : t('welcome.firstSend')}
              </button>
            )}
          </div>
        </>
      )}

      {current === 'calendar' && (
        <>
          <p className="arc__greeting-line">{t('meetings.connect.title')}</p>
          {week ? (
            <p className="arc__greeting-aside" data-testid="welcome-week">
              {week.first
                ? t('welcome.calendar.week', {
                    count: week.count,
                    title: week.first.title,
                    who: attendeeLine(week.first) || t('meetings.group.today'),
                  })
                : t('welcome.calendar.empty')}
            </p>
          ) : (
            <p className="arc__greeting-aside">{t('welcome.calendar.line', { product: PRODUCT })}</p>
          )}
          <div className="welcome__actions">
            {week ? (
              <button className="arc__source" data-testid="welcome-next" onClick={advance}>
                {t('welcome.next')}
              </button>
            ) : (
              <>
                <button
                  className="arc__source"
                  data-testid="welcome-connect"
                  disabled={connecting}
                  onClick={() => void connect()}
                >
                  {t('meetings.connect.cta')}
                </button>
                <button className="welcome__quiet" data-testid="welcome-later" onClick={advance}>
                  {t('welcome.calendar.later')}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {current === 'pile' && (
        <>
          <p className="arc__greeting-line">{t('welcome.pile.line', { product: PRODUCT })}</p>
          <SourceChips />
          <div className="welcome__actions">
            <button
              className="welcome__quiet"
              data-testid="welcome-paste"
              onClick={() => useUiStore.getState().setCaptureOpen(true)}
            >
              {t('welcome.unfold.pasteLink')}
            </button>
            <span className="arc__unfold-aside">{t('welcome.unfold.dropToo')}</span>
          </div>
          <div className="welcome__actions">
            <button className="arc__source" data-testid="welcome-finish" onClick={dismissWelcome}>
              {t('welcome.pile.later')}
            </button>
          </div>
        </>
      )}

      {current === 'thought' && !reply && payload.memories.length > 0 && (
        <button className="arc__browse" data-testid="door-browse" onClick={() => useUiStore.getState().goBrowse()}>
          <span className="arc__browse-name">{t('welcome.browse')}</span>
          <span className="arc__browse-hint">
            {t('welcome.browseHint', { memories: payload.memories.length })}
          </span>
        </button>
      )}
    </div>
  );
}
