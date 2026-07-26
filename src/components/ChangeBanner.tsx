import { useEffect, useState, type ReactNode } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { undoReorg } from '../core/applyReorg';

const AUTO_DISMISS_MS = 12_000;

/** Banner copy carries **bold** segments straight from the reorg event. */
export function renderBannerMarkup(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

export function ChangeBanner() {
  const event = useUiStore((s) => s.reorgHistory[0] ?? null);
  const popReorg = useUiStore((s) => s.popReorg);
  const toast = useUiStore((s) => s.toast);
  const applyPayload = useWorkspaceStore((s) => s.applyPayload);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!event) return;
    setDismissed(false);
    const t = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [event?.id]);

  if (!event || dismissed) return null;

  const undo = () => {
    const popped = popReorg();
    if (!popped) return;
    applyPayload(undoReorg(popped));
    toast('Reverted.');
  };

  return (
    <div role="status" className="banner">
      <p className="banner__title">Recall reorganized your map</p>
      <p className="banner__body">{renderBannerMarkup(event.banner_text)}</p>
      <div className="banner__actions">
        <button onClick={undo}>Undo</button>
        <button onClick={() => setDismissed(true)}>Got it</button>
      </div>
    </div>
  );
}
