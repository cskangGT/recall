import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { localVector } from '../capture/embedLocal';
import type { GraphPayload } from '../core/types';

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
    } catch {
      useUiStore.getState().toast(t('toast.batchFailed'));
    } finally {
      setSaving(false);
    }
  };

  const total = review.sourceIds.length;
  const isLast = review.index === total - 1;

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

        <div className="reviewpanel__eyebrow">{t('review.extracted')}</div>
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
          <button
            className="reviewpanel__skip"
            data-testid="review-skip"
            onClick={() => useUiStore.getState().advanceReview()}
          >
            {t('review.skip')}
          </button>
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
