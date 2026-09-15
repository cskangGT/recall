import { useEffect } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { relatedMemories } from '../core/related';
import { useDismissable } from './useDismissable';
import { DeleteButton, MemoryRow, SOURCE_LABEL, relativeDate } from './Inspector';

/**
 * Found it — now read it.
 *
 * Every detail used to live in the inspector, a 360px column on the right
 * that reads as "still looking". A memory you have picked deserves the middle
 * of the screen: the sentence large, the original it was drawn from beneath
 * it (the Instagram post's description and caption, the note, the page), what
 * else came from that original, and what relates. The page floats over the
 * centre column only — the rail and the inspector stay where they are and
 * stay usable, so the quick look and the control panel are one click away.
 *
 * Escape and a click outside close it; the selection it came from stays.
 */
export function MemoryPage() {
  const sourceId = useUiStore((s) => s.sourcePage);
  if (sourceId) return <SourcePageView id={sourceId} />;
  return <MemoryPageView />;
}

/**
 * The same page for a source: the original in full, and what came from it.
 * Sources used to open only in the side column, which made the drawer the
 * one place where finding something did not put it in front of you.
 */
function SourcePageView({ id }: { id: string }) {
  const payload = useWorkspaceStore((s) => s.payload);
  const source = payload ? payload.sources.find((x) => x.id === id) : undefined;
  const close = useUiStore((s) => s.closeSourcePage);
  useEffect(() => {
    if (payload && !source) close();
  }, [payload, source, close]);
  const dismiss = useDismissable(close);
  if (!payload || !source) return null;

  const extracted = payload.memories.filter((m) => m.source_id === source.id);
  const open = (memoryId: string) => useUiStore.getState().openMemoryPage(memoryId);

  return (
    <div className="memorypage" data-testid="source-page" {...dismiss}>
      <article className="memorypage__card" role="dialog" aria-modal="true" aria-label={t('inspector.source')}>
        <div className="memorypage__head">
          <span className="memorypage__eyebrow">{t('inspector.source')}</span>
          <span className="memorypage__headactions">
            {/* The check, from the page: the same card the reveal offers,
                for this one source — reachable from where you are reading. */}
            {extracted.length > 0 && (
              <button
                className="memorypage__review"
                data-testid="source-page-review"
                onClick={() => {
                  const ui = useUiStore.getState();
                  ui.closeSourcePage();
                  ui.openReview([source.id]);
                }}
              >
                {source.reviewed_at ? t('sources.reviewed') : t('page.review')}
              </button>
            )}
            <button className="memorypage__close" data-testid="source-page-close" onClick={close}>
              {t('page.close')}
            </button>
          </span>
        </div>
        <p className="memorypage__text">{source.title}</p>
        <p className="memorypage__meta">
          {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)} ·{' '}
          {t('inspector.memoryCount', { count: extracted.length })}
          {source.url && (
            <>
              {' · '}
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {t('inspector.openLink')}
              </a>
            </>
          )}
        </p>
        <section className="memorypage__section">
          <div className="memorypage__eyebrow">
            {source.type === 'screenshot' ? t('inspector.sawTitle') : t('inspector.rawTitle')}
          </div>
          <div className="memorypage__original memorypage__original--tall" data-testid="source-page-original">
            {source.type === 'screenshot' && source.scene_description
              ? source.scene_description
              : source.raw_content}
          </div>
        </section>
        <section className="memorypage__section">
          <div className="memorypage__eyebrow">{t('inspector.extracted')}</div>
          {extracted.length === 0 ? (
            <p className="memorypage__meta">{t('inspector.emptySource')}</p>
          ) : (
            extracted.map((m) => <MemoryRow key={m.id} memory={m} payload={payload} onSelect={open} />)
          )}
        </section>
      </article>
    </div>
  );
}

