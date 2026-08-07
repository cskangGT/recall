import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';

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
    ui.toast('Recall Pro remembers everything. Payments live on the hosted build.');
    return;
  }

  try {
    const returnUrl = `${window.location.origin}${window.location.pathname}`;
    const { url } = await source.upgrade(returnUrl);
    window.location.href = url;
  } catch (err) {
    ui.toast(
      err instanceof Error ? `Couldn't start the upgrade — ${err.message}` : "Couldn't start the upgrade.",
    );
  }
}
