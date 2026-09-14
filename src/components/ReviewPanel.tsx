import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { localVector } from '../capture/embedLocal';
import type { GraphPayload } from '../core/types';
import { landAfterReview } from '../capture/reviewLanding';

/**
 * The review — one source's original against what Mado made of it (spec §21).
 *
 * Offered, never owed: everything is already saved and the map is complete
 * without this. What the panel adds is the user's hand — keep, drop, rewrite —
 * and the hidden half is that every verdict is recorded server-side as the
 * curation signal that teaches the next extraction.
 *
 * Verdicts are staged locally and applied in one confirm, so Escape can walk
 * away at any point having changed nothing.
 */

type Verdict = { kind: 'keep' } | { kind: 'drop' } | { kind: 'edit'; text: string };

export function ReviewPanel() {
  const review = useUiStore((s) => s.review);
  const payload = useWorkspaceStore((s) => s.payload);
  const sourceId = review?.sourceIds[review.index];
  const source =
    payload && sourceId ? payload.sources.find((s) => s.id === sourceId) : undefined;

  // A vanished source (deleted mid-batch?) is stepped past, never wedged on.
  // In an effect, not in render — advancing is a state write.
  useEffect(() => {
    if (review && payload && !source) useUiStore.getState().advanceReview();
  }, [review, payload, source]);

  if (!review || !payload || !source) return null;
  return <ReviewCard key={source.id} payload={payload} sourceId={source.id} />;
}