function MemoryPageView() {
  const id = useUiStore((s) => s.memoryPage);
  const payload = useWorkspaceStore((s) => s.payload);
  const memory = payload && id ? payload.memories.find((m) => m.id === id) : undefined;
  const close = useUiStore((s) => s.closeMemoryPage);

  // A memory deleted or merged away while its page was open: the page goes
  // with it, quietly — an empty frame would read as a bug.
  useEffect(() => {
    if (id && payload && !memory) close();
  }, [id, payload, memory, close]);

  const dismiss = useDismissable(close);
  if (!payload || !memory) return null;

  const category = payload.categories.find((c) => c.id === memory.category_id);
  const source = payload.sources.find((s) => s.id === memory.source_id);
  const siblings = payload.memories.filter((m) => m.source_id === memory.source_id && m.id !== memory.id);
  const related = relatedMemories(payload, memory.id).filter(
    ({ memory: m }) => m.source_id !== memory.source_id,
  );
  const open = (memoryId: string) => useUiStore.getState().openMemoryPage(memoryId);

  return (
    <div className="memorypage" data-testid="memory-page" {...dismiss}>
      <article
        className="memorypage__card"
        role="dialog"
        aria-modal="true"
        aria-label={t('inspector.memory')}
      >
        <div className="memorypage__head">
          <span className="memorypage__eyebrow">
            {category ? (
              <button
                className="memorypage__crumb"
                data-testid="memory-page-crumb"
                onClick={() => {
                  const ui = useUiStore.getState();
                  ui.closeMemoryPage();
                  ui.setView('browse');
                  ui.openCategory(category.id);
                  ui.select(category.id);
                }}
              >
                {category.name}
              </button>
            ) : (
              t('inspector.memory')
            )}
          </span>
          <button className="memorypage__close" data-testid="memory-page-close" onClick={close}>
            {t('page.close')}
          </button>
        </div>

        <p className="memorypage__text" data-testid="memory-page-text">
          {memory.text}
        </p>
        {(memory.times_seen ?? 1) > 1 && (
          <p className="memorypage__meta">{t('inspector.timesSeen', { n: memory.times_seen! })}</p>
        )}

        {source && (
          <section className="memorypage__section">
            <div className="memorypage__eyebrow">{t('page.original')}</div>
            <div className="memorypage__source-head">
              <span className="memorypage__source-title">{source.title}</span>
              <span className="memorypage__meta">
                {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)}
                {source.url && (
                  <>
                    {' · '}
                    <a href={source.url} target="_blank" rel="noreferrer noopener">
                      {t('inspector.openLink')}
                    </a>
                  </>
                )}
              </span>
            </div>
            <div className="memorypage__original" data-testid="memory-page-original">
              {source.type === 'screenshot' && source.scene_description
                ? source.scene_description
                : source.raw_content}
            </div>
          </section>
        )}

        {siblings.length > 0 && (
          <section className="memorypage__section">
            <div className="memorypage__eyebrow">{t('page.alsoFrom')}</div>
            {siblings.map((m) => (
              <div key={m.id} data-testid={`memory-page-also-${m.id}`}>
                <MemoryRow memory={m} payload={payload} onSelect={open} />
              </div>
            ))}
          </section>
        )}

        {related.length > 0 && (
          <section className="memorypage__section">
            <div className="memorypage__eyebrow">{t('inspector.related')}</div>
            {related.map(({ memory: m }) => (
              <MemoryRow key={m.id} memory={m} payload={payload} onSelect={open} />
            ))}
          </section>
        )}

        {/* The hand, where the eye already is: re-file it, or throw it away.
            Both are the inspector's actions too — the page just stops
            sending you to the side for them. */}
        <div className="memorypage__actions">
          <label className="memorypage__move">
            {t('page.move')}
            <select
              data-testid="memory-page-move"
              value={memory.category_id}
              onChange={(e) => {
                const next = e.target.value;
                if (!next || next === memory.category_id) return;
                useWorkspaceStore.getState().moveMemory(memory.id, next);
                useUiStore.getState().toast(t('toast.moved'));
              }}
            >
              {payload.categories.map((c) => {
                const parent = c.parent_id ? payload.categories.find((p) => p.id === c.parent_id) : null;
                return (
                  <option key={c.id} value={c.id}>
                    {parent ? `${parent.name} · ${c.name}` : c.name}
                  </option>
                );
              })}
            </select>
          </label>
          <DeleteButton
            label={t('inspector.deleteMemoryLabel')}
            testId="memory-page-delete"
            onConfirm={() => {
              useWorkspaceStore.getState().deleteMemory(memory.id);
              useUiStore.getState().select(null);
              useUiStore.getState().toast(t('toast.deleted'));
            }}
          />
        </div>
      </article>
    </div>
  );
}
