import { useEffect, useRef, useState } from 'react';
import { t, PRODUCT } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';
import { answerQuestion } from '../ask/scriptedAsk';
import { readFirstPicks, writeFirstPicks } from '../core/onboarding';
import { MemoryRow } from './Inspector';
import type { Memory } from '../core/types';

/**
 * The meeting beat of the first conversation.
 *
 * The person Mado is for has meetings, and the loop that matters most to
 * them is this one: a line left after a meeting comes back before the
 * next. Told, that is a feature; shown, on a meeting they actually have,
 * it is the reason to connect the calendar. So the greeting asks for one
 * upcoming meeting in a line, keeps it, and has Mado say — from what they
 * have already handed over — what it would put in front of them before
 * that meeting. A real answer on their own words, not a mock card.
 */
export function MeetingPreview() {
  const payload = useWorkspaceStore((s) => s.payload);
  const canConnect = Boolean(useWorkspaceStore((s) => s.source.connectGoogle));
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<{ text: string; memories: Memory[] } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  // The answer arrives below the fold of a tall step: bring it up to the eye.
  useEffect(() => {
    card.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [prep]);

  /*
   * See first, keep after. The line is asked about before anything is
   * saved: Mado answers from what the person has already handed over, with
   * the meeting line in the question. Only the keep below makes it a note —
   * someone who only wanted to look has put nothing in.
   */
  const preview = async () => {
    const content = line.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const question = t('welcome.meeting.question', { meeting: content });
      const picks = readFirstPicks();
      const store = useWorkspaceStore.getState();
      const answer = store.source.ask
        ? await store.source.ask(question, [], picks).catch(() => answerQuestion(question, store.payload!, [], picks))
        : answerQuestion(question, store.payload!, [], picks);
      const memories = answer.citations
        .map((c) => store.payload!.memories.find((m) => m.id === c.memory_id))
        .filter((m): m is Memory => m !== undefined);
      setPrep({ text: answer.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1'), memories });
    } catch {
      useUiStore.getState().toast(t('ask.failed'));
    } finally {
      setBusy(false);
    }
  };

  const [kept, setKept] = useState<'no' | 'yes' | 'skipped'>('no');
  const keepMeeting = async () => {
    const content = line.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const store = useWorkspaceStore.getState();
      const note = `${t('welcome.meeting.noteLead')} ${content}`;
      let added: string[] = [];
      if (store.source.capture) {
        const result = await store.source.capture({ type: 'text', title: t('welcome.meeting.title'), content: note });
        store.applyPayload(result.graph);
        added = result.addedMemoryIds ?? [];
      } else {
        const result = runBatchPipeline(store.payload!, [{ title: t('welcome.meeting.title'), content: note }]);
        store.applyPayload(result.payload);
        added = result.addedMemoryIds;
      }
      writeFirstPicks([...readFirstPicks(), ...added]);
      setKept('yes');
    } catch {
      useUiStore.getState().toast(t('toast.captureFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!payload) return null;

  return (
    <div className="meetprev" data-testid="welcome-meeting">
      <p className="welcome__doors-head">{t('welcome.meeting.ask')}</p>
      {!prep ? (
        <div className="meetprev__row">
          <input
            className="bundle__input"
            data-testid="welcome-meeting-input"
            placeholder={t('welcome.meeting.ph')}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                e.currentTarget.blur();
                return;
              }
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void preview();
            }}
          />
          <button className="picks__action" data-testid="welcome-meeting-preview" disabled={busy || !line.trim()} onClick={() => void preview()}>
            {busy ? t('stage.reading') : t('welcome.meeting.show')}
          </button>
        </div>
      ) : (
        <div className="meetprev__card" data-testid="welcome-meeting-card" ref={card}>
          <span className="brief__eyebrow">{t('welcome.meeting.cardHead', { product: PRODUCT })}</span>
          <p className="meetprev__text">{prep.text}</p>
          {prep.memories.length > 0 && (
            <div className="brief__evidence-rows">
              {prep.memories.slice(0, 4).map((m) => (
                <MemoryRow key={m.id} memory={m} payload={payload} onSelect={() => {}} />
              ))}
            </div>
          )}
          {/* Seen; now the choice. The line becomes a note only here. */}
          {kept === 'no' ? (
            <div className="meetprev__actions">
              <button className="picks__action" data-testid="welcome-meeting-keep" disabled={busy} onClick={() => void keepMeeting()}>
                {busy ? t('mapchat.keeping') : t('welcome.meeting.keep')}
              </button>
              <button className="welcome__quiet" data-testid="welcome-meeting-skip" onClick={() => setKept('skipped')}>
                {t('welcome.meeting.skip')}
              </button>
            </div>
          ) : kept === 'yes' ? (
            <p className="meetprev__kept" data-testid="welcome-meeting-kept">{t('welcome.meeting.kept')}</p>
          ) : null}
          <p className="meetprev__promise">
            {canConnect ? t('welcome.meeting.promiseConnect', { product: PRODUCT }) : t('welcome.meeting.promise', { product: PRODUCT })}
          </p>
        </div>
      )}
    </div>
  );
}
