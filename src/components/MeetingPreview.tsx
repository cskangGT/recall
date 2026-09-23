import { useState } from 'react';
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

  const preview = async () => {
    const content = line.trim();
    if (!content || busy) return;
    setBusy(true);
    const ui = useUiStore.getState();
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
      const picks = [...readFirstPicks(), ...added];
      writeFirstPicks(picks);

      // What Mado would put in front of them: the same ask the meetings page
      // makes, with everything they have handed over so far as the picks.
      const question = t('welcome.meeting.question', { meeting: content });
      const next = useWorkspaceStore.getState();
      const answer = next.source.ask
        ? await next.source.ask(question, [], picks).catch(() => answerQuestion(question, next.payload!, [], picks))
        : answerQuestion(question, next.payload!, [], picks);
      const memories = answer.citations
        .map((c) => next.payload!.memories.find((m) => m.id === c.memory_id))
        .filter((m): m is Memory => m !== undefined);
      setPrep({ text: answer.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1'), memories });
    } catch {
      ui.toast(t('toast.captureFailed'));
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
        <div className="meetprev__card" data-testid="welcome-meeting-card">
          <span className="brief__eyebrow">{t('welcome.meeting.cardHead', { product: PRODUCT })}</span>
          <p className="meetprev__text">{prep.text}</p>
          {prep.memories.length > 0 && (
            <div className="brief__evidence-rows">
              {prep.memories.slice(0, 4).map((m) => (
                <MemoryRow key={m.id} memory={m} payload={payload} onSelect={() => {}} />
              ))}
            </div>
          )}
          <p className="meetprev__promise">
            {canConnect ? t('welcome.meeting.promiseConnect', { product: PRODUCT }) : t('welcome.meeting.promise', { product: PRODUCT })}
          </p>
        </div>
      )}
    </div>
  );
}
