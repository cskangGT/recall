import { useEffect, useRef, useState } from 'react';
import { useUiStore, ANSWER_FOLDER_ID } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Category, Memory, Source, GraphPayload } from '../core/types';

const SOURCE_LABEL: Record<Source['type'], string> = {
  text: 'Note',
  link: 'Link',
  screenshot: 'Screenshot',
};

const relativeDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function SourceCard({ source }: { source: Source }) {
  return (
    <div className="source-card" data-testid="source-card">
      <div className="source-card__type">
        {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)}
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
        {source ? SOURCE_LABEL[source.type] : 'Unknown'} · {relativeDate(memory.created_at)}
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
        title="Click to rename"
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
      <div className="inspector__eyebrow">Category</div>
      <CategoryName category={category} />
      <div className="inspector__meta">
        {parent ? `${parent.name} › ${category.name}` : 'Top level'} · {memories.length} memories
      </div>
      {locked && (
        <div className="chips">
          <span className="chip chip--lock">Named by you — AI won't reorganize this</span>
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
              {x.n} {SOURCE_LABEL[x.type].toLowerCase()}
              {x.n === 1 ? '' : 's'}
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

function MemoryDetail({ memory, payload }: { memory: Memory; payload: GraphPayload }) {
  const select = useUiStore((s) => s.select);
  const category = payload.categories.find((c) => c.id === memory.category_id);
  const source = payload.sources.find((s) => s.id === memory.source_id);
  const entities = payload.entities.filter((e) => memory.entity_ids.includes(e.id));

  return (
    <>
      <div className="inspector__eyebrow">Memory</div>
      <p className="memory-text">{memory.text}</p>
      <div className="chips">
        {category && (
          <button className="chip" onClick={() => select(category.id)}>
            {category.name}
          </button>
        )}
        <span className="chip">{memory.kind}</span>
        {memory.category_locked && <span className="chip chip--lock">Moved by you</span>}
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
    </>
  );
}

function AnswerDetail() {
  const answer = useUiStore((s) => s.answer)!;
  const select = useUiStore((s) => s.select);
  const payload = useWorkspaceStore((s) => s.payload)!;

  const parts = answer.answer.split(/(\[\d+\])/g).filter(Boolean);

  return (
    <>
      <div className="inspector__eyebrow">Answer</div>
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

      {answer.citations.length > 0 && <div className="inspector__eyebrow">Sources</div>}
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
  if (!welcomeDismissed) return null;
  return (
    <>
      <div className="inspector__eyebrow">Workspace</div>
      <div className="stats">
        {payload.memories.length} memories · {payload.sources.length} sources ·{' '}
        {payload.categories.length} categories
      </div>
      {history.length > 0 && (
        <>
          <div className="inspector__eyebrow">Recent changes</div>
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
      <div className="inspector__eyebrow">Source</div>
      <h2>{source.title}</h2>
      <div className="inspector__meta">
        {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)} ·{' '}
        {extracted.length} {extracted.length === 1 ? 'memory' : 'memories'}
      </div>

      {source.url && (
        <div className="chips">
          <a className="chip" href={source.url} target="_blank" rel="noreferrer noopener">
            Open link ↗
          </a>
        </div>
      )}

      <div className="source-card">
        <div className="source-card__type">
          {source.type === 'screenshot' ? 'What Recall saw' : 'Raw content'}
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
        <p className="inspector__meta">Recall couldn't find anything to remember in this.</p>
      ) : (
        <>
          <div className="inspector__eyebrow">Memories extracted from this</div>
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
