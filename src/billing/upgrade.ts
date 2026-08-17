import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';
import { t } from '../i18n';

/**
 * What the upgrade buttons do — one function, because the paywall line and the
 * Settings row must never disagree about it.
 *
 * API mode asks the server for a checkout session and walks into Stripe's
 * hosted page; the plan flips when the webhook confirms payment, and the user
 * lands back here with `?upgraded=1`. Seed mode has no server and therefore no
 * way to pay — the toast says what the button will eventually do.
 */
export async function startUpgrade(): Promise<void> {
  const source = useWorkspaceStore.getState().source;
  const ui = useUiStore.getState();

  if (!source.upgrade) {
    ui.toast(t('toast.upgradeSeed'));
    return;
  }

  try {
    const returnUrl = `${window.location.origin}${window.location.pathname}`;
    const { url } = await source.upgrade(returnUrl);
    window.location.href = url;
  } catch (err) {
    ui.toast(
      err instanceof Error
        ? t('toast.upgradeFailedWith', { message: err.message })
        : t('toast.upgradeFailed'),
    );
  }
}
