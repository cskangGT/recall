import { useMemo, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';
import { scriptedTalk, scriptedLines, TALK_TURNS } from '../ask/scriptedTalk';
import { Typed } from './Typed';
import type { TalkTurn } from '../data/dataSource';
import { groupMeetings, attendeeLine, isOver } from '../core/meetings';
import { readStep, writeStep, writeFirstPicks, FIRST_BUNDLE_KEY, TALK_KEY, type OnboardingStep } from '../core/onboarding';
import { SourceChips } from './SourceChips';
import { ROLES, readRole, writeRole, type Role } from '../core/roles';
import { ReturnLink } from './ReturnLink';
import { MeetingPreview } from './MeetingPreview';
import { t, PRODUCT, type StringKey } from '../i18n';

/**
 * The first conversation.
 *
 * Not a tour and not a form: the thing on this person's mind, talked through
 * with Mado in a few minutes, and what of that talk is worth keeping. The
 * beats are the two things the product does — talk something through, and
 * choose what of a thing to keep — met once, in order, on their own words:
 *
 *   thought  what has been on their mind lately (no form to it)
 *   talk     Mado, as their own memory, reflects and asks — two questions
 *            and a closing; every answer is theirs
 *   keep     the lines of it worth keeping, picked by Mado in their words,
 *            each on or off and editable; what stays becomes their first
 *            memories and their first category
 *   learn    what just happened, in three lines; the four places; the doors
 *
 * Every beat can be passed, and "look around first" passes them all.
 */

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

/**
 * The example in the first box, in turn per visit — the general set, or the
 * chosen role's own two. A different one each visit, so a second look never
 * lands on the same one.
 */
const GENERAL_EXAMPLES = [
  'welcome.firstEx.1',
  'welcome.firstEx.2',
  'welcome.firstEx.3',
  'welcome.firstEx.4',
  'welcome.firstEx.5',
  'welcome.firstEx.6',
] as const;
const EXAMPLE_TURN_KEY = 'mado.ob.exampleTurn';
function exampleTurn(): number {
  try {
    const turn = Number(localStorage.getItem(EXAMPLE_TURN_KEY) ?? '0') || 0;
    localStorage.setItem(EXAMPLE_TURN_KEY, String(turn + 1));
    return turn;
  } catch {
    return Math.floor(Math.random() * 6);
  }
}

function readTalk(): TalkTurn[] {
  try {
    const raw = localStorage.getItem(TALK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as TalkTurn[]).filter((tn) => tn && (tn.who === 'you' || tn.who === 'mado') && typeof tn.text === 'string') : [];
  } catch {
    return [];
  }
}
function writeTalk(turns: TalkTurn[]): void {
  localStorage.setItem(TALK_KEY, JSON.stringify(turns));
}
/** Without a namer: the first clause of the first line, cut on a word. */
function nameFrom(line: string): string {
  const clause = line.split(/[,.—\n?!]/)[0]!.trim();
  let short = '';
  for (const w of clause.split(/\s+/)) {
    if ((short + ' ' + w).trim().length > 22) break;
    short = (short + ' ' + w).trim();
  }
  return short || t('welcome.keep.source');
}

export function Welcome() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const canConnect = Boolean(useWorkspaceStore((s) => s.source.connectGoogle));
  const dismissWelcome = useUiStore((s) => s.dismissWelcome);

  const [step, setStep] = useState<OnboardingStep>(() => {
    const stored = readStep();
    // The older second and third beats land on the nearest new one.
    return stored === 'done' ? 'thought' : stored === 'why' ? 'talk' : stored === 'think' ? 'keep' : stored;
  });
  const [turn] = useState(exampleTurn);
  const [role, setRole] = useState<Role | null>(readRole);
  const [introduced, setIntroduced] = useState<boolean>(() => readRole() !== null || readStep() !== 'thought');
  const example: StringKey = role
    ? (`welcome.ex.${role}.${turn % 2 === 0 ? 1 : 2}` as StringKey)
    : GENERAL_EXAMPLES[turn % GENERAL_EXAMPLES.length]!;
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /** The talk so far — theirs and Mado's, in order; kept across a reload. */
  const [turns, setTurns] = useState<TalkTurn[]>(readTalk);
  /** Mado's line on its way (a model takes a moment; the fixed line does not). */
  const [writing, setWriting] = useState(false);
  /** Whether Mado's latest line has finished arriving on screen. */
  const [landed, setLanded] = useState(true);
  /** The lines worth keeping, as picked — each on or off, each editable. */
  const [lines, setLines] = useState<{ text: string; on: boolean }[] | null>(null);
  const [picking, setPicking] = useState(false);

  const steps: OnboardingStep[] = ['thought', 'talk', 'keep', 'learn'];
  const go = (next: OnboardingStep) => {
    writeStep(next);
    setStep(next);
  };

  /* Mado's next line — the model's where the server has one, the fixed line otherwise. */
  const nextMadoLine = async (soFar: TalkTurn[]) => {
    const said = soFar.filter((tn) => tn.who === 'mado').length;
    const closing = said >= TALK_TURNS - 1;
    const talk = useWorkspaceStore.getState().source.talk;
    setWriting(true);
    setLanded(false);
    let line: { text: string; closing: boolean };
    try {
      line = talk ? await talk(soFar, role ?? undefined, closing) : scriptedTalk(soFar);
      if (!line.text) line = scriptedTalk(soFar);
    } catch {
      line = scriptedTalk(soFar);
    }
    const next = [...soFar, { who: 'mado' as const, text: line.text }];
    writeTalk(next);
    setTurns(next);
    setWriting(false);
  };

  /* Beat 1: the thing on their mind — said, not yet kept. The talk starts on it. */
  const submitThought = async () => {
    const content = draft.trim();
    if (!content || reading) return;
    setReading(true);
    try {
      const first: TalkTurn[] = [{ who: 'you', text: content }];
      writeTalk(first);
      setTurns(first);
      setDraft('');
      go('talk');
      await nextMadoLine(first);
    } finally {
      setReading(false);
    }
  };

  /* Beat 2: their answer, and Mado's next line. */
  const sendTalk = async () => {
    const content = draft.trim();
    if (!content || writing) return;
    const next = [...turns, { who: 'you' as const, text: content }];
    writeTalk(next);
    setTurns(next);
    setDraft('');
    await nextMadoLine(next);
  };

  const madoCount = turns.filter((tn) => tn.who === 'mado').length;
  const closed = madoCount >= TALK_TURNS;

  /* Beat 3 begins: what of the talk is worth keeping, picked in their words. */
  const toKeep = async () => {
    if (picking) return;
    go('keep');
    setPicking(true);
    try {
      const pick = useWorkspaceStore.getState().source.keepLines;
      let got: string[] = [];
      try {
        got = pick ? (await pick(turns)).lines : scriptedLines(turns);
      } catch {
        got = scriptedLines(turns);
      }
      if (got.length === 0) got = scriptedLines(turns);
      setLines(got.map((text) => ({ text, on: true })));
    } finally {
      setPicking(false);
    }
  };

  /* The keep: the lines left on become their first memories and their first category. */
  const keepChosen = async () => {
    const chosen = (lines ?? []).filter((l) => l.on).map((l) => l.text.trim()).filter(Boolean);
    if (chosen.length === 0 || reading) return;
    setReading(true);
    try {
      const added = await keepText(t('welcome.keep.source'), chosen.join('\n'));
      if (added.length === 0) {
        useUiStore.getState().toast(t('welcome.read.nothing'));
        return;
      }
      writeFirstPicks(added);
      const store = useWorkspaceStore.getState();
      let name = '';
      try {
        name = (await store.source.suggestCategoryName?.(added))?.name ?? '';
      } catch {
        name = '';
      }
      if (!name) name = nameFrom(chosen[0]!);
      await store.createCategory(name, added);
      localStorage.setItem(FIRST_BUNDLE_KEY, name);
      go('learn');
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
          {/* Who they are, in one press — so the example and the ask-back are theirs. */}
          {!introduced ? (
            <>
              <p className="arc__greeting-aside">{t('welcome.who')}</p>
              <div className="welcome__roles" data-testid="welcome-roles">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    className="arc__source"
                    data-testid={`role-${r}`}
                    onClick={() => {
                      writeRole(r);
                      setRole(r);
                      setIntroduced(true);
                    }}
                  >
                    {t(`welcome.role.${r}`)}
                  </button>
                ))}
              </div>
              {/* The chips are examples, not a gate: the target is a way of working. */}
              <p className="welcome__whoany" data-testid="welcome-who-any">{t('welcome.whoAny')}</p>
              <button
                className="welcome__quiet"
                data-testid="role-skip"
                onClick={() => {
                  writeRole(null);
                  setRole(null);
                  setIntroduced(true);
                }}
              >
                {t('welcome.roleSkip')}
              </button>
            </>
          ) : (
            <>
              {role && (
                <button className="welcome__rolechip" data-testid="role-chosen" onClick={() => setIntroduced(false)}>
                  {t(`welcome.role.${role}`)} · {t('welcome.roleChange')}
                </button>
              )}
              <p className="arc__greeting-aside">{t('welcome.first')}</p>
              {textarea('welcome-first-input', t(example), () => void submitThought())}
            </>
          )}
          {introduced && (
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
          )}
          {payload.memories.length > 0 && (
            <button className="arc__browse" data-testid="door-browse" onClick={() => useUiStore.getState().goBrowse()}>
              <span className="arc__browse-name">{t('welcome.browse')}</span>
              <span className="arc__browse-hint">{t('welcome.browseHint', { memories: payload.memories.length })}</span>
            </button>
          )}
        </>
      )}

      {step === 'talk' && (
        <>
          <p className="arc__greeting-aside">{t('welcome.talk.hint')}</p>
          <div className="welcome__talk" data-testid="welcome-talk">
            {turns.map((tn, i) =>
              tn.who === 'you' ? (
                <p key={i} className="welcome__you" data-testid={`welcome-turn-you-${i}`}>
                  {tn.text}
                </p>
              ) : i === turns.length - 1 ? (
                <Typed key={i} className="welcome__mado" testId="welcome-mado" text={tn.text} onDone={() => setLanded(true)} />
              ) : (
                <p key={i} className="welcome__mado welcome__mado--past">
                  {tn.text}
                </p>
              ),
            )}
            {writing && (
              <p className="welcome__mado welcome__mado--writing" data-testid="welcome-mado-writing">
                {t('welcome.talk.writing')}
              </p>
            )}
            {!closed && !writing && landed && textarea('welcome-talk-input', '', () => void sendTalk())}
          </div>
          <div className="welcome__actions">
            {closed ? (
              <button className="arc__source" data-testid="welcome-talk-keep" disabled={!landed} onClick={() => void toKeep()}>
                {t('welcome.talk.toKeep')}
              </button>
            ) : (
              <>
                <button className="arc__source" data-testid="welcome-talk-send" disabled={writing || !landed || draft.trim().length === 0} onClick={() => void sendTalk()}>
                  {t('welcome.talk.send')}
                </button>
                {madoCount >= 1 && (
                  <button className="welcome__quiet" data-testid="welcome-talk-enough" disabled={writing} onClick={() => void toKeep()}>
                    {t('welcome.talk.enough')}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {step === 'keep' && (
        <>
          <p className="arc__greeting-line">{t('welcome.keep.title')}</p>
          <p className="arc__greeting-aside">{t('welcome.keep.aside', { product: PRODUCT })}</p>
          {lines === null ? (
            <p className="bar__preview-reading" data-testid="welcome-keep-picking">{t('welcome.keep.picking')}</p>
          ) : lines.length === 0 ? (
            <p className="arc__greeting-aside" data-testid="welcome-keep-none">{t('welcome.keep.none')}</p>
          ) : (
            <ul className="bar__sections welcome__lines" data-testid="welcome-lines">
              {lines.map((l, i) => (
                <li key={i} className={`bar__section${l.on ? '' : ' bar__section--off'}`} data-testid={`welcome-line-${i}`}>
                  <button
                    className="bar__section-star"
                    data-testid={`welcome-line-toggle-${i}`}
                    aria-pressed={l.on}
                    onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                  >
                    {l.on ? '★' : '☆'}
                  </button>
                  <input
                    className="welcome__line-input"
                    data-testid={`welcome-line-input-${i}`}
                    value={l.text}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) void keepChosen();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="welcome__actions">
            <button
              className="arc__source"
              data-testid="welcome-keep"
              disabled={reading || picking || !lines || !lines.some((l) => l.on && l.text.trim())}
              onClick={() => void keepChosen()}
            >
              {reading ? t('stage.reading') : t('welcome.keep.send', { n: (lines ?? []).filter((l) => l.on && l.text.trim()).length })}
            </button>
            {lines !== null && (
              <button className="welcome__quiet" data-testid="welcome-keep-skip" onClick={() => go('learn')}>
                {t('welcome.whySkip')}
              </button>
            )}
          </div>
        </>
      )}

      {step === 'learn' && (
        <>
          <p className="arc__greeting-line">{t('welcome.learn.title')}</p>
          <p className="arc__greeting-aside">
            {bundleName ? t('welcome.learn.asideBundle', { name: bundleName, product: PRODUCT }) : t('welcome.learn.aside', { product: PRODUCT })}
          </p>
          <p className="arc__greeting-aside" data-testid="welcome-learn-past">{t('welcome.learn.past')}</p>
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
          {/* The meeting beat: one upcoming meeting, and what Mado would put in front of them before it. */}
          <MeetingPreview />
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
          {/* Before there is an account, the link is the account: said once, here, where the first thing worth keeping just happened. */}
          <ReturnLink />
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
