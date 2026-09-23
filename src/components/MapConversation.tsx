import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';
import { MemoryRow } from './Inspector';
import { readStep, FIRST_BUNDLE_KEY } from '../core/onboarding';

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
  /** What each kept line became — memory ids, by the turn (question + answer) it was kept from. */
  const [kept, setKept] = useState<Record<string, string[]>>({});
  const turnKey = (q: string, a: string) => `${q}\n${a}`;
  const payload = useWorkspaceStore((s) => s.payload);

  /*
   * Keeping what was said. A line of the conversation worth remembering
   * becomes a memory through the ordinary pipeline — a note titled for the
   * thought — and, where the thought has a home, it is moved in there and
   * joins the picks. This is the moment the whole mode is for: thinking
   * together, and deciding what of it to keep.
   */
  const keep = async (key: string, text: string) => {
    if (keeping) return;
    setKeeping(key);
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
      /*
       * The first conversation: the first line kept is what makes the first
       * category — named by Mado where a namer exists, else after the words
       * — and the person's stars move in with it. Their worry, come back as
       * a structure of their own.
       */
      if (!bundle && readStep() === 'think' && thinking) {
        const st = useWorkspaceStore.getState();
        const picks = [...useUiStore.getState().picked, ...added];
        let name = '';
        try {
          name = (await st.source.suggestCategoryName?.(picks))?.name ?? '';
        } catch {
          name = '';
        }
        if (!name) {
          const firstPick = st.payload?.memories.find((m) => m.id === picks[0]);
          // Without a namer: the first clause of the first pick, cut on a word.
          const clause = firstPick ? firstPick.text.split(/[,.—\n?!]/)[0]!.trim() : '';
          const words = clause.split(/\s+/);
          let short = '';
          for (const w of words) {
            if ((short + ' ' + w).trim().length > 22) break;
            short = (short + ' ' + w).trim();
          }
          name = short || t('bundle.condensedTitle');
        }
        const categoryId = await st.createCategory(name, picks);
        useUiStore.getState().setBundle({ categoryId, name });
        localStorage.setItem(FIRST_BUNDLE_KEY, name);
      }
      if (thinking && added.length > 0) useUiStore.getState().setPicked([...useUiStore.getState().picked, ...added]);
      // The result, where it was asked for: the memories it became, listed
      // under the line, and the map going to them. A toast alone was a
      // sentence with nothing to look at.
      setKept((k) => ({ ...k, [key]: added }));
      if (added.length > 0) ui.requestZoomTo(added);
      else ui.toast(t('mapchat.keptNothing'));
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

  const keptBlock = (key: string) => {
    const ids = kept[key];
    if (!ids || !payload) return null;
    const memories = ids.map((id) => payload.memories.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => m !== undefined);
    return (
      <div className="mapchat__kept" data-testid="map-kept">
        <span className="mapchat__kept-head">
          {memories.length === 0
            ? t('mapchat.keptNothing')
            : bundle
              ? t('mapchat.keptHeadInto', { count: memories.length, name: bundle.name })
              : t('mapchat.keptHead', { count: memories.length })}
        </span>
        {memories.map((m) => (
          <MemoryRow key={m.id} memory={m} payload={payload} onSelect={(id) => go(id)} />
        ))}
      </div>
    );
  };

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
            {thinking && !kept[turnKey(turn.question, turn.answer)] && (
              <button className="mapchat__keep" data-testid="map-keep-past" disabled={keeping !== null} onClick={() => void keep(turnKey(turn.question, turn.answer), clean(turn.answer))}>
                {t('mapchat.keep')}
              </button>
            )}
            {keptBlock(turnKey(turn.question, turn.answer))}
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
            {thinking && !live.refused && !kept[turnKey(live.question, live.answer)] && (
              <button
                className="mapchat__keep"
                data-testid="map-keep"
                disabled={keeping !== null}
                onClick={() => void keep(turnKey(live.question, live.answer), clean(live.answer))}
              >
                {keeping ? t('mapchat.keeping') : bundle ? t('mapchat.keepInto', { name: bundle.name }) : t('mapchat.keep')}
              </button>
            )}
            {!live.refused && keptBlock(turnKey(live.question, live.answer))}
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
