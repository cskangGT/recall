import { useEffect, useState, type ReactNode } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { undoLastReorg } from '../capture/undo';
import { currentLocale, t } from '../i18n';
import type { ReorgEvent } from '../core/applyReorg';
import type { GraphPayload } from '../core/types';

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

/**
 * The sentence the banner says, in the viewer's language.
 *
 * `banner_text` is stored English — it is written by the pipeline and kept so
 * history is stable (spec 8.4.5). In English it is rendered verbatim; in any
 * other locale the sentence is rebuilt from the event's own facts: the
 * affected category's name from the before-state, the created names from the
 * current payload. Falls back to the stored text when a piece is missing —
 * a banner in the wrong language beats no banner about a real change.
 */
export function localizedBannerText(event: ReorgEvent, payload: GraphPayload | null): string {
  if (currentLocale() === 'en') return event.banner_text;

  const beforeName = (id: string | undefined) =>
    event.before_state.categories.find((c) => c.id === id)?.name;
  const nowName = (id: string | undefined) =>
    payload?.categories.find((c) => c.id === id)?.name;

  if (event.operation === 'split') {
    const target = beforeName(event.affected_category_ids[0]);
    const a = nowName(event.created_category_ids[0]);
    const b = nowName(event.created_category_ids[1]);
    if (target && a && b) return t('banner.split', { target, a, b });
  }
  if (event.operation === 'merge') {
    const a = beforeName(event.affected_category_ids[0]);
    const b = beforeName(event.affected_category_ids[1]);
    const survivorId = event.affected_category_ids.find((id) => nowName(id) !== undefined);
    const result = nowName(survivorId);
    if (a && b && result) return t('banner.merge', { a, b, result });
  }
  if (event.operation === 'promote') {
    const name = nowName(event.affected_category_ids[0]) ?? beforeName(event.affected_category_ids[0]);
    if (name) return t('banner.promote', { name });
  }
  return event.banner_text;
}

export function ChangeBanner() {
  const event = useUiStore((s) => s.reorgHistory[0] ?? null);
  const payload = useWorkspaceStore((s) => s.payload);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!event) return;
    setDismissed(false);
    const timer = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [event?.id]);

  if (!event || dismissed) return null;

  return (
    <div role="status" className="banner">
      <p className="banner__title">{t('banner.title')}</p>
      <p className="banner__body">{renderBannerMarkup(localizedBannerText(event, payload))}</p>
      <div className="banner__actions">
        <button onClick={undoLastReorg}>{t('banner.undo')}</button>
        <button onClick={() => setDismissed(true)}>{t('banner.gotIt')}</button>
      </div>
    </div>
  );
}
