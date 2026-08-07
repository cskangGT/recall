import { useUiStore } from '../store/uiStore';
import { t } from '../i18n';
import { useWorkspaceStore } from '../store/workspaceStore';
import { undoReorg } from '../core/applyReorg';

/**
 * Undo the most recent reorganization, in whichever mode is running.
 *
 * Shared by the banner button and by ⌘Z. They were separate copies, which is
 * how one of them ends up still restoring from the client's snapshot after the
 * other has been taught to ask the server.
 *
 * In API mode the server owns the before-state, so undo is an id and a round
 * trip: the client's copy is the *post-capture* graph and restoring it would
 * put the split back.
 */
export function undoLastReorg(): void {
  const ui = useUiStore.getState();
  const popped = ui.popReorg();
  if (!popped) return;

  const ws = useWorkspaceStore.getState();
  if (ws.source.undo) {
    void ws.source
      .undo(popped.id)
      .then(ws.applyPayload)
      .catch(() => void useWorkspaceStore.getState().load());
  } else {
    ws.applyPayload(undoReorg(popped));
  }
  ui.toast(t('toast.reverted'));
}
