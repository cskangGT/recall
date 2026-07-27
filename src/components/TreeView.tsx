import { useEffect, useMemo, useState } from 'react';
import { useUiStore, ANSWER_FOLDER_ID } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildTree, validateDrop, type TreeRow } from '../tree/buildTree';
import type { GraphPayload, SourceType } from '../core/types';

/**
 * The folder browser — two panes, the way a file explorer works.
 *
 * It used to be one column with memories inlined as leaves. Expanding a
 * category then buried the structure under its own contents, which is exactly
 * what the hierarchy was there to show. Splitting it means the left pane only
 * ever holds folders, so the shape of the taxonomy stays readable however much
 * is in it, and the right pane answers "what is actually in here".
 */

const SOURCE_ICON: Record<SourceType, string> = {
  text: '✎',
  link: '↗',
  screenshot: '▣',
};

const SOURCE_LABEL: Record<SourceType, string> = {
  text: 'Note',
  link: 'Link',
  screenshot: 'Screenshot',
};

/**
 * The metaphor was missing entirely — indentation alone was doing all the work
 * of saying "this contains that".
 */
const FolderIcon = ({ open }: { open: boolean }) => (
  <svg className="folder__icon" viewBox="0 0 16 16" aria-hidden="true">
    {open ? (
      <path d="M1.6 13.2 3.9 7.4h11.5l-2.3 5.8Zm0-.7V4.2a1 1 0 0 1 1-1h3.1l1.4 1.6h5.3a1 1 0 0 1 1 1v1H3.5Z" />
    ) : (
      <path d="M1.6 12.4V4.2a1 1 0 0 1 1-1h3.1l1.4 1.6h6.3a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1Z" />
    )}
  </svg>
);

interface FolderNode {
  row: TreeRow;
  children: TreeRow[];
}

/** Categories only — memories live in the right pane now. */
function folderTree(payload: GraphPayload): FolderNode[] {
  const rows = buildTree(payload).filter((r) => r.kind !== 'memory');
  return rows
    .filter((r) => r.depth === 0)
    .map((row) => ({ row, children: rows.filter((c) => c.parentId === row.id) }));
}

