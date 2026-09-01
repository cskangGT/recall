import { useEffect, useRef, useState } from 'react';
import { t, currentLocale } from '../i18n';
import { mergeCandidates, relatedMemories } from '../core/related';
import { effectivePlan, freeCutoff, sleepingCountOf, trialDaysLeft } from '../core/plan';
import { useUiStore, ANSWER_FOLDER_ID } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Category, Memory, Source, GraphPayload } from '../core/types';

const SOURCE_LABEL: Record<Source['type'], string> = {
  text: t('type.text'),
  link: t('type.link'),
  screenshot: t('type.screenshot'),
};

const relativeDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString(currentLocale() === 'ko' ? 'ko-KR' : 'en-GB', { day: 'numeric', month: 'short' });
};

function SourceCard({ source }: { source: Source }) {
  // The full text lives here — a DB fact, said out loud so clearing the
  // original at its source never feels like a gamble. Only a failure or an
  // in-flight read withholds the claim (the seed's sources carry no status).
  const safe =
    source.status !== 'failed' &&
    source.status !== 'pending' &&
    source.status !== 'processing' &&
    source.raw_content.trim().length > 0;
  return (
    <div className="source-card" data-testid="source-card">
      <div className="source-card__type">
        {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)}
        {safe && (
          <span className="source-card__safe" data-testid="source-safe" title={t('sources.safe')}>
            ✓ {t('sources.held')}
          </span>
        )}
        {source.url && (
          <a
            className="source-card__origin"
            href={source.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {t('sources.openOrigin')}
          </a>
        )}
      </div>
      <div className="source-card__title">{source.title}</div>
      <div className="source-card__body">
        {source.type === 'screenshot' && source.scene_description
          ? source.scene_description
          : source.raw_content}
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  payload,
  onSelect,
}: {
  memory: Memory;
  payload: GraphPayload;
  onSelect: (id: string) => void;
}) {
  const source = payload.sources.find((s) => s.id === memory.source_id);
  return (
    <button className="memory-row" onClick={() => onSelect(memory.id)}>
      <span className="memory-row__text">{memory.text}</span>
      <span className="memory-row__meta">
        {source ? SOURCE_LABEL[source.type] : t('inspector.unknown')} · {relativeDate(memory.created_at)}
      </span>
    </button>
  );
}

/**
 * The category name, editable in place.
 *
 * Renaming is the other half of the trust loop — dragging a memory says "not
 * there", renaming says "not that". Both lock, and a locked category is dropped
 * before any scoring in `gates.ts`, so the correction is permanent rather than
 * merely applied.
 *
 * Click to edit, Enter to keep, Escape to abandon. No edit button: the name is
 * the affordance, and a pencil icon beside every heading is chrome the rest of
 * this interface does without.
 */
function CategoryName({ category }: { category: Category }) {
  const renameCategory = useWorkspaceStore((s) => s.renameCategory);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  // A different category selected while editing must not carry the draft over.
  useEffect(() => {
    setEditing(false);
    setDraft(category.name);
  }, [category.id, category.name]);

  const commit = () => {
    setEditing(false);
    renameCategory(category.id, draft);
  };

  if (!editing) {
    return (
      <h2
        className="inspector__name"
        data-testid="category-name"
        title={t('inspector.renameTitle')}
        onClick={() => setEditing(true)}
      >
        {category.name}
      </h2>
    );
  }

  return (
    <input
      ref={ref}
      className="inspector__name inspector__name--editing"
      data-testid="category-name-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          // Stop it reaching the global handler, which would clear the
          // selection out from under the thing being renamed.
          e.stopPropagation();
          setDraft(category.name);
          setEditing(false);
        }
      }}
    />
  );
}

/**
 * `listMemories` is false in the folder browser: the middle pane is already
 * showing this exact list, and three columns where two say the same thing is
 * worse than two. The Inspector keeps the part the browser does not have —
 * where the category sits, what it is made of, and whether you pinned it.
 */
