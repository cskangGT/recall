import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';

/**
 * Bundling the picks — making the thought keep.
 *
 * Three ways, one panel, inside the bar above the input. A new category
 * takes the picks in under a name of the person's own and is locked as
 * theirs; an existing one takes them in the way a hand move does; and
 * "condense" has Mado draft one text for what they come to, which — if it
 * reads right — is kept as an ordinary note through the ordinary pipeline.
 * Every path ends where the result lives, with the picks put down.
 */
type Way = 'new' | 'existing' | 'condense';

export function Bundle({ onClose }: { onClose: () => void }) {
  const picked = useUiStore((s) => s.picked);
  const payload = useWorkspaceStore((s) => s.payload);
  const canCondense = Boolean(useWorkspaceStore((s) => s.source.condenseMemories));
  const canSuggest = Boolean(useWorkspaceStore((s) => s.source.suggestCategoryName));
  const [suggesting, setSuggesting] = useState(false);
  const [way, setWay] = useState<Way>('new');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (way !== 'condense' || draft !== null || !canCondense || picked.length < 2) return;
    let live = true;
    setBusy(true);
    useWorkspaceStore
      .getState()
      .source.condenseMemories!(picked)
      .then((r) => live && setDraft(r.text))
      .catch(() => live && useUiStore.getState().toast(t('bundle.condenseFailed')))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [way, draft, canCondense, picked]);

  if (!payload) return null;
  const roots = payload.categories.filter((c) => c.parent_id === null);

  /*
   * Bundling is not the end — it is where the thinking starts in earnest.
   * The picks stay in hand, now with a home, the mode stays on, and the
   * bar invites the conversation that decides what else belongs there.
   */
  const finish = (message: string, go: () => void) => {
    const ui = useUiStore.getState();
    ui.toast(message);
    onClose();
    go();
    document.querySelector<HTMLInputElement>('[data-testid="map-search-input"]')?.focus();
  };

  const suggest = async () => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const { name: proposed } = await useWorkspaceStore.getState().source.suggestCategoryName!(picked);
      setName(proposed);
    } catch {
      useUiStore.getState().toast(t('bundle.suggestFailed'));
    } finally {
      setSuggesting(false);
    }
  };

  const makeNew = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const id = await useWorkspaceStore.getState().createCategory(trimmed, picked);
      finish(t('bundle.made', { name: trimmed, count: picked.length }), () => {
        const ui = useUiStore.getState();
        ui.setBundle({ categoryId: id, name: trimmed });
        ui.setFindMode('map', 'ask');
        ui.requestZoomTo([id, ...picked]);
      });
    } catch {
      useUiStore.getState().toast(t('bundle.failed'));
    } finally {
      setBusy(false);
    }
  };

  const moveInto = () => {
    const category = payload.categories.find((c) => c.id === target);
    if (!category || busy) return;
    const store = useWorkspaceStore.getState();
    for (const id of picked) store.moveMemory(id, category.id);
    finish(t('bundle.moved', { name: category.name, count: picked.length }), () => {
      const ui = useUiStore.getState();
      ui.setBundle({ categoryId: category.id, name: category.name });
      ui.setFindMode('map', 'ask');
      ui.requestZoomTo([category.id, ...picked]);
    });
  };

  const keepDraft = async () => {
    const content = draft?.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const store = useWorkspaceStore.getState();
      const title = t('bundle.condensedTitle');
      let added: string[] = [];
      if (store.source.capture) {
        const result = await store.source.capture({ type: 'text', title, content });
        store.applyPayload(result.graph);
        added = result.addedMemoryIds ?? [];
      } else {
        const result = runBatchPipeline(store.payload!, [{ title, content }]);
        store.applyPayload(result.payload);
        added = result.addedMemoryIds;
      }
      // The note joins the picks: it is part of the thought now.
      finish(t('bundle.kept'), () => {
        const ui = useUiStore.getState();
        if (added.length > 0) ui.setPicked([...ui.picked, ...added]);
      });
    } catch {
      useUiStore.getState().toast(t('bundle.failed'));
    } finally {
      setBusy(false);
    }
  };

  const ways: { id: Way; label: string }[] = [
    { id: 'new', label: t('bundle.way.new') },
    { id: 'existing', label: t('bundle.way.existing') },
    ...(canCondense && picked.length >= 2 ? [{ id: 'condense' as Way, label: t('bundle.way.condense') }] : []),
  ];

  return (
    <div className="bundle" data-testid="bundle">
      <div className="bundle__ways" role="tablist" aria-label={t('bundle.title')}>
        {ways.map((w) => (
          <button
            key={w.id}
            role="tab"
            aria-selected={way === w.id}
            className={`bundle__way${way === w.id ? ' bundle__way--on' : ''}`}
            data-testid={`bundle-way-${w.id}`}
            onClick={() => setWay(w.id)}
          >
            {w.label}
          </button>
        ))}
        <button className="bundle__close" data-testid="bundle-close" aria-label={t('bundle.close')} onClick={onClose}>
          ×
        </button>
      </div>

      {way === 'new' && (
        <div className="bundle__row">
          <input
            className="bundle__input"
            data-testid="bundle-name"
            placeholder={t('bundle.namePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
              }
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void makeNew();
            }}
            autoFocus
          />
          {canSuggest && (
            <button
              className="picks__action picks__action--quiet"
              data-testid="bundle-suggest"
              disabled={suggesting}
              onClick={() => void suggest()}
            >
              {suggesting ? t('bundle.suggesting') : t('bundle.suggest')}
            </button>
          )}
          <button className="picks__action" data-testid="bundle-make" disabled={busy || !name.trim()} onClick={() => void makeNew()}>
            {t('bundle.make', { count: picked.length })}
          </button>
        </div>
      )}

      {way === 'existing' && (
        <div className="bundle__row">
          <select className="bundle__input" data-testid="bundle-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('bundle.pickCategory')}</option>
            {roots.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="picks__action" data-testid="bundle-move" disabled={busy || !target} onClick={moveInto}>
            {t('bundle.move', { count: picked.length })}
          </button>
        </div>
      )}

      {way === 'condense' && (
        <div className="bundle__condense">
          {draft === null ? (
            <p className="bundle__hint">{t('bundle.drafting')}</p>
          ) : (
            <>
              <textarea
                className="bundle__draft"
                data-testid="bundle-draft"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="bundle__row bundle__row--end">
                <span className="bundle__hint">{t('bundle.draftHint')}</span>
                <button className="picks__action" data-testid="bundle-keep" disabled={busy || !draft.trim()} onClick={() => void keepDraft()}>
                  {t('bundle.keep')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
