import { useUiStore } from '../store/uiStore';
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

function CategoryDetail({ category, payload }: { category: Category; payload: GraphPayload }) {
  const select = useUiStore((s) => s.select);
  const childIds = payload.categories.filter((c) => c.parent_id === category.id).map((c) => c.id);
  const memories = payload.memories
    .filter((m) => m.category_id === category.id || childIds.includes(m.category_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const parent = category.parent_id
    ? payload.categories.find((c) => c.id === category.parent_id)
    : null;
  const locked = category.name_locked || category.user_created;

  return (
    <>
      <div className="inspector__eyebrow">Category</div>
      <h2>{category.name}</h2>
      <div className="inspector__meta">
        {parent ? `${parent.name} › ${category.name}` : 'Top level'} · {memories.length} memories
      </div>
      {locked && (
        <div className="chips">
          <span className="chip chip--lock">Pinned by you — AI won't reorganize this</span>
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
      {memories.map((m) => (
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

function EmptyDetail({ payload }: { payload: GraphPayload }) {
  const history = useUiStore((s) => s.reorgHistory);
  return (
    <>
      <div className="inspector__eyebrow">Workspace</div>
      <div className="stats">
        <div className="stats__n">{payload.memories.length} memories</div>
        <div className="stats__n">{payload.sources.length} sources</div>
        <div className="stats__n">{payload.categories.length} categories</div>
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

export function Inspector() {
  const selectedId = useUiStore((s) => s.selectedId);
  const answer = useUiStore((s) => s.answer);
  const payload = useWorkspaceStore((s) => s.payload);

  if (!payload) return <aside className="inspector" data-testid="inspector" />;

  const category = payload.categories.find((c) => c.id === selectedId);
  const memory = payload.memories.find((m) => m.id === selectedId);

  return (
    <aside className="inspector" data-testid="inspector">
      {answer && !selectedId ? (
        <AnswerDetail />
      ) : category ? (
        <CategoryDetail category={category} payload={payload} />
      ) : memory ? (
        <MemoryDetail memory={memory} payload={payload} />
      ) : answer ? (
        <AnswerDetail />
      ) : (
        <EmptyDetail payload={payload} />
      )}
    </aside>
  );
}
