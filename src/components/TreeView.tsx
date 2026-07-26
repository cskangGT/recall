import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildTree, visibleRows, validateDrop, type TreeRow } from '../tree/buildTree';
import type { SourceType } from '../types/graph';

const SOURCE_ICON: Record<SourceType, string> = {
  text: '✎',
  link: '↗',
  screenshot: '▣',
};

const SOURCE_TITLE: Record<SourceType, string> = {
  text: 'Note',
  link: 'Link',
  screenshot: 'Screenshot',
};

export function TreeView() {
  const payload = useWorkspaceStore((s) => s.payload);
  const moveMemory = useWorkspaceStore((s) => s.moveMemory);
  const moveCategory = useWorkspaceStore((s) => s.moveCategory);

  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const expandedIds = useUiStore((s) => s.expandedIds);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const setExpanded = useUiStore((s) => s.setExpanded);
  const toast = useUiStore((s) => s.toast);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => (payload ? buildTree(payload) : []), [payload]);
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);
  const visible = useMemo(() => visibleRows(rows, expanded), [rows, expanded]);

  const draggedRow = dragId ? rows.find((r) => r.id === dragId) ?? null : null;

  // Open the first parent on first paint so the tree never reads as an empty list.
  useEffect(() => {
    if (expandedIds.length === 0 && rows.length > 0) {
      setExpanded(rows[0]!.id, true);
    }
    // Only on first population.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Arrow-key navigation over the visible rows (spec 6.1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;

      const index = visible.findIndex((r) => r.id === selectedId);
      const current = index >= 0 ? visible[index] : undefined;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
        const row = visible[Math.max(0, Math.min(visible.length - 1, next))];
        if (row) select(row.id);
        return;
      }
      if (!current || current.kind === 'memory') return;
      e.preventDefault();
      if (e.key === 'ArrowRight') setExpanded(current.id, true);
      else setExpanded(current.id, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedId, select, setExpanded]);

  // Keep the selected row in view when it changes from elsewhere (map, Ask).
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector(`[data-row-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onDrop = (target: TreeRow) => {
    setDropId(null);
    if (!draggedRow) return;
    const rejection = validateDrop(draggedRow, target);
    setDragId(null);

    if (rejection === 'depth') {
      setRejectedId(target.id);
      setTimeout(() => setRejectedId(null), 400);
      toast('Recall keeps categories two levels deep.');
      return;
    }
    if (rejection) return;

    if (draggedRow.kind === 'memory') {
      moveMemory(draggedRow.id, target.id);
      toast("Moved. Recall won't change this again.");
    } else {
      moveCategory(draggedRow.id, target.id);
      toast(`Moved ${draggedRow.label} into ${target.label}.`);
    }
    setExpanded(target.id, true);
  };

  if (!payload) return <div className="tree" data-testid="tree-view" />;

  return (
    <div className="tree" data-testid="tree-view" ref={listRef}>
      <div className="tree__head">
        <span>Taxonomy</span>
        <span>Drag a memory onto a category to re-file it</span>
      </div>

      {visible.map((row) => {
        const isOpen = expanded.has(row.id);
        const isCategory = row.kind !== 'memory';
        const valid = draggedRow ? validateDrop(draggedRow, row) : null;
        const isDropTarget = dropId === row.id && draggedRow !== null && valid === null;

        return (
          <div
            key={row.id}
            data-row-id={row.id}
            data-testid={`tree-row-${row.id}`}
            className={[
              'tree__row',
              `tree__row--d${row.depth}`,
              row.kind === 'memory' ? 'tree__row--memory' : 'tree__row--category',
              selectedId === row.id ? 'tree__row--selected' : '',
              isDropTarget ? 'tree__row--drop' : '',
              rejectedId === row.id ? 'tree__row--reject' : '',
              dragId === row.id ? 'tree__row--dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            // Parent categories have nowhere to go, so they are not draggable.
            draggable={row.kind !== 'parent_category'}
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => {
              setDragId(null);
              setDropId(null);
            }}
            onDragOver={(e) => {
              if (!draggedRow) return;
              const rejection = validateDrop(draggedRow, row);
              // A depth violation still has to accept the drop, because
              // refusing it here means the browser never fires `drop` and the
              // user gets silence instead of an explanation. Only genuinely
              // inert targets — memories, a row's current parent — stay dead.
              if (rejection !== null && rejection !== 'depth') return;
              e.preventDefault();
              if (rejection === null) setDropId(row.id);
            }}
            onDragLeave={() => setDropId((id) => (id === row.id ? null : id))}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(row);
            }}
            onClick={() => select(row.id)}
            onDoubleClick={() => isCategory && toggleExpanded(row.id)}
          >
            {isCategory ? (
              <button
                className="tree__twisty"
                aria-label={isOpen ? 'Collapse' : 'Expand'}
                aria-expanded={isOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(row.id);
                }}
              >
                {row.hasChildren ? (isOpen ? '▾' : '▸') : '·'}
              </button>
            ) : (
              <span
                className="tree__icon"
                title={row.sourceType ? SOURCE_TITLE[row.sourceType] : undefined}
              >
                {row.sourceType ? SOURCE_ICON[row.sourceType] : ''}
              </span>
            )}

            <span className="tree__label">{row.label}</span>

            {row.locked && (
              <span className="tree__lock" title="Pinned by you — AI won't reorganize this">
                ⦿
              </span>
            )}
            {row.count !== null && <span className="tree__count">{row.count}</span>}
          </div>
        );
      })}
    </div>
  );
}