function CategoryDetail({
  category,
  payload,
  listMemories = true,
}: {
  category: Category;
  payload: GraphPayload;
  listMemories?: boolean;
}) {
  const select = useUiStore((s) => s.select);
  const childIds = payload.categories.filter((c) => c.parent_id === category.id).map((c) => c.id);
  const memories = payload.memories
    .filter((m) => m.category_id === category.id || childIds.includes(m.category_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const parent = category.parent_id
    ? payload.categories.find((c) => c.id === category.parent_id)
    : null;
  const locked = category.name_locked || category.user_created;

  // The one fact the middle pane cannot show: what this folder is *made of*.
  const mix = (['text', 'link', 'screenshot'] as Source['type'][])
    .map((type) => ({
      type,
      n: new Set(
        memories
          .filter((m) => payload.sources.find((s) => s.id === m.source_id)?.type === type)
          .map((m) => m.source_id),
      ).size,
    }))
    .filter((x) => x.n > 0);

  return (
    <>
      <div className="inspector__eyebrow">{t('inspector.category')}</div>
      <CategoryName category={category} />
      <div className="inspector__meta">
        {t('inspector.categoryMeta', { path: parent ? `${parent.name} › ${category.name}` : t('inspector.topLevel'), count: memories.length })}
      </div>
      {locked && (
        <div className="chips">
          <span className="chip chip--lock">{t('inspector.namedLock')}</span>
        </div>
      )}
      {childIds.length > 0 && (
        <div className="chips">
          {childIds.map((id) => {
            const c = payload.categories.find((x) => x.id === id)!;
            return (
              <button key={id} className="chip" onClick={() => select(id)}>
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {mix.length > 0 && (
        <div className="chips">
          {mix.map((x) => (
            <span key={x.type} className="chip">
              {x.n}{' '}
              {currentLocale() === 'ko'
                ? SOURCE_LABEL[x.type]
                : `${SOURCE_LABEL[x.type].toLowerCase()}${x.n === 1 ? '' : 's'}`}
            </span>
          ))}
        </div>
      )}
      {listMemories &&
        memories.map((m) => (
          <MemoryRow key={m.id} memory={m} payload={payload} onSelect={select} />
        ))}
    </>
  );
}

/** A user-driven merge, one step at a time: AI explains, the person decides. */
type MergeState =
  | { phase: 'loading'; withId: string }
  | { phase: 'preview'; withId: string; reason: string; mergedText: string }
  | { phase: 'applying'; withId: string; reason: string; mergedText: string }
  | { phase: 'error'; withId: string }
  | null;

function MemoryDetail({ memory, payload }: { memory: Memory; payload: GraphPayload }) {
  const related = relatedMemories(payload, memory.id);
  const candidates = mergeCandidates(payload, memory.id);
  const select = useUiStore((s) => s.select);
  const category = payload.categories.find((c) => c.id === memory.category_id);
  const source = payload.sources.find((s) => s.id === memory.source_id);
  const entities = payload.entities.filter((e) => memory.entity_ids.includes(e.id));

  const [merge, setMerge] = useState<MergeState>(null);
  useEffect(() => setMerge(null), [memory.id]);
  const canMerge = Boolean(useWorkspaceStore.getState().source.mergePreview);

  const startMerge = async (otherId: string) => {
    setMerge({ phase: 'loading', withId: otherId });
    try {
      const src = useWorkspaceStore.getState().source;
      const draft = await src.mergePreview!([memory.id, otherId]);
      setMerge({
        phase: 'preview',
        withId: otherId,
        reason: draft.reason,
        mergedText: draft.merged_text,
      });
    } catch {
      setMerge({ phase: 'error', withId: otherId });
    }
  };

  const confirmMerge = async (withId: string, reason: string, mergedText: string) => {
    setMerge({ phase: 'applying', withId, reason, mergedText });
    try {
      const store = useWorkspaceStore.getState();
      const other = payload.memories.find((m) => m.id === withId);
      const originals = new Set([memory.source_id, other?.source_id].filter(Boolean)).size;
      const result = await store.source.mergeMemories!([memory.id, withId], mergedText);
      store.applyPayload(result.graph);
      select(result.mergedMemoryId);
      // The migration story, told at the moment it matters: the merge changed
      // Mado's copy only — the originals it drew from are still held whole.
      useUiStore.getState().toast(t('toast.merged', { n: originals }));
    } catch {
      setMerge({ phase: 'error', withId });
    }
  };

  return (
    <>
      <div className="inspector__eyebrow">{t('inspector.memory')}</div>
      <p className="memory-text">{memory.text}</p>
      <div className="chips">
        {category && (
          <button className="chip" onClick={() => select(category.id)}>
            {category.name}
          </button>
        )}
        <span className="chip">{memory.kind}</span>
        {(memory.times_seen ?? 1) > 1 && (
          <span className="chip chip--times" data-testid="times-chip">
            {t('inspector.timesSeen', { n: memory.times_seen! })}
          </span>
        )}
        {memory.category_locked && <span className="chip chip--lock">{t('inspector.movedLock')}</span>}
      </div>
      {entities.length > 0 && (
        <div className="chips">
          {entities.map((e) => (
            <span key={e.id} className="chip chip--entity">
              {e.name}
            </span>
          ))}
        </div>
      )}
      {source && <SourceCard source={source} />}
      {/*
        Alike enough to be the same thought said twice — offer, never act. Its
        own section rather than a decoration on "related": related excludes
        same-source siblings, and one page saying the same thing twice is
        precisely the first merge a person wants. The AI explains why they
        overlap and drafts the one text that holds everything; the person
        decides. API mode only — the scripted demo cannot draft this honestly.
      */}
      {canMerge && candidates.length > 0 && (
        <>
          <div className="inspector__eyebrow">{t('inspector.merge.section')}</div>
          {candidates.map(({ memory: m }) => (
            <div key={m.id}>
              <MemoryRow memory={m} payload={payload} onSelect={select} />
              {merge?.withId !== m.id && (
                <button
                  className="merge__offer"
                  data-testid={`merge-offer-${m.id}`}
                  title={t('inspector.merge.title')}
                  onClick={() => void startMerge(m.id)}
                >
                  {t('inspector.merge')}
                </button>
              )}
              {merge?.withId === m.id && (
                <div className="merge" data-testid="merge-card">
                  {merge.phase === 'loading' && (
                    <p className="merge__note">{t('inspector.merge.loading')}</p>
                  )}
                  {merge.phase === 'error' && (
                    <p className="merge__note">{t('inspector.merge.error')}</p>
                  )}
                  {(merge.phase === 'preview' || merge.phase === 'applying') && (
                    <>
                      <div className="merge__eyebrow">{t('inspector.merge.why')}</div>
                      <p className="merge__reason" data-testid="merge-reason">
                        {merge.reason}
                      </p>
                      <div className="merge__eyebrow">{t('inspector.merge.result')}</div>
                      <p className="merge__text" data-testid="merge-text">
                        {merge.mergedText}
                      </p>
                      <div className="merge__actions">
                        <button
                          className="merge__confirm"
                          data-testid="merge-confirm"
                          disabled={merge.phase === 'applying'}
                          onClick={() =>
                            void confirmMerge(merge.withId, merge.reason, merge.mergedText)
                          }
                        >
                          {merge.phase === 'applying'
                            ? t('inspector.merge.applying')
                            : t('inspector.merge.confirm')}
                        </button>
                        <button
                          className="merge__cancel"
                          data-testid="merge-cancel"
                          onClick={() => setMerge(null)}
                        >
                          {t('inspector.merge.cancel')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {related.length > 0 && (
        <>
          <div className="inspector__eyebrow">{t('inspector.related')}</div>
          {related.map(({ memory: m }) => (
            <MemoryRow key={m.id} memory={m} payload={payload} onSelect={select} />
          ))}
        </>
      )}
      <div className="inspector__footer">
        <DeleteButton
          label={t('inspector.deleteMemoryLabel')}
          onConfirm={() => {
            useWorkspaceStore.getState().deleteMemory(memory.id);
            select(null);
            useUiStore.getState().toast(t('toast.deleted'));
          }}
        />
      </div>
    </>
  );
}

/**
 * Delete, as two clicks rather than a dialog.
 *
 * There is no undo to offer. `IngestPipeline.undo` re-assigns the memories in a
 * reorganization's before_state instead of re-inserting them, so a row this
 * takes away cannot be put back — and an Undo button that quietly fails is
 * worse than no Undo button. So the affordance asks first.
 *
 * Inline rather than a modal because a modal for one row is a interruption out
 * of proportion to the act, and because the confirm needs to say *what* is
 * about to go, which it can do in place. It disarms on blur, so a stray click
 * does not leave a loaded button sitting on the screen.
 */
function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`danger${armed ? ' danger--armed' : ''}`}
      data-testid="delete-button"
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? t('inspector.deleteArmed', { label }) : t('inspector.delete')}
    </button>
  );
}

function AnswerDetail() {
  const answer = useUiStore((s) => s.answer)!;
  const select = useUiStore((s) => s.select);
  const payload = useWorkspaceStore((s) => s.payload)!;

  // A refusal renders in the viewer's language; it cites nothing, so the
  // [n] splitting has nothing to lose from the substitution.
  const parts = (answer.refused ? t('ask.refusalText') : answer.answer)
    .split(/(\[\d+\])/g)
    .filter(Boolean);

  return (
    <>
      <div className="inspector__eyebrow">{t('inspector.answer')}</div>
      <h2 style={{ fontSize: 15, fontWeight: 400, marginBottom: 16 }}>{answer.question}</h2>
      <p className="answer" data-testid="answer">
        {parts.map((part, i) => {
          const match = /^\[(\d+)\]$/.exec(part);
          if (!match) return <span key={i}>{part}</span>;
          const n = Number(match[1]);
          const citation = answer.citations.find((c) => c.n === n);
          return (
            <button
              key={i}
              className="citation"
              data-testid={`citation-${n}`}
              onClick={() => citation && select(citation.memory_id)}
            >
              [{n}]
            </button>
          );
        })}
      </p>

      {answer.citations.length > 0 && <div className="inspector__eyebrow">{t('inspector.sources')}</div>}
      {answer.citations.map((c) => {
        const memory = payload.memories.find((m) => m.id === c.memory_id);
        const source = payload.sources.find((s) => s.id === c.source_id);
        if (!memory || !source) return null;
        return (
          <div key={c.n} style={{ marginBottom: 14 }}>
            <button className="memory-row" onClick={() => select(memory.id)}>
              <span className="memory-row__text">
                [{c.n}] {memory.text}
              </span>
              <span className="memory-row__meta">
                {SOURCE_LABEL[source.type]} · {source.title}
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}

/**
 * What the panel shows when nothing is selected.
 *
 * The counts used to be three lines of 25px display type, and they were right
 * to be: spec §5.4 asks this state to prove the corpus is real and already
 * organised, and back then it was only ever reached from *inside* the browser,
 * after deselecting something. The app opened on a separate welcome screen that
 * had no inspector at all.
 *
 * Merging the two screens put this in the first frame, where it became the
 * largest, highest-contrast type on a screen whose whole job is a quiet hilltop
 * and one question — out-shouting the greeting it exists to support. So: nothing
 * at all until you have looked around, because the greeting is already making
 * the point in a sentence, and a caption rather than a headline afterwards.
 *
 * The panel keeps its width either way. A column that appears when you select
 * something shoves the scene sideways, which is worse than a column that is
 * briefly empty.
 */
function EmptyDetail({ payload }: { payload: GraphPayload }) {
  const history = useUiStore((s) => s.reorgHistory);
  const welcomeDismissed = useUiStore((s) => s.welcomeDismissed);
  const view = useUiStore((s) => s.view);
  if (!welcomeDismissed) return null;
  return (
    <>
      <div className="inspector__eyebrow">{t('inspector.workspace')}</div>
      <div className="stats">
        {t('inspector.stats', {
          memories: payload.memories.length,
          sources: payload.sources.length,
          categories: payload.categories.length,
        })}
      </div>
      {/* The plan, where the scale already is: a trial counts down, and on
          free the sleeping count is the quiet standing door to waking. */}
      {(() => {
        const tDays = trialDaysLeft(payload.workspace);
        if (tDays !== null) {
          return (
            <div className="stats stats--trial" data-testid="trial-countdown">
              {t('inspector.trial', { days: tDays })}
            </div>
          );
        }
        const sleeping = sleepingCountOf(
          payload.memories,
          freeCutoff(payload.memories, effectivePlan(undefined, payload.workspace)),
        );
        if (sleeping === 0) return null;
        return (
          <button
            className="stats stats--sleeping"
            data-testid="sleeping-count"
            onClick={() => useUiStore.getState().setUpgradeSheet(true)}
          >
            {t('inspector.sleeping', { count: sleeping })}
          </button>
        );
      })()}

      {/*
        A legend, on the one screen that needs one.
        The map draws four kinds of thing in four colours and never said which
        was which — a viewer has no way to learn that the blue dots are people
        and companies rather than more memories. It also puts the 360px column
        to work: with nothing selected it was one line of text and an empty
        panel, which is the complaint the browsing screen already answered.
      */}
      {view === 'map' && (
        <>
          <div className="inspector__eyebrow">{t('inspector.legendTitle')}</div>
          <ul className="legend">
            {[
              ['#E8A33D', t('legend.category'), t('legend.categoryNote')],
              ['#B0782E', t('legend.sub'), t('legend.subNote')],
              ['#C9C9CE', t('legend.memory'), t('legend.memoryNote')],
              ['#5B8FB0', t('legend.entity'), t('legend.entityNote')],
            ].map(([colour, name, note]) => (
              <li key={name} className="legend__row">
                <span className="legend__dot" style={{ background: colour }} />
                <span className="legend__name">{name}</span>
                <span className="legend__note">{note}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {history.length > 0 && (
        <>
          <div className="inspector__eyebrow">{t('inspector.recent')}</div>
          {history.slice(0, 3).map((e) => (
            <div key={e.id} className="memory-row">
              <span className="memory-row__text">{e.banner_text.replace(/\*\*/g, '')}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/** Spec §5.4 Mode C — the full provenance of one capture. */
function SourceDetail({ source, payload }: { source: Source; payload: GraphPayload }) {
  const select = useUiStore((s) => s.select);
  const extracted = payload.memories.filter((m) => m.source_id === source.id);

  return (
    <>
      <div className="inspector__eyebrow">{t('inspector.source')}</div>
      <h2>{source.title}</h2>
      <div className="inspector__meta">
        {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)} ·{' '}
        {extracted.length} {extracted.length === 1 ? 'memory' : 'memories'}
      </div>

      {source.url && (
        <div className="chips">
          <a className="chip" href={source.url} target="_blank" rel="noreferrer noopener">
            {t('inspector.openLink')}
          </a>
        </div>
      )}

      <div className="source-card">
        <div className="source-card__type">
          {source.type === 'screenshot' ? t('inspector.sawTitle') : t('inspector.rawTitle')}
        </div>
        <div className="source-card__body">
          {source.type === 'screenshot' && source.scene_description
            ? source.scene_description
            : source.raw_content}
        </div>
      </div>

      {extracted.length === 0 ? (
        // The state the "It's in your Sources" toast points at. Saying so beats
        // an empty list that reads like a bug.
        <p className="inspector__meta">{t('inspector.emptySource')}</p>
      ) : (
        <>
          <div className="inspector__eyebrow">{t('inspector.extracted')}</div>
          {extracted.map((m) => (
            <MemoryRow key={m.id} memory={m} payload={payload} onSelect={select} />
          ))}
        </>
      )}
    </>
  );
}

export function Inspector() {
  const selectedId = useUiStore((s) => s.selectedId);
  const answer = useUiStore((s) => s.answer);
  const view = useUiStore((s) => s.view);
  const openCategoryId = useUiStore((s) => s.openCategoryId);
  const payload = useWorkspaceStore((s) => s.payload);

  if (!payload) return <aside className="inspector" data-testid="inspector" />;

  const category = payload.categories.find((c) => c.id === selectedId);
  const memory = payload.memories.find((m) => m.id === selectedId);
  const source = payload.sources.find((s) => s.id === selectedId);

  // In the browser the middle pane already renders the answer in full. Repeating
  // it here would be the third column saying what the second one just said.
  const answerShownInBrowser = view === 'browse' && openCategoryId === ANSWER_FOLDER_ID;
  const showAnswerHere = answer !== null && !answerShownInBrowser;

  return (
    <aside className="inspector" data-testid="inspector">
      {showAnswerHere && !selectedId ? (
        <AnswerDetail />
      ) : category ? (
        <CategoryDetail
          category={category}
          payload={payload}
          listMemories={view !== 'browse'}
        />
      ) : memory ? (
        <MemoryDetail memory={memory} payload={payload} />
      ) : source ? (
        <SourceDetail source={source} payload={payload} />
      ) : showAnswerHere ? (
        <AnswerDetail />
      ) : (
        <EmptyDetail payload={payload} />
      )}
    </aside>
  );
}
