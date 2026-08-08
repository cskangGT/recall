import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useUiStore, ANSWER_FOLDER_ID } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildTree, validateDrop, type TreeRow } from '../tree/buildTree';
import { arcPositions, fitArc, arcCapacity, seatByRank, paginate } from '../arc/layout';
import { corpusNow, interestScores, rankByInterest, savesFrom } from '../arc/interest';
import { useInterestStore } from '../store/interestStore';
import { starShape } from '../arc/star';
import { Thinker, FIGURE_DEBUG, DEBUG_SCALE } from './Thinker';
import { Composer } from './Composer';
import { CaptureStoryPanel } from './CaptureStoryPanel';
import { currentPlan, freeCutoff, isArchivedByPlan, FREE_WINDOW_DAYS } from '../core/plan';
import { startUpgrade } from '../billing/upgrade';
import { importFiles } from '../capture/importFiles';
import { importAppleNotesFlow } from '../capture/batchRun';
import { t, PRODUCT } from '../i18n';
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
  kind: 'folder' | 'back' | 'answer' | 'more';
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
  const interestEvents = useInterestStore((s) => s.events);
  const recordInterest = useInterestStore((s) => s.record);

  const shellRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 900, h: 900 });
  const [dragId, setDragId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const canImportNotes = Boolean(useWorkspaceStore((s) => s.source.importAppleNotes));
  const [dropId, setDropId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  /** Drives the fan-out animation; bumped on every level change. */
  const [levelSeq, setLevelSeq] = useState(0);
  /** Which page of the ranking the arc is showing. Reset on every level change. */
  const [page, setPage] = useState(0);
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

  const openRow = openCategoryId ? categoryRows.find((r) => r.id === openCategoryId) : undefined;
  const isOpen = showingAnswer || openRow !== undefined;

  const geometry = useMemo(() => fitArc(viewport, isOpen), [viewport, isOpen]);

  /*
   * How interesting each top-level category is, right now.
   *
   * Computed from the corpus and the interaction log, and only from those — not
   * from anything that changes as you point at things, so the arc does not
   * reshuffle under the cursor. `savesFrom` rolls a subcategory memory up to its
   * parent, which is the level the arc actually shows.
   */
  const scores = useMemo(() => {
    if (!payload) return new Map<string, number>();
    const saves = savesFrom(payload);
    return interestScores(saves, interestEvents, corpusNow(saves, new Date()));
  }, [payload, interestEvents]);

  const nodes = useMemo((): ArcNode[] => {
    const level = categoryRows.filter((r) =>
      effectiveLevelId === null ? r.depth === 0 : r.parentId === effectiveLevelId,
    );

    /*
     * Ranked, not listed.
     *
     * The arc used to show every category in the order the database created
     * them, which is a fact about the database. Being on the arc now means
     * "this is what you have been on lately" — so the ranking is the content,
     * and the map is where everything still lives.
     */
    const byId = new Map(level.map((r) => [r.id, r]));
    const ranked = rankByInterest(
      level.map((r) => r.id),
      scores,
    ).map((id) => byId.get(id)!);

    /*
     * What fits. The way out and the answer folder take a seat like anything
     * else, so they come off the budget before the categories do — at the
     * narrowest viewport the open state holds four marks total, which means
     * three children plus the way back.
     */
    const reserved = effectiveLevelId !== null || answer ? 1 : 0;
    const capacity = arcCapacity(geometry.radius) - reserved;
    const slice = paginate(ranked.length, capacity, page);
    const shown = ranked.slice(slice.start, slice.start + slice.count);

    // Seated by rank rather than in order: the apex is the position the eye
    // lands on, and it belongs to whatever you have been on most.
    const seats = seatByRank(shown.length);
    const seated: (typeof shown)[number][] = [];
    shown.forEach((row, rank) => {
      seated[seats[rank]!] = row;
    });

    const folders: ArcNode[] = seated.map((row) => ({
      id: row.id,
      label: row.label,
      count: row.count,
      kind: 'folder',
      row,
    }));

    if (slice.hidden > 0) {
      folders.push({
        id: '__more__',
        label: `${slice.hidden} more`,
        count: null,
        kind: 'more',
        row: null,
      });
    }

    if (effectiveLevelId !== null) {
      /*
       * Back sits at the left end, where the eye starts, and it says where it
       * goes rather than which direction it goes in.
       *
       * It used to be the word "Back", on the grounds that the parent's name was
       * already the breadcrumb at the top of the screen. But the breadcrumb
       * names where you *are*, and the only other place the hierarchy appeared
       * was that same word repeated over the reading list — so the one thing
       * nothing on screen told you was what is one level up. A category's place
       * in the structure is most of what a category means here.
       *
       * The destination, note, not the current level: from inside Fundraising
       * this returns to the top, so it reads "Everything".
       */
      const here = categoryRows.find((r) => r.id === effectiveLevelId);
      const up = here?.parentId ? categoryRows.find((r) => r.id === here.parentId) : undefined;
      folders.unshift({
        id: '__back__',
        label: up?.label ?? 'Everything',
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
  }, [categoryRows, effectiveLevelId, answer, answerMemories.length, scores, geometry.radius, page]);

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

  /*
   * The free window. Rows past it render archived — present but not readable —
   * and one line under the list says why and what opens them. An answer's
   * citations are never archived mid-answer: the answer already read them, and
   * redacting its own evidence would make the product look like it is lying.
   */
  const planCutoff = useMemo(
    () =>
      payload
        ? freeCutoff(payload.memories, currentPlan(undefined, payload.workspace.plan))
        : null,
    [payload],
  );
  const archivedCount = showingAnswer
    ? 0
    : contents.filter((m) => isArchivedByPlan(m.created_at, planCutoff)).length;

  const goTo = (levelId: string | null, back: boolean) => {
    setPage(0);
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
    // Paging a ranked list is meaningful: the next page is what you have been
    // on less. It wraps, so the mark is never a dead end.
    if (node.kind === 'more') {
      setPage((n) => n + 1);
      return;
    }
    // Opening a folder always fills the reading list. It additionally descends
    // when there is something to descend into — `AI Tooling` is flat in the
    // seed, and descending into it would empty the arc.
    openCategory(node.id);
    select(node.id);
    // Opening a category is the weakest of the three signals the arc ranks by,
    // and the only one the user performs without meaning to say anything.
    recordInterest(node.row?.parentId ?? node.id, 'opened');
    if (hasSubfolders(node.id)) goTo(node.id, false);
  };

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;

      /*
       * Nothing below this can run before the welcome is dismissed.
       *
       * The arc renders `welcomeDismissed ? nodes : []`, but this handler closed
       * over the full array regardless — so ArrowRight on the greeting opened a
       * category and dropped a reading list onto an empty sky, with no arc
       * anywhere to explain where it had come from. Backspace and ArrowUp did
       * the same.
       *
       * Enter is the exception, because the greeting promises it: "press Enter
       * to look around". It was promising something that did not happen. The
       * obvious fix is to focus the composer on mount, and it is the wrong one —
       * G, T, S and `,` are single-key shortcuts, and App's handler steps aside
       * for INPUT targets, so a focused composer would swallow all four and type
       * the letters instead. Handling Enter here keeps both.
       */
      if (!welcomeDismissed) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        dismissWelcome();
        return;
      }

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
  }, [nodes, openCategoryId, arcLevelId, categoryRows, welcomeDismissed, dismissWelcome]);

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
      toast(t('toast.twoLevels'));
      return;
    }
    if (rejection) return;

    if (dragged.kind === 'memory') {
      moveMemory(dragged.id, node.id);
      toast(t('toast.moved'));
    } else {
      moveCategory(dragged.id, node.id);
      toast(t('toast.movedInto', { a: dragged.label, b: node.label }));
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

  /*
   * The fill door, shared by both greetings. On an empty workspace it is the
   * whole point of the screen; on a seeded one it stands beside "look around".
   * One door either way: when the local Mac server offers a second source it
   * opens into the choice, otherwise it IS the file picker.
   */
  const fillDoor = (
    <>
      <button
        className="arc__door arc__door--fill"
        data-testid="door-fill"
        aria-expanded={canImportNotes ? fillOpen : undefined}
        onClick={() => {
          if (canImportNotes) setFillOpen((v) => !v);
          else fileInputRef.current?.click();
        }}
      >
        <span className="arc__door-name">{t('welcome.fill')}</span>
        <span className="arc__door-hint">{t('welcome.fillHint', { product: PRODUCT })}</span>
      </button>
    </>
  );

  const fillSources = fillOpen && canImportNotes && (
    <div className="arc__sources" data-testid="fill-sources">
      <button
        className="arc__source"
        data-testid="source-files"
        onClick={() => fileInputRef.current?.click()}
      >
        {t('welcome.sourceFiles')}
      </button>
      <button
        className="arc__source"
        data-testid="source-notes"
        onClick={() => void importAppleNotesFlow()}
      >
        {t('welcome.notes')}
      </button>
    </div>
  );

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      hidden
      data-testid="door-fill-input"
      accept=".txt,.md,.markdown,.csv,.json,.zip,text/*"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length > 0) void importFiles(files);
      }}
    />
  );

  const heading = showingAnswer
    ? t('answer.heading')
    : openRow
      ? openRow.label
      : t('welcome.prompt');

  return (
    /*
     * `--dragging` while something is in the air, so the arc can show where it
     * can go. A five-pixel point of light is a beautiful category and a hopeless
     * target: the hit area is the 88x62 box around it, but nothing on screen
     * said so, and you cannot aim at a box you cannot see.
     */
    <div
      className={`arc${dragId !== null ? ' arc--dragging' : ''}`}
      data-testid="arc-browser"
      ref={shellRef}
    >
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
            {/* "Move this group under" was the head of a sentence the chips
                below finished. They are gone until something is being dragged,
                so at rest it has to be a whole thought on its own. */}
            {reparenting
              ? 'Drop it on the category it belongs under'
              : 'Drag a group to file it under another'}
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
          const star = node.kind === 'folder' ? starShape(node.id, node.count) : null;
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
                {star ? (
                  <span
                    className="arc__star"
                    style={
                      {
                        '--star-core': `${star.core}px`,
                        '--star-glow': `${star.glow}px`,
                        '--star-spikes': `${star.spikes}px`,
                        '--star-tilt': `${star.tilt}deg`,
                      } as React.CSSProperties
                    }
                  />
                ) : (
                  <span className="arc__mark">
                    {node.kind === 'back' ? '←' : node.kind === 'more' ? '⋯' : '✦'}
                  </span>
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
        <Thinker size={(isOpen ? 120 : 190) * (FIGURE_DEBUG ? DEBUG_SCALE : 1)} />
      </div>

      {!isOpen &&
        (welcomeDismissed ? (
          <p className="arc__prompt">{heading}</p>
        ) : (
          <div className="arc__greeting" data-testid="welcome">
            {/*
              Two greetings, because there are two ways to arrive.
              The count was written for the seeded workspace, where it is the
              whole pitch: value before you have typed anything. Against an
              empty one it read "0 memories from 0 sources, already sorted" —
              a claim about nothing, made confidently, which is the worst
              possible first sentence for a product whose entire proposition is
              that it can be trusted to file things for you.
            */}
            {payload.memories.length === 0 ? (
              <>
                <p className="arc__greeting-line">{t('welcome.emptyTitle')}</p>
                <p className="arc__greeting-aside">{t('welcome.emptyAside')}</p>
                <div className="arc__doors">{fillDoor}</div>
                {fillSources}
                {fileInput}
              </>
            ) : (
              <>
                <p className="arc__greeting-line">{t('welcome.title')}</p>
                {/* The scale belongs in the sentence, where the eye already is —
                    the Inspector used to shout it from the corner instead. */}
                <p className="arc__greeting-aside">
                  {t('welcome.sub', {
                    memories: payload.memories.length,
                    sources: payload.sources.length,
                  })}
                </p>
                {/*
                  Two doors, because there are two kinds of first visit: someone
                  ready to pour their own files in, and someone who wants to see
                  what the tool even is before feeding it anything. The second
                  door is the old Enter-to-look-around, given a surface.
                */}
                <div className="arc__doors">
                  {fillDoor}
                  <button className="arc__door" data-testid="door-browse" onClick={dismissWelcome}>
                    <span className="arc__door-name">{t('welcome.browse')}</span>
                  </button>
                </div>
                {fillSources}
                {fileInput}
              </>
            )}
          </div>
        ))}

      {/* The conversation never moves. It is docked here on the first frame and
          stays docked; there is no welcome screen for it to travel from. */}
      <Composer firstRun={!welcomeDismissed} onSubmitted={dismissWelcome} />

      {isOpen && (
      <div className="reading" data-testid="reading-list" style={{ top: geometry.listTop }}>
        <div className="reading__head">
          <span>{heading}</span>
          {/* "Folder" was left over from the two-pane list this replaced, and
              then survived a stone and a star. There is nothing on this screen
              a person would call a folder; what is above them is a category
              with a name under it, so the hint says that. */}
          <span className="reading__hint">
            {showingAnswer ? t('reading.hint.answer') : t('reading.hint.folder')}
          </span>
        </div>

        {showingAnswer && answer && (
          <p className="reading__answer" data-testid="browser-answer">
            {answer.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1')}
          </p>
        )}

        {contents.map((memory, index) => {
          const source = payload.sources.find((s) => s.id === memory.source_id);
          const home = payload.categories.find((c) => c.id === memory.category_id);
          const archived = !showingAnswer && isArchivedByPlan(memory.created_at, planCutoff);
          // Several memories from one capture sit together in the list; naming
          // the source once per run reads as provenance, once per row as an
          // echo — the screen looked like it was stuttering.
          const repeatedSource = index > 0 && contents[index - 1]!.source_id === memory.source_id;
          if (archived) {
            return (
              <div
                key={memory.id}
                data-testid={`item-${memory.id}`}
                className="item item--archived"
                role="button"
                tabIndex={0}
                aria-label={t('reading.archived.aria')}
                onClick={() => useUiStore.getState().toast(t('toast.archivedTap'))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  useUiStore.getState().toast(t('toast.archivedTap'));
                }}
              >
                <span className="item__icon">{source ? SOURCE_ICON[source.type] : '·'}</span>
                <span className="item__body">
                  <span className="item__text item__text--archived" aria-hidden="true">
                    {memory.text}
                  </span>
                  <span className="item__meta">{t('reading.archived.meta', { date: memory.created_at.slice(0, 10) })}</span>
                </span>
                <span className="item__lock" title={t('reading.archived.title')}>
                  ◷
                </span>
              </div>
            );
          }
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
              /* Reachable by keyboard — this is the surface the arc exists to
                 fill, and it could only be operated with a mouse. A <button>
                 is not an option here for the same reason it is not on the arc:
                 a button that is also a drag source wedges Chromium's drag. */
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === memory.id}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                select(memory.id);
              }}
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
                  {repeatedSource ? '〃' : (source?.title ?? t('inspector.unknown'))}
                </span>
              </span>
              {memory.category_locked && (
                <span className="item__lock" title={t('reading.lock.title')}>
                  ⦿
                </span>
              )}
            </div>
          );
        })}

        {archivedCount > 0 && (
          <div className="reading__paywall" data-testid="plan-paywall">
            <span>
              {archivedCount === 1
                ? t('paywall.line.one', { days: FREE_WINDOW_DAYS })
                : t('paywall.line.many', { days: FREE_WINDOW_DAYS, count: archivedCount })}
            </span>
            <button
              className="reading__upgrade"
              data-testid="plan-upgrade"
              onClick={() => void startUpgrade()}
            >
              {t('paywall.cta')}
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
