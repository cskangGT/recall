import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useUiStore, ANSWER_FOLDER_ID } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildTree, validateDrop, type TreeRow } from '../tree/buildTree';
import { arcPositions, fitArc } from '../arc/layout';
import { pebbleShape } from '../arc/pebble';
import { Thinker } from './Thinker';
import { Composer } from './Composer';
import { CaptureStoryPanel } from './CaptureStoryPanel';
import type { SourceType } from '../core/types';

/**
 * The arc browser.
 *
 * Folders fan out above a small figure who is thinking about them, and you walk
 * into the structure one level at a time. This replaced a two-pane list, which
 * showed more at once — the trade is deliberate: browsing your own memory
 * should feel like wandering, and a list makes it feel like an inbox.
 *
 * Everything the list owned had to move here, not disappear: dragging a memory
 * onto a folder still re-files it (AC-28), a subfolder still cannot nest under
 * another subfolder (AC-31), and an answer is still a folder you can open.
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

/** A node on the arc. `row` is null for the synthetic back and answer nodes. */
interface ArcNode {
  id: string;
  label: string;
  count: number | null;
  kind: 'folder' | 'back' | 'answer';
  row: TreeRow | null;
}

export function ArcBrowser() {
  const payload = useWorkspaceStore((s) => s.payload);
  const moveMemory = useWorkspaceStore((s) => s.moveMemory);
  const moveCategory = useWorkspaceStore((s) => s.moveCategory);

  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const openCategoryId = useUiStore((s) => s.openCategoryId);
  const openCategory = useUiStore((s) => s.openCategory);
  const arcLevelId = useUiStore((s) => s.arcLevelId);
  const setArcLevel = useUiStore((s) => s.setArcLevel);
  const answer = useUiStore((s) => s.answer);
  const lastCapture = useUiStore((s) => s.lastCapture);
  const welcomeDismissed = useUiStore((s) => s.welcomeDismissed);
  const dismissWelcome = useUiStore((s) => s.dismissWelcome);
  const toast = useUiStore((s) => s.toast);

  const shellRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 900, h: 900 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  /** Drives the fan-out animation; bumped on every level change. */
  const [levelSeq, setLevelSeq] = useState(0);
  const [goingBack, setGoingBack] = useState(false);

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => (payload ? buildTree(payload) : []), [payload]);
  const categoryRows = useMemo(() => rows.filter((r) => r.kind !== 'memory'), [rows]);

  /**
   * Whether a category has *sub-categories* — not `TreeRow.hasChildren`, which
   * is also true for a parent holding memories directly. In the list view those
   * memories were expandable leaves; here they belong in the reading list, and
   * descending on them left the arc holding nothing but a Back node.
   */
  const hasSubfolders = (id: string) => categoryRows.some((r) => r.parentId === id);

  const showingAnswer = openCategoryId === ANSWER_FOLDER_ID && answer !== null;

  /** Citations that resolve to a memory we can show a row for. */
  const answerMemories = useMemo(() => {
    if (!payload || !answer) return [];
    return answer.citations
      .map((c) => payload.memories.find((m) => m.id === c.memory_id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
  }, [payload, answer]);

  /**
   * Picking up a subfolder reveals the parents as an extra strip of targets.
   *
   * Re-parenting needs somewhere to drop: you can only drag a subfolder while
   * standing inside its parent's arc, where no other parent is on screen. The
   * first attempt swapped the arc itself to the parent level — which unmounts
   * the dragged node's siblings mid-drag and wedges the browser's drag loop
   * outright, hanging the whole gesture. Adding elements during a drag is safe;
   * removing the ones around the source is not. So the arc is left alone and
   * the targets arrive alongside it.
   */
  const draggedRow = dragId ? rows.find((r) => r.id === dragId) ?? null : null;
  const reparenting = draggedRow?.kind === 'child_category';
  const effectiveLevelId = arcLevelId;

  const nodes = useMemo((): ArcNode[] => {
    const level = categoryRows.filter((r) =>
      effectiveLevelId === null ? r.depth === 0 : r.parentId === effectiveLevelId,
    );
    const folders: ArcNode[] = level.map((row) => ({
      id: row.id,
      label: row.label,
      count: row.count,
      kind: 'folder',
      row,
    }));

    if (effectiveLevelId !== null) {
      // Back sits at the left end, where the eye starts. Labelled just "Back":
      // the parent's name is already the breadcrumb at the top of the screen,
      // and a long label here overlapped its neighbour on the arc.
      folders.unshift({
        id: '__back__',
        label: 'Back',
        count: null,
        kind: 'back',
        row: null,
      });
    } else if (answer) {
      folders.unshift({
        id: ANSWER_FOLDER_ID,
        label: answer.question,
        count: answerMemories.length,
        kind: 'answer',
        row: null,
      });
    }
    return folders;
  }, [categoryRows, effectiveLevelId, answer, answerMemories.length]);

  const openRow = openCategoryId ? categoryRows.find((r) => r.id === openCategoryId) : undefined;
  const isOpen = showingAnswer || openRow !== undefined;

  const geometry = useMemo(() => fitArc(viewport, isOpen), [viewport, isOpen]);
  const points = useMemo(
    () => arcPositions(nodes.length, geometry.radius),
    [nodes.length, geometry.radius],
  );

  /** The reading list: the open folder's memories, or the answer's citations. */
  const contents = useMemo(() => {
    if (!payload) return [];
    if (showingAnswer) return answerMemories;
    if (!openRow) return [];
    const childIds = payload.categories
      .filter((c) => c.parent_id === openRow.id)
      .map((c) => c.id);
    return payload.memories
      .filter((m) => m.category_id === openRow.id || childIds.includes(m.category_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  }, [payload, openRow, showingAnswer, answerMemories]);

  const goTo = (levelId: string | null, back: boolean) => {
    setGoingBack(back);
    setArcLevel(levelId);
    setLevelSeq((n) => n + 1);
  };

  const activate = (node: ArcNode) => {
    if (node.kind === 'back') {
      const parent = categoryRows.find((r) => r.id === arcLevelId);
      goTo(parent?.parentId ?? null, true);
      openCategory(parent?.parentId ?? null);
      select(parent?.parentId ?? null);
      return;
    }
    if (node.kind === 'answer') {
      openCategory(ANSWER_FOLDER_ID);
      select(null);
      return;
    }
    // Opening a folder always fills the reading list. It additionally descends
    // when there is something to descend into — `AI Tooling` is flat in the
    // seed, and descending into it would empty the arc.
    openCategory(node.id);
    select(node.id);
    if (hasSubfolders(node.id)) goTo(node.id, false);
  };

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const focusIndex = nodes.findIndex((n) => n.id === openCategoryId);

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = focusIndex + (e.key === 'ArrowRight' ? 1 : -1);
        const node = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
        if (node && node.kind === 'folder') {
          openCategory(node.id);
          select(node.id);
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        const node = nodes[focusIndex];
        if (!node || node.kind !== 'folder' || !hasSubfolders(node.id)) return;
        e.preventDefault();
        goTo(node.id, false);
        return;
      }
      // Backspace climbs one level. Escape is left to the store's own order.
      if (e.key === 'Backspace' || e.key === 'ArrowUp') {
        if (arcLevelId === null) return;
        e.preventDefault();
        const parent = categoryRows.find((r) => r.id === arcLevelId);
        goTo(parent?.parentId ?? null, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, openCategoryId, arcLevelId, categoryRows]);

  // ----------------------------------------------------------------- drag
  const finishDrop = (node: ArcNode) => {
    setDropId(null);
    const dragged = dragId ? rows.find((r) => r.id === dragId) ?? null : null;
    setDragId(null);
    if (!dragged || !node.row) return;

    const rejection = validateDrop(dragged, node.row);
    if (rejection === 'depth') {
      setRejectedId(node.id);
      setTimeout(() => setRejectedId(null), 420);
      toast('Recall keeps categories two levels deep.');
      return;
    }
    if (rejection) return;

    if (dragged.kind === 'memory') {
      moveMemory(dragged.id, node.id);
      toast("Moved. Recall won't change this again.");
    } else {
      moveCategory(dragged.id, node.id);
      toast(`Moved ${dragged.label} into ${node.label}.`);
    }
  };

  const dropProps = (node: ArcNode) => {
    const dragged = dragId ? rows.find((r) => r.id === dragId) ?? null : null;
    const rejection = dragged && node.row ? validateDrop(dragged, node.row) : 'invalid';
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragged) return;
        // A depth violation still accepts the dragover, or the browser never
        // fires `drop` and the user gets silence instead of an explanation.
        if (rejection !== null && rejection !== 'depth') return;
        e.preventDefault();
        if (rejection === null) setDropId(node.id);
      },
      onDragLeave: () => setDropId((id) => (id === node.id ? null : id)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        finishDrop(node);
      },
      'data-droppable': rejection === null ? 'yes' : 'no',
    };
  };

  if (!payload) return <div className="arc" data-testid="arc-browser" ref={shellRef} />;

  const heading = showingAnswer
    ? 'What Recall pulled'
    : openRow
      ? openRow.label
      : 'Where would you like to look?';

  return (
    <div className="arc" data-testid="arc-browser" ref={shellRef}>
      <CaptureStoryPanel />

      {/*
        Always mounted, shown with CSS. Anything that mounts or unmounts while an
        HTML5 drag is in flight wedges Chromium's drag loop — that is what made
        the first two attempts at this hang the browser outright. Toggling
        visibility touches no DOM nodes, so the drag survives.
      */}
      {arcLevelId !== null && (
        <div
          className={`reparent${reparenting ? ' reparent--active' : ''}`}
          data-testid="reparent-hint"
          aria-hidden={!reparenting}
        >
          <span className="reparent__label">
            {reparenting ? 'Drop it on the category it belongs under' : 'Move this group under'}
          </span>
          <span className="reparent__targets">
            {categoryRows
              .filter((r) => r.depth === 0)
              .map((row) => {
                const target: ArcNode = {
                  id: row.id,
                  label: row.label,
                  count: row.count,
                  kind: 'folder',
                  row,
                };
                return (
                  <span
                    key={row.id}
                    data-testid={`reparent-target-${row.id}`}
                    className={`reparent__target${
                      dropId === row.id ? ' reparent__target--drop' : ''
                    }`}
                    {...dropProps(target)}
                  >
                    {row.label}
                  </span>
                );
              })}
          </span>
        </div>
      )}

      {/* The rainbow. Keyed on the level so React remounts it and the fan-out
          animation replays on every descent and every step back. */}
      {/*
        A full-size layer, not a zero-sized box pinned at the focus. Nodes used
        to be positioned inside a 0×0 container, and a drag source with no
        laid-out ancestor wedges Chromium's drag the moment the pointer moves —
        the browser hangs outright. Offsets are added to the focus instead.
      */}
      <div className={`arc__fan${goingBack ? ' arc__fan--back' : ''}`} key={levelSeq}>
        {/*
          Nothing on the arc until you have looked around. There is no second
          screen to arrive at any more — the categories fan into the sky you are
          already standing under, which is what makes "look around" mean looking
          rather than navigating.
        */}
        {(welcomeDismissed ? nodes : []).map((node, i) => {
          const point = points[i];
          if (!point) return null;
          const active = openCategoryId === node.id;
          const stone = node.kind === 'folder' ? pebbleShape(node.id, node.count) : null;
          return (
            // A div rather than a <button>, deliberately. A <button> that is
            // also an HTML5 drag source leaves Chromium stuck in a drag state
            // that the pointer release never clears, which hangs the drag
            // outright. Keyboard access is put back by hand below.
            <div
              key={node.id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                activate(node);
              }}
              data-testid={`arc-node-${node.id}`}
              data-row-id={node.id}
              className={[
                'arc__node',
                `arc__node--${node.kind}`,
                active ? 'arc__node--active' : '',
                dropId === node.id ? 'arc__node--drop' : '',
                rejectedId === node.id ? 'arc__node--reject' : '',
                dragId === node.id ? 'arc__node--dragging' : '',
                // The category the last capture landed in, so the account in the
                // panel and the thing on the arc are visibly the same category.
                lastCapture?.destination === node.label ? 'arc__node--landed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  left: geometry.focus.x + point.x,
                  top: geometry.focus.y + point.y,
                  '--i': i,
                } as React.CSSProperties
              }
              draggable={node.row?.kind === 'child_category'}
              onDragStart={(e) => {
                if (!node.row) return;
                // Chromium hangs generating a drag image from a subtree that
                // carries a blur — the node's form has always had one, and
                // dragging a subcategory locked the browser up entirely. Give
                // it the plain text label to snapshot instead, which also makes
                // a better preview than a blurred blob.
                const label = e.currentTarget.querySelector('.arc__label');
                if (label) e.dataTransfer.setDragImage(label as Element, 12, 10);
                setDragId(node.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropId(null);
              }}
              {...dropProps(node)}
              onClick={() => activate(node)}
            >
              <span className="arc__form">
                {stone ? (
                  <span
                    className="arc__pebble"
                    style={
                      {
                        '--pebble-w': `${stone.width}px`,
                        '--pebble-h': `${stone.height}px`,
                        '--pebble-r': stone.radius,
                      } as React.CSSProperties
                    }
                  />
                ) : (
                  <span className="arc__mark">{node.kind === 'back' ? '←' : '✦'}</span>
                )}
              </span>
              <span className="arc__label">{node.label}</span>
              {node.count !== null && <span className="arc__count">{node.count}</span>}
            </div>
          );
        })}
      </div>

      {/* The figure sits on the crest, at the arc's focus, looking at what is
          above it. */}
      <div
        className={`arc__thinker${isOpen ? ' arc__thinker--small' : ''}`}
        style={{ left: geometry.focus.x, top: geometry.focus.y }}
      >
        <Thinker size={isOpen ? 78 : 118} />
      </div>

      {!isOpen &&
        (welcomeDismissed ? (
          <p className="arc__prompt">{heading}</p>
        ) : (
          <div className="arc__greeting" data-testid="welcome">
            <p className="arc__greeting-line">Want to think something through?</p>
            {/* The scale belongs in the sentence, where the eye already is —
                the Inspector used to shout it from the corner instead. */}
            <p className="arc__greeting-aside">
              Everything you've saved — {payload.memories.length} memories from{' '}
              {payload.sources.length} sources — is already sorted. Ask me anything about
              it, or press Enter to look around.
            </p>
          </div>
        ))}

      {/* The conversation never moves. It is docked here on the first frame and
          stays docked; there is no welcome screen for it to travel from. */}
      <Composer firstRun={!welcomeDismissed} onSubmitted={dismissWelcome} />

      {isOpen && (
      <div className="reading" data-testid="reading-list" style={{ top: geometry.listTop }}>
        <div className="reading__head">
          <span>{heading}</span>
          <span className="reading__hint">
            {showingAnswer
              ? 'Drag any of these onto a folder to keep it'
              : 'Drag one onto a folder to re-file it'}
          </span>
        </div>

        {showingAnswer && answer && (
          <p className="reading__answer" data-testid="browser-answer">
            {answer.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1')}
          </p>
        )}

        {contents.map((memory) => {
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
                  {home && home.id !== openRow?.id ? `${home.name} · ` : ''}
                  {source?.title ?? 'Unknown source'}
                </span>
              </span>
              {memory.category_locked && (
                <span className="item__lock" title="Moved by you — AI won't change it">
                  ⦿
                </span>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
