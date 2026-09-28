import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * The way back.
 *
 * On a hosted Mado each visitor's workspace is known only to their browser —
 * clear it, or open another device, and the memories are still on the
 * server with no way to reach them. Until there is an account, this link is
 * the account: it carries the workspace (and the invite) and opening it
 * anywhere makes that browser this workspace's. Drawn only where there is a
 * visitor workspace to carry; the developer's fixed corpus has no such link.
 */
export function ReturnLink({ compact = false }: { compact?: boolean }) {
  const source = useWorkspaceStore((s) => s.source);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    (source.returnLink?.() ?? Promise.resolve(null)).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [source]);

  if (!link) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      useUiStore.getState().toast(t('returnLink.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, a denied permission): the link is on screen to select.
      useUiStore.getState().toast(t('returnLink.copyFailed'));
    }
  };

  return (
    <div className={`returnlink${compact ? ' returnlink--compact' : ''}`} data-testid="return-link">
      {!compact && <span className="returnlink__hint">{t('returnLink.hint')}</span>}
      <span className="returnlink__row">
        <input
          className="returnlink__url"
          data-testid="return-link-url"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t('returnLink.label')}
        />
        <button className="settings__action" data-testid="return-link-copy" onClick={() => void copy()}>
          {copied ? t('returnLink.copiedShort') : t('returnLink.copy')}
        </button>
      </span>
    </div>
  );
}