function ReviewCard({ payload, sourceId }: { payload: GraphPayload; sourceId: string }) {
  const review = useUiStore((s) => s.review)!;
  const source = payload.sources.find((s) => s.id === sourceId)!;
  const memories = useMemo(
    () => payload.memories.filter((m) => m.source_id === sourceId),
    [payload, sourceId],
  );

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [saving, setSaving] = useState(false);
  /*
   * Two more hands, both staged like every other verdict — nothing is saved
   * until the confirm. `condensed` remembers that the staged state came from
   * a draft, so the card can offer the way back; `armed` is the first press
   * of "throw away", which the second press confirms and a few seconds undo.
   */
  const [condensing, setCondensing] = useState(false);
  const [condensed, setCondensed] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const canCondense =
    memories.length >= 2 && Boolean(useWorkspaceStore.getState().source.condenseSource);

  /**
   * The draft lands as: the first memory rewritten to the draft, the rest
   * dropped. The person edits the text in place and confirms — through the
   * same review route, so the curation signal is recorded like any other.
   */
  const condense = async () => {
    setCondensing(true);
    try {
      const draft = await useWorkspaceStore.getState().source.condenseSource!(sourceId);
      const [first, ...rest] = memories;
      const staged: Record<string, Verdict> = { [first!.id]: { kind: 'edit', text: draft.text } };
      for (const m of rest) staged[m.id] = { kind: 'drop' };
      setVerdicts(staged);
      setCondensed(true);
    } catch {
      useUiStore.getState().toast(t('toast.condenseFailed'));
    } finally {
      setCondensing(false);
    }
  };

  const uncondense = () => {
    setVerdicts({});
    setCondensed(false);
  };

  /** Not a verdict: the source and its memories go, and nothing is learned. */
  const discard = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setSaving(true);
    try {
      const store = useWorkspaceStore.getState();
      if (store.source.deleteSource) {
        store.applyPayload(await store.source.deleteSource(sourceId));
      } else {
        const current = store.payload!;
        const gone = new Set(memories.map((m) => m.id));
        store.applyPayload({
          ...current,
          sources: current.sources.filter((s) => s.id !== sourceId),
          memories: current.memories.filter((m) => !gone.has(m.id)),
          edges: current.edges.filter(
            (e) => !gone.has(e.source_memory_id) && !gone.has(e.target_memory_id),
          ),
        });
      }
      useUiStore.getState().toast(t('toast.discarded'));
      useUiStore.getState().advanceReview();
    } catch {
      useUiStore.getState().toast(t('toast.batchFailed'));
    } finally {
      setSaving(false);
      setArmed(false);
    }
  };
  const verdictOf = (id: string): Verdict => verdicts[id] ?? { kind: 'keep' };
  const setVerdict = (id: string, v: Verdict) => setVerdicts((s) => ({ ...s, [id]: v }));

  const counts = useMemo(() => {
    let d = 0;
    let e = 0;
    for (const m of memories) {
      const v = verdictOf(m.id);
      if (v.kind === 'drop') d++;
      else if (v.kind === 'edit' && v.text.trim() !== m.text) e++;
    }
    return { k: memories.length - d - e, d, e };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdicts, memories]);

  const total = review.sourceIds.length;
  const isLast = review.index === total - 1;

  const confirm = async () => {
    const discard = memories.filter((m) => verdictOf(m.id).kind === 'drop').map((m) => m.id);
    const edits = memories
      .map((m) => ({ m, v: verdictOf(m.id) }))
      .filter(
        (x): x is { m: (typeof memories)[number]; v: { kind: 'edit'; text: string } } =>
          x.v.kind === 'edit' && x.v.text.trim().length > 0 && x.v.text.trim() !== x.m.text,
      )
      .map((x) => ({ memoryId: x.m.id, text: x.v.text.trim() }));

    setSaving(true);
    try {
      const store = useWorkspaceStore.getState();
      if (store.source.reviewSource) {
        store.applyPayload(await store.source.reviewSource(sourceId, { discard, edits }));
      } else {
        /*
         * Seed mode: the same verdicts, applied locally. No signal is recorded
         * — there is no server to learn — but the surface behaves identically,
         * which is what the demo and the tests need from it.
         */
        const current = useWorkspaceStore.getState().payload!;
        const dropped = new Set(discard);
        const editById = new Map(edits.map((e) => [e.memoryId, e.text]));
        const next: GraphPayload = {
          ...current,
          sources: current.sources.map((s) =>
            s.id === sourceId ? { ...s, reviewed_at: new Date().toISOString() } : s,
          ),
          memories: current.memories
            .filter((m) => !dropped.has(m.id))
            .map((m) =>
              editById.has(m.id)
                ? {
                    ...m,
                    text: editById.get(m.id)!,
                    vector: localVector(editById.get(m.id)!, current.memories),
                    category_locked: true,
                  }
                : m,
            ),
          edges: current.edges.filter(
            (e) => !dropped.has(e.source_memory_id) && !dropped.has(e.target_memory_id),
          ),
        };
        store.applyPayload(next);
      }
      useUiStore.getState().toast(t('review.toast', { k: counts.k, d: counts.d, e: counts.e }));
      useUiStore.getState().advanceReview();
      // The last save of a run lands where its memories went.
      if (isLast) landAfterReview(sourceId);
    } catch {
      useUiStore.getState().toast(t('toast.batchFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reviewpanel" data-testid="review-panel" role="dialog" aria-label={t('review.title')}>
      <div className="reviewpanel__card">
        <div className="reviewpanel__head">
          <span className="reviewpanel__title">{t('review.title')}</span>
          {total > 1 && (
            <span className="reviewpanel__step" data-testid="review-step">
              {t('review.step', { current: review.index + 1, total })}
            </span>
          )}
        </div>
        <p className="reviewpanel__hint">{t('review.hint')}</p>

        <div className="reviewpanel__eyebrow">{t('review.original')}</div>
        <div className="reviewpanel__original" data-testid="review-original">
          {source.title && <div className="reviewpanel__source-title">{source.title}</div>}
          {source.raw_content}
        </div>

        <div className="reviewpanel__eyebrow reviewpanel__eyebrow--row">
          <span>{t('review.extracted')}</span>
          {canCondense && !condensed && (
            <button
              className="reviewpanel__condense"
              data-testid="review-condense"
              disabled={condensing}
              onClick={() => void condense()}
            >
              {condensing ? t('review.condensing') : t('review.condense')}
            </button>
          )}
          {condensed && (
            <button
              className="reviewpanel__condense"
              data-testid="review-uncondense"
              onClick={uncondense}
            >
              {t('review.uncondense')}
            </button>
          )}
        </div>
        {condensed && (
          <p className="reviewpanel__hint" data-testid="review-condense-hint">
            {t('review.condenseHint')}
          </p>
        )}
        {memories.length === 0 && <p className="reviewpanel__hint">{t('review.empty')}</p>}
        {memories.map((m) => {
          const v = verdictOf(m.id);
          return (
            <div
              key={m.id}
              className={`reviewitem${v.kind === 'drop' ? ' reviewitem--dropped' : ''}`}
              data-testid={`review-item-${m.id}`}
            >
              {v.kind === 'edit' ? (
                <textarea
                  className="reviewitem__editor"
                  data-testid={`review-editor-${m.id}`}
                  value={v.text}
                  autoFocus
                  onChange={(e) => setVerdict(m.id, { kind: 'edit', text: e.target.value })}
                />
              ) : (
                <span className="reviewitem__text">{m.text}</span>
              )}
              <span className="reviewitem__actions">
                {v.kind !== 'keep' && (
                  <button
                    className="reviewitem__btn"
                    data-testid={`review-keep-${m.id}`}
                    onClick={() => setVerdict(m.id, { kind: 'keep' })}
                  >
                    {t('review.keep')}
                  </button>
                )}
                {v.kind !== 'drop' && (
                  <button
                    className="reviewitem__btn reviewitem__btn--drop"
                    data-testid={`review-drop-${m.id}`}
                    onClick={() => setVerdict(m.id, { kind: 'drop' })}
                  >
                    {t('review.drop')}
                  </button>
                )}
                {v.kind === 'keep' && (
                  <button
                    className="reviewitem__btn"
                    data-testid={`review-edit-${m.id}`}
                    onClick={() => setVerdict(m.id, { kind: 'edit', text: m.text })}
                  >
                    {t('review.edit')}
                  </button>
                )}
              </span>
            </div>
          );
        })}

        <div className="reviewpanel__actions">
          <span className="reviewpanel__aside">
            <button
              className="reviewpanel__skip"
              data-testid="review-skip"
              onClick={() => useUiStore.getState().advanceReview()}
            >
              {t('review.skip')}
            </button>
            <button
              className={`reviewpanel__skip reviewpanel__discard${armed ? ' reviewpanel__discard--armed' : ''}`}
              data-testid="review-discard"
              disabled={saving}
              onClick={() => void discard()}
            >
              {armed ? t('review.discardSure') : t('review.discard')}
            </button>
          </span>
          <button
            className="reviewpanel__confirm"
            data-testid="review-confirm"
            disabled={saving}
            onClick={() => void confirm()}
          >
            {saving ? t('review.saving') : isLast ? t('review.confirm') : t('review.confirmNext')}
          </button>
        </div>
      </div>
    </div>
  );
}
