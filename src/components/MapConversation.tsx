import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';

/**
 * The conversation, rising from the bar.
 *
 * Asking Mado is talking, and talk grows upward from where you type: the
 * question you just sent sits above the bar, the answer above that, and what
 * was said before climbs away, quieter. It lives inside the bar's own panel
 * so the two read as one thing — a chat that happens to be standing on a map
 * — and the map behind it moves to whatever is being talked about.
 *
 * The answer's [n] marks are doors: each goes to that memory on the map. The
 * memories themselves are laid out in the panel beside, so this column stays
 * the talk and that one stays the evidence.
 */
export function MapConversation() {
  const answer = useUiStore((s) => s.answer);
  const thread = useUiStore((s) => s.askThread);
  const draft = useUiStore((s) => s.answerDraft);
  const asking = useUiStore((s) => s.asking);
  const scroller = useRef<HTMLDivElement>(null);
  const bundle = useUiStore((s) => s.bundle);
  const thinking = useUiStore((s) => s.thinking);
  const [keeping, setKeeping] = useState<string | null>(null);

  /*
   * Keeping what was said. A line of the conversation worth remembering
   * becomes a memory through the ordinary pipeline — a note titled for the
   * thought — and, where the thought has a home, it is moved in there and
   * joins the picks. This is the moment the whole mode is for: thinking
   * together, and deciding what of it to keep.
   */
  const keep = async (text: string) => {
    if (keeping) return;
    setKeeping(text);
    const ui = useUiStore.getState();
    const store = useWorkspaceStore.getState();
    try {
      const title = bundle ? bundle.name : t('bundle.condensedTitle');
      let added: string[] = [];
      if (store.source.capture) {
        const result = await store.source.capture({ type: 'text', title, content: text });
        store.applyPayload(result.graph);
        added = result.addedMemoryIds ?? [];
      } else {
        const result = runBatchPipeline(store.payload!, [{ title, content: text }]);
        store.applyPayload(result.payload);
        added = result.addedMemoryIds;
      }
      if (bundle) for (const id of added) useWorkspaceStore.getState().moveMemory(id, bundle.categoryId);
      if (thinking && added.length > 0) useUiStore.getState().setPicked([...useUiStore.getState().picked, ...added]);
      ui.toast(bundle ? t('mapchat.keptInto', { name: bundle.name }) : t('mapchat.kept'));
    } catch {
      ui.toast(t('toast.captureFailed'));
    } finally {
      setKeeping(null);
    }
  };

  const live = answer && !answer.found ? answer : null;
  // The thread's last turn is the answer in hand (a refusal never joins it).
  const prior = live && !live.refused ? thread.slice(0, -1) : thread;
  const pending = asking && draft && draft.question !== live?.question ? draft : null;
  const clean = (text: string) => text.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1');

  // Newest at the bottom, and the bottom is where the eye already is.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [prior.length, live?.answer, pending?.text]);

  if (!live && !pending && prior.length === 0) return null;

  const go = (memoryId: string) => {
    const ui = useUiStore.getState();
    ui.select(memoryId);
    ui.requestZoomTo([memoryId]);
  };

  return (
    <div className="mapchat" data-testid="map-conversation">
      <div className="mapchat__head">
        <span>{t('mapchat.title')}</span>
        <button
          className="mapchat__end"
          data-testid="map-conversation-end"
          onClick={() => {
            const ui = useUiStore.getState();
            ui.setAnswer(null);
            ui.clearAskThread();
            ui.setHighlight([]);
          }}
        >
          {t('mapchat.end')}
        </button>
      </div>
      <div className="mapchat__turns" ref={scroller}>
        {prior.map((turn, i) => (
          <div key={i} className="mapchat__turn mapchat__turn--past">
            <p className="mapchat__q">{turn.question}</p>
            <p className="mapchat__a">{clean(turn.answer)}</p>
            {thinking && (
              <button className="mapchat__keep" data-testid="map-keep-past" disabled={keeping !== null} onClick={() => void keep(clean(turn.answer))}>
                {t('mapchat.keep')}
              </button>
            )}
          </div>
        ))}
        {live && (
          <div className={`mapchat__turn${pending ? ' mapchat__turn--past' : ''}`} data-testid="map-conversation-live">
            <p className="mapchat__q">{live.question}</p>
            <p className="mapchat__a" data-testid="answer">
              {(live.refused ? t('ask.refusalText') : live.answer)
                .split(/(\[\d+\])/g)
                .filter(Boolean)
                .map((part, i) => {
                  const match = /^\[(\d+)\]$/.exec(part);
                  if (!match) return <span key={i}>{part}</span>;
                  const citation = live.citations.find((c) => c.n === Number(match[1]));
                  return (
                    <button
                      key={i}
                      className="citation"
                      data-testid={`citation-${match[1]}`}
                      onClick={() => citation && go(citation.memory_id)}
                    >
                      [{match[1]}]
                    </button>
                  );
                })}
            </p>
            {thinking && !live.refused && (
              <button
                className="mapchat__keep"
                data-testid="map-keep"
                disabled={keeping !== null}
                onClick={() => void keep(clean(live.answer))}
              >
                {keeping ? t('mapchat.keeping') : bundle ? t('mapchat.keepInto', { name: bundle.name }) : t('mapchat.keep')}
              </button>
            )}
          </div>
        )}
        {pending && (
          <div className="mapchat__turn" data-testid="map-conversation-pending">
            <p className="mapchat__q">{pending.question}</p>
            <p className="mapchat__a mapchat__a--streaming">{clean(pending.text) || t('composer.thinking')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
