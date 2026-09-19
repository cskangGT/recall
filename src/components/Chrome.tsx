import { useEffect } from 'react';
import { useUiStore, STAGE_LABEL } from '../store/uiStore';
import { t } from '../i18n';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Where you are, and the one place that is not here.
 *
 * It spans the window, not the middle column. Living inside the browser it
 * stopped at that column's right edge, which is an invisible seam with a blank
 * inspector on the other side of it — so the controls crowded a line nobody can
 * see and the window's actual right edge stayed empty.
 *
 * There is no `Ask` link. Asking is the box at the bottom of the screen; a
 * header link to it was a second door onto the same room, and the rail still
 * has `?` for anyone who wants a button.
 */
/** The rail's four places, read off the store. */
export function whereabouts(st: {
  view: string;
  place: string;
  openCategoryId: string | null;
  answer: unknown;
}): 'home' | 'today' | 'memory' | 'diary' | 'other' {
  if (st.view === 'map' || st.view === 'sources') return 'memory';
  if (st.view === 'meetings') return 'today';
  if (st.view === 'diary') return 'diary';
  if (st.view !== 'browse') return 'other';
  if (st.openCategoryId !== null || st.answer !== null) return 'memory';
  return st.place === 'browse' ? 'memory' : st.place === 'today' ? 'today' : 'home';
}

/**
 * Memory is one place with three lenses: walk the categories, spread it all
 * out to brainstorm, or open the archive of what was handed over. They used
 * to be three rail buttons, told apart by how they drew the same corpus; a
 * person thinks "find that thing", not "which rendering". So the rail has
 * one Memory, and the lens is chosen here, where the looking happens. The
 * same find-or-ask bar opens from all three.
 */
export function TopBar() {
  const arcLevelId = useUiStore((s) => s.arcLevelId);
  const view = useUiStore((s) => s.view);
  const payload = useWorkspaceStore((s) => s.payload);
  const inMemory = useUiStore((s) => whereabouts(s) === 'memory');
  if (!inMemory) return null;

  const here =
    view !== 'browse' || arcLevelId === null
      ? null
      : (payload?.categories.find((c) => c.id === arcLevelId)?.name ?? null);

  const lens = (id: 'browse' | 'map' | 'sources', label: string, key: string) => (
    <button
      className={`lens${view === id ? ' lens--on' : ''}`}
      role="tab"
      aria-selected={view === id}
      data-testid={`lens-${id}`}
      onClick={() => {
        const ui = useUiStore.getState();
        if (id === 'browse') ui.goBrowse();
        else ui.setView(id);
      }}
    >
      {label}
      <kbd className="lens__key" aria-hidden="true">{key}</kbd>
    </button>
  );

  return (
    <div className="topbar topbar--lenses">
      <span className="topbar__here">
        {here !== null && (
          <>
            <span className="topbar__root">{t('topbar.everything')} › </span>
            {here}
          </>
        )}
      </span>
      <div className="lenses" role="tablist" aria-label={t('lens.aria')} data-testid="memory-lenses">
        {lens('browse', t('lens.browse'), 'T')}
        {lens('map', t('lens.map'), 'G')}
        {lens('sources', t('lens.sources'), 'S')}
      </div>
      <span />
    </div>
  );
}

export function LeftRail() {
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  // Where one stands, for the rail's sake. Anything opened over home or
  // today — a category, an answer — is the memory being read.
  const spot = useUiStore((st) => whereabouts(st));
  const home = spot === 'home';
  const today = spot === 'today';
  const memory = spot === 'memory';
  return (
    /*
     * Six glyphs are the entire navigation of this app, and to a screen reader
     * they were the entire *name* of it too — "◍", "⊞", "▤", "?", "⚙", "+".
     * `title` is a tooltip, not a label: it is announced by some readers, by
     * some settings, sometimes. `aria-label` is the one that always is.
     *
     * The shortcut stays in the name rather than being stripped, because a
     * keyboard user is exactly who benefits from being told there is a key for
     * this. `aria-current` marks where you are — the active view was carrying
     * that in a CSS class, which is invisible to everything but a monitor.
     */
    <nav className="rail" aria-label={t('rail.views')}>
      {/* The logo is the way home — people press it on instinct, and the
          instinct should be right. */}
      <button
        className="rail__mark"
        data-testid="rail-home"
        aria-current={home ? 'page' : undefined}
        aria-label={t('rail.home')}
        data-tip={t('rail.home.tip')}
        onClick={() => useUiStore.getState().goHome()}
      >
        M
      </button>
      {/* Four places, in the order of a day: the day's sheet, the memory
          (one place, three lenses — see MemoryLenses), and the page that
          closes it. The calendar lives inside today. */}
      <button
        className={`rail__btn${today ? ' rail__btn--active' : ''}`}
        data-tip={t('rail.today.tip')}
        aria-label={t('rail.today')}
        aria-current={today ? 'page' : undefined}
        data-testid="rail-today"
        onClick={() => useUiStore.getState().goToday()}
      >
        <span aria-hidden="true">◐</span>
        <span className="rail__label" aria-hidden="true">{t('rail.label.today')}</span>
      </button>
      <button
        className={`rail__btn${memory ? ' rail__btn--active' : ''}`}
        data-tip={t('rail.memory.tip')}
        aria-label={t('rail.memory')}
        aria-current={memory ? 'page' : undefined}
        data-testid="rail-tree"
        onClick={() => useUiStore.getState().goBrowse()}
      >
        <span aria-hidden="true">⊞</span>
        <span className="rail__label" aria-hidden="true">{t('rail.label.memory')}</span>
      </button>
      <button
        className={`rail__btn${view === 'diary' ? ' rail__btn--active' : ''}`}
        data-tip={t('rail.diary.tip')}
        aria-label={t('rail.diary')}
        data-testid="rail-diary"
        onClick={() => setView('diary')}
      >
        <span aria-hidden="true">✎</span>
        <span className="rail__label" aria-hidden="true">{t('rail.label.diary')}</span>
      </button>
      <div className="rail__spacer" />
      <button
        className="rail__btn"
        data-tip={t('rail.settings.tip')}
        aria-label={t('rail.settings')}
        data-testid="rail-settings"
        onClick={() => useUiStore.getState().setSettingsOpen(true)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      <button
        className="rail__btn"
        data-tip={t('rail.add.tip')}
        aria-label={t('rail.add')}
        data-testid="rail-capture"
        onClick={() => setCaptureOpen(true)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </nav>
  );
}

export function StatusTicker() {
  const stage = useUiStore((s) => s.captureStage);
  if (stage === 'idle') return null;
  return (
    // The only sign the pipeline is doing anything on Map and Sources.
    <div className="ticker" data-testid="status-ticker" aria-live="polite">
      <span className="ticker__dot" />
      {STAGE_LABEL[stage]}
    </div>
  );
}

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 4000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    /*
     * Announced, because this is where the confirmations live: every
     * drag-to-re-file lands here, and so does the refusal when you try to nest
     * a third level. A sighted user sees the answer to "did that work"; without
     * a live region nobody else gets one.
     *
     * `polite` rather than `assertive` — these follow an action the user just
     * took, so they can wait for a pause rather than cutting in.
     *
     * `aria-live` alone rather than `role="status"`, which would have implied
     * it. The change banner already claims that role, and a second one makes
     * "the status region" ambiguous — for anyone navigating by role, and for
     * the four tests that locate the banner that way.
     */
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function TooSmall() {
  return <div className="too-small">{t('tooSmall')}</div>;
}

export function Loading() {
  return (
    <div className="loading">
      <div className="loading__mark" />
    </div>
  );
}