export function TreeView() {
  const payload = useWorkspaceStore((s) => s.payload);
  const moveMemory = useWorkspaceStore((s) => s.moveMemory);
  const moveCategory = useWorkspaceStore((s) => s.moveCategory);

  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const openCategoryId = useUiStore((s) => s.openCategoryId);
  const openCategory = useUiStore((s) => s.openCategory);
  const expandedIds = useUiStore((s) => s.expandedIds);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const setExpanded = useUiStore((s) => s.setExpanded);
  const toast = useUiStore((s) => s.toast);
  const answer = useUiStore((s) => s.answer);
  const setAskOpen = useUiStore((s) => s.setAskOpen);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);

  const folders = useMemo(() => (payload ? folderTree(payload) : []), [payload]);
  const allRows = useMemo(() => (payload ? buildTree(payload) : []), [payload]);
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);

  // Land in a folder rather than staring at an empty right pane.
  useEffect(() => {
    if (!openCategoryId && folders.length > 0) {
      openCategory(folders[0]!.row.id);
      setExpanded(folders[0]!.row.id, true);
    }
  }, [folders, openCategoryId, openCategory, setExpanded]);

  const showingAnswer = openCategoryId === ANSWER_FOLDER_ID && answer !== null;
  const open = payload?.categories.find((c) => c.id === openCategoryId) ?? null;

  /** Citations that resolve to a memory we can actually show a row for. */
  const answerMemories = useMemo(() => {
    if (!payload || !answer) return [];
    return answer.citations
      .map((c) => payload.memories.find((m) => m.id === c.memory_id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
  }, [payload, answer]);

  /**
   * A folder shows its own memories plus everything in its subfolders, so the
   * count on the row and the contents below it agree. The answer folder instead
   * shows exactly what the answer cited, in citation order.
   */
  const contents = useMemo(() => {
    if (!payload) return [];
    if (showingAnswer) return answerMemories;
    if (!open) return [];
    const childIds = payload.categories.filter((c) => c.parent_id === open.id).map((c) => c.id);
    return payload.memories
      .filter((m) => m.category_id === open.id || childIds.includes(m.category_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  }, [payload, open, showingAnswer, answerMemories]);

  const rowById = (id: string) => allRows.find((r) => r.id === id);

  /** Folder rows you can actually see, top to bottom — what the arrows walk. */
  const visibleFolders = useMemo(
    () =>
      folders.flatMap(({ row, children }) =>
        expanded.has(row.id) ? [row, ...children] : [row],
      ),
    [folders, expanded],
  );

  // Arrow-key navigation over the folder pane (spec 6.1). Down/Up walk folders
  // and open them as they go, so the right pane always shows where you are.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;

      const index = visibleFolders.findIndex((r) => r.id === openCategoryId);
      const current = index >= 0 ? visibleFolders[index] : undefined;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
        const row = visibleFolders[Math.max(0, Math.min(visibleFolders.length - 1, next))];
        if (row) {
          openCategory(row.id);
          select(row.id);
        }
        return;
      }
      if (!current) return;
      e.preventDefault();
      setExpanded(current.id, e.key === 'ArrowRight');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleFolders, openCategoryId, openCategory, select, setExpanded]);

  const onDrop = (targetId: string) => {
    setDropId(null);
    const dragged = dragId ? rowById(dragId) : null;
    const target = rowById(targetId);
    setDragId(null);
    if (!dragged || !target) return;

    const rejection = validateDrop(dragged, target);
    if (rejection === 'depth') {
      setRejectedId(targetId);
      setTimeout(() => setRejectedId(null), 400);
      toast('Recall keeps categories two levels deep.');
      return;
    }
    if (rejection) return;

    if (dragged.kind === 'memory') {
      moveMemory(dragged.id, targetId);
      toast("Moved. Recall won't change this again.");
    } else {
      moveCategory(dragged.id, targetId);
      toast(`Moved ${dragged.label} into ${target.label}.`);
    }
    setExpanded(targetId, true);
  };

  const folderProps = (row: TreeRow) => {
    const dragged = dragId ? rowById(dragId) : null;
    const rejection = dragged ? validateDrop(dragged, row) : null;
    return {
      draggable: row.kind === 'child_category',
      onDragStart: () => setDragId(row.id),
      onDragEnd: () => {
        setDragId(null);
        setDropId(null);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!dragged) return;
        // A depth violation still accepts the dragover, or the browser never
        // fires `drop` and the user gets silence instead of an explanation.
        if (rejection !== null && rejection !== 'depth') return;
        e.preventDefault();
        if (rejection === null) setDropId(row.id);
      },
      onDragLeave: () => setDropId((id) => (id === row.id ? null : id)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        onDrop(row.id);
      },
      className: [
        'folder',
        `folder--d${row.depth}`,
        openCategoryId === row.id ? 'folder--open' : '',
        dropId === row.id && rejection === null ? 'folder--drop' : '',
        rejectedId === row.id ? 'folder--reject' : '',
        dragId === row.id ? 'folder--dragging' : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  };

  if (!payload) return <div className="browser" data-testid="tree-view" />;

  return (
    <div className="browser" data-testid="tree-view">
      <div className="browser__folders">
        <div className="browser__head">
          <span>Folders</span>
          <button className="browser__ask" data-testid="browser-ask" onClick={() => setAskOpen(true)}>
            Ask ⌘/
          </button>
        </div>

        {/* Ask is the point of the product; in the browser its result is just
            another folder, sitting above the ones Recall built. */}
        {answer && (
          <div
            className={`folder folder--d0 folder--answer${showingAnswer ? ' folder--open' : ''}`}
            data-testid="folder-answer"
            onClick={() => openCategory(ANSWER_FOLDER_ID)}
          >
            <span className="folder__twisty" />
            <span className="folder__icon folder__icon--answer">✦</span>
            <span className="folder__name">{answer.question}</span>
            {/* The count is what the folder actually holds. Citations that do
                not resolve to a memory cannot be shown, so counting them here
                would promise rows that never appear. */}
            <span className="folder__count">{answerMemories.length}</span>
          </div>
        )}

        {folders.map(({ row, children }) => {
          const isOpen = expanded.has(row.id);
          return (
            <div key={row.id} className="folder__group">
              <div
                {...folderProps(row)}
                data-row-id={row.id}
                data-testid={`folder-${row.id}`}
                onClick={() => {
                  openCategory(row.id);
                  select(row.id);
                  setExpanded(row.id, true);
                }}
              >
                {/* A folder with nothing under it gets a spacer, not a button
                    that says "Expand" and then does nothing. */}
                {children.length > 0 ? (
                  <button
                    className="folder__twisty"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    aria-expanded={isOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(row.id);
                    }}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="folder__twisty" />
                )}
                <FolderIcon open={isOpen} />
                <span className="folder__name">{row.label}</span>
                {row.locked && <span className="folder__lock" title="Pinned by you">⦿</span>}
                <span className="folder__count">{row.count}</span>
              </div>

              {isOpen && children.length > 0 && (
                <div className="folder__children">
                  {children.map((child) => (
                    <div
                      key={child.id}
                      {...folderProps(child)}
                      data-row-id={child.id}
                      data-testid={`folder-${child.id}`}
                      onClick={() => {
                        openCategory(child.id);
                        select(child.id);
                      }}
                    >
                      <span className="folder__twisty" />
                      <FolderIcon open={openCategoryId === child.id} />
                      <span className="folder__name">{child.label}</span>
                      {child.locked && <span className="folder__lock" title="Pinned by you">⦿</span>}
                      <span className="folder__count">{child.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="browser__contents" data-testid="folder-contents">
        <div className="browser__head">
          <span>{showingAnswer ? 'What Recall pulled' : open ? open.name : 'Nothing selected'}</span>
          <span className="browser__hint">
            {showingAnswer
              ? 'Drag any of these into a folder to keep it'
              : 'Drag an item onto a folder to re-file it'}
          </span>
        </div>

        {/* The answer itself, above its evidence — you read the conclusion, then
            the memories it came from, without leaving the browser. */}
        {showingAnswer && answer && (
          <p className="browser__answer" data-testid="browser-answer">
            {answer.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1')}
          </p>
        )}

        {contents.length === 0 ? (
          <p className="browser__empty">
            {showingAnswer ? 'Recall found nothing saved that answers this.' : 'This folder is empty.'}
          </p>
        ) : (
          contents.map((memory) => {
            const source = payload.sources.find((s) => s.id === memory.source_id);
            const home = payload.categories.find((c) => c.id === memory.category_id);
            return (
              <div
                key={memory.id}
                data-testid={`item-${memory.id}`}
                data-row-id={memory.id}
                className={[
                  'item',
                  selectedId === memory.id ? 'item--selected' : '',
                  dragId === memory.id ? 'item--dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable
                onDragStart={() => setDragId(memory.id)}
                onDragEnd={() => setDragId(null)}
                onClick={() => select(memory.id)}
              >
                <span className="item__icon" title={source ? SOURCE_LABEL[source.type] : undefined}>
                  {source ? SOURCE_ICON[source.type] : '·'}
                </span>
                <span className="item__body">
                  <span className="item__text">{memory.text}</span>
                  <span className="item__meta">
                    {home && home.id !== open?.id ? `${home.name} · ` : ''}
                    {source?.title ?? 'Unknown source'}
                  </span>
                </span>
                {memory.category_locked && (
                  <span className="item__lock" title="Moved by you — AI won't change it">⦿</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
