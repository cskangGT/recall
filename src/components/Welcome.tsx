import { useMemo, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';
import { runAsk } from '../ask/runAsk';
import { groupMeetings, attendeeLine, isOver } from '../core/meetings';
import { readStep, writeStep, readFirstPicks, writeFirstPicks, type OnboardingStep } from '../core/onboarding';
import { SourceChips } from './SourceChips';
import { t, PRODUCT } from '../i18n';
import type { Memory } from '../core/types';

/**
 * The first conversation.
 *
 * Not a tour and not a form: one thing this person cannot decide, taken all
 * the way through with Mado in a few minutes. The beats are the loop the
 * product runs every day — open, pull, keep — met once, in order, on the
 * person's own words:
 *
 *   thought  the thing they cannot decide (the stakes are theirs)
 *   why      Mado asks back; they say what is in the way — two or three
 *            lines, each a memory, each a star
 *   think    the map: those stars threaded together, and Mado's first
 *            answer tying their words into one thought; a line of it kept
 *            becomes their first category (OnboardingGuide holds that beat)
 *   learn    what just happened, in three lines; the four places; the doors
 *
 * Every beat can be passed, and "look around first" passes them all.
 */

const CONCERN_KINDS = new Set<Memory['kind']>(['question', 'decision', 'task']);
const QUOTE_CHARS = 72;
/**
 * The example in the first box. The person this is for (product spec §2)
 * works with information for a living — a founder, a knowledge worker —
 * and the examples are that person's decisions, said plainly enough that
 * any of them could be theirs: an offer, a ship date, a hire, a tool, a
 * project, a thing kept put off. A different one each visit, in turn, so a
 * second look never lands on the same one.
 */
const FIRST_EXAMPLES = [
  'welcome.firstEx.1',
  'welcome.firstEx.2',
  'welcome.firstEx.3',
  'welcome.firstEx.4',
  'welcome.firstEx.5',
  'welcome.firstEx.6',
] as const;
const EXAMPLE_TURN_KEY = 'mado.ob.exampleTurn';
function nextExample(): (typeof FIRST_EXAMPLES)[number] {
  let turn = 0;
  try {
    turn = Number(localStorage.getItem(EXAMPLE_TURN_KEY) ?? '0') || 0;
    localStorage.setItem(EXAMPLE_TURN_KEY, String(turn + 1));
  } catch {
    turn = Math.floor(Math.random() * FIRST_EXAMPLES.length);
  }
  return FIRST_EXAMPLES[turn % FIRST_EXAMPLES.length]!;
}
const quote = (text: string) => (text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS - 1)}…` : text);

/** Kept text → memory ids, through the server or the seed's own pipeline. */
async function keepText(title: string, content: string): Promise<string[]> {
  const store = useWorkspaceStore.getState();
  if (store.source.capture) {
    const result = await store.source.capture({ type: 'text', title, content });
    store.applyPayload(result.graph);
    return result.addedMemoryIds ?? [];
  }
  const result = runBatchPipeline(store.payload!, [{ title, content }]);
  store.applyPayload(result.payload);
  return result.addedMemoryIds;
}

export function Welcome() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const canConnect = Boolean(useWorkspaceStore((s) => s.source.connectGoogle));
  const dismissWelcome = useUiStore((s) => s.dismissWelcome);

  const [step, setStep] = useState<OnboardingStep>(() => {
    const stored = readStep();
    // The map beat lives on the map; landing here mid-way means it is over.
    return stored === 'done' ? 'thought' : stored === 'think' ? 'learn' : stored;
  });
  const [example] = useState(nextExample);
  const [askBackInit] = useState(() => (readStep() === 'why' ? t('welcome.askBack') : null));
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState(false);
  const [first, setFirst] = useState<Memory | null>(null);
  /** Mado's question back — the model's where there is one, the fixed line otherwise (null while it is being written). */
  const [askBack, setAskBack] = useState<string | null>(askBackInit);
  const [connecting, setConnecting] = useState(false);

  const steps: OnboardingStep[] = ['thought', 'why', 'think', 'learn'];
  const go = (next: OnboardingStep) => {
    writeStep(next);
    setStep(next);
  };

  /* Beat 1: the thing they cannot decide. */
  const submitThought = async () => {
    const content = draft.trim();
    if (!content || reading) return;
    setReading(true);
    try {
      const added = await keepText(t('welcome.firstTitle'), content);
      const next = useWorkspaceStore.getState().payload;
      const kept = added.map((id) => next?.memories.find((m) => m.id === id)).filter((m): m is Memory => m !== undefined);
      if (kept.length === 0) {
        useUiStore.getState().toast(t('welcome.read.nothing'));
        return;
      }
      writeFirstPicks(added);
      setFirst(kept.find((m) => CONCERN_KINDS.has(m.kind)) ?? kept[0]!);
      setDraft('');
      go('why');
      /*
       * The ask-back, written on their words where the server has a model
       * for it. It arrives a beat after the screen does; until then, and
       * without one, the fixed line asks.
       */
      const ask = useWorkspaceStore.getState().source.askBack;
      if (ask) {
        setAskBack(null);
        ask(content)
          .then((r) => setAskBack(r.question || t('welcome.askBack')))
          .catch(() => setAskBack(t('welcome.askBack')));
      } else {
        setAskBack(t('welcome.askBack'));
      }
    } catch {
      useUiStore.getState().toast(t('toast.captureFailed'));
    } finally {
      setReading(false);
    }
  };

  /* Beat 2: what is in the way — then straight onto the map with all of it in hand. */
  const submitWhy = async () => {
    const content = draft.trim();
    if (!content || reading) return;
    setReading(true);
    try {
      const added = await keepText(t('welcome.whyTitle'), content);
      const picks = [...readFirstPicks(), ...added];
      writeFirstPicks(picks);
      setDraft('');
      startThinking(picks);
    } catch {
      useUiStore.getState().toast(t('toast.captureFailed'));
    } finally {
      setReading(false);
    }
  };

  /*
   * Beat 3 begins: the map, with their stars picked and threaded, and Mado
   * asked the one question people do not know they can ask. The guide on
   * the map carries the beat from there (OnboardingGuide).
   */
  const startThinking = (picks: string[]) => {
    const ui = useUiStore.getState();
    writeStep('think');
    ui.setThinking(true);
    ui.setPicked(picks);
    ui.setFindMode('map', 'ask');
    ui.setView('map');
    setTimeout(() => void runAsk(t('welcome.openingQ')), 350);
  };

  const connect = async () => {
    const source = useWorkspaceStore.getState().source;
    if (!source.connectGoogle || connecting) return;
    setConnecting(true);
    try {
      writeStep('learn');
      const { url } = await source.connectGoogle();
      window.location.assign(url);
    } catch {
      useUiStore.getState().toast(t('toast.googleFailed'));
      setConnecting(false);
    }
  };

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
  const firstText = first?.text ?? payload.memories.find((m) => m.id === readFirstPicks()[0])?.text ?? '';
  const bundleName = typeof localStorage !== 'undefined' ? localStorage.getItem('mado.ob.firstBundle') : null;

  const textarea = (testId: string, placeholder: string, onSubmit: () => void) => (
    <textarea
      id="welcome-first-input"
      className="welcome__input"
      data-testid={testId}
      aria-label={placeholder}
      placeholder={placeholder}
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.currentTarget.blur();
          return;
        }
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        onSubmit();
      }}
    />
  );

  return (
    <div className="arc__greeting" data-testid="welcome" data-step={step}>
      <span className="welcome__step" data-testid="welcome-step">
        {t('welcome.step', { n: steps.indexOf(step) + 1, total: steps.length })}
      </span>

      {step === 'thought' && (
        <>
          <p className="arc__greeting-line">{t('welcome.brain', { product: PRODUCT })}</p>
          <p className="arc__greeting-aside">{t('welcome.first')}</p>
          {textarea('welcome-first-input', t(example), () => void submitThought())}
          <div className="welcome__actions">
            <button
              className="arc__source"
              data-testid="welcome-first-send"
              disabled={reading || draft.trim().length === 0}
              onClick={() => void submitThought()}
            >
              {reading ? t('stage.reading') : t('welcome.firstSend')}
            </button>
          </div>
          {payload.memories.length > 0 && (
            <button className="arc__browse" data-testid="door-browse" onClick={() => useUiStore.getState().goBrowse()}>
              <span className="arc__browse-name">{t('welcome.browse')}</span>
              <span className="arc__browse-hint">{t('welcome.browseHint', { memories: payload.memories.length })}</span>
            </button>
          )}
        </>
      )}

      {step === 'why' && (
        <>
          {/* Mado, in its own voice, asking back — the loop opens here. */}
          <p className="welcome__quote" data-testid="welcome-quote">
            {quote(firstText)}
          </p>
          <p className={`arc__greeting-line welcome__ask${askBack === null ? ' welcome__ask--writing' : ''}`} data-testid="welcome-ask">
            {askBack ?? t('welcome.askBackWriting')}
          </p>
          <p className="arc__greeting-aside">{t('welcome.askBackHint')}</p>
          {textarea('welcome-why-input', t('welcome.whyPlaceholder'), () => void submitWhy())}
          <div className="welcome__actions">
            <button
              className="arc__source"
              data-testid="welcome-why-send"
              disabled={reading || draft.trim().length === 0}
              onClick={() => void submitWhy()}
            >
              {reading ? t('stage.reading') : t('welcome.whySend')}
            </button>
            <button
              className="welcome__quiet"
              data-testid="welcome-why-skip"
              onClick={() => startThinking(readFirstPicks())}
            >
              {t('welcome.whySkip')}
            </button>
          </div>
        </>
      )}

      {step === 'learn' && (
        <>
          <p className="arc__greeting-line">{t('welcome.learn.title')}</p>
          <p className="arc__greeting-aside">
            {bundleName ? t('welcome.learn.asideBundle', { name: bundleName, product: PRODUCT }) : t('welcome.learn.aside', { product: PRODUCT })}
          </p>
          <dl className="welcome__places" data-testid="welcome-places">
            <div>
              <dt>{t('welcome.place.home')}</dt>
              <dd>{t('welcome.place.homeHint')}</dd>
            </div>
            <div>
              <dt>{t('welcome.place.today')}</dt>
              <dd>{t('welcome.place.todayHint')}</dd>
            </div>
            <div>
              <dt>{t('welcome.place.memory')}</dt>
              <dd>{t('welcome.place.memoryHint')}</dd>
            </div>
            <div>
              <dt>{t('welcome.place.diary')}</dt>
              <dd>{t('welcome.place.diaryHint')}</dd>
            </div>
          </dl>
          <p className="welcome__doors-head">{t('welcome.pile.line', { product: PRODUCT })}</p>
          <SourceChips />
          {canConnect && (
            <div className="welcome__actions">
              {week ? (
                <span className="arc__unfold-aside" data-testid="welcome-week">
                  {week.first
                    ? t('welcome.calendar.week', { count: week.count, title: week.first.title, who: attendeeLine(week.first) || t('meetings.group.today') })
                    : t('welcome.calendar.empty')}
                </span>
              ) : (
                <button className="welcome__quiet" data-testid="welcome-connect" disabled={connecting} onClick={() => void connect()}>
                  {t('welcome.calendar.short')}
                </button>
              )}
            </div>
          )}
          <div className="welcome__actions">
            <button className="arc__source" data-testid="welcome-finish" onClick={dismissWelcome}>
              {t('welcome.begin')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
