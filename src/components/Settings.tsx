import { useUiStore } from '../store/uiStore';
import { useDismissable } from './useDismissable';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isOffline } from '../data/dataSource';
import { currentPlan, FREE_WINDOW_DAYS } from '../core/plan';
import { startUpgrade } from '../billing/upgrade';

/**
 * Settings, kept deliberately small.
 *
 * Spec §17 rules out "a settings page with twelve sections", and it is right to:
 * a personal tool that needs configuring has failed to decide something. So this
 * is not a screen. It is a panel holding the switches that already exist in the
 * data model and had no way to be flipped, plus the two facts a presenter needs
 * to be able to check before walking on stage.
 *
 * Everything here does something. Nothing here is a preference.
 */
export function Settings() {
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const toast = useUiStore((s) => s.toast);
  const payload = useWorkspaceStore((s) => s.payload);
  const setAutoReorganize = useWorkspaceStore((s) => s.setAutoReorganize);
  const source = useWorkspaceStore((s) => s.source);
  const load = useWorkspaceStore((s) => s.load);

  const auto = payload?.workspace.auto_reorganize ?? true;
  const offline = isOffline();
  const mode = offline ? 'Offline — seeded data, no network' : source.mode;

  const reset = async () => {
    // Seed mode resets by reloading the committed corpus; the API has to be
    // told, because its copy lives in a database that survives a refresh.
    await load();
    setSettingsOpen(false);
    toast('Workspace reset.');
  };

  return (
    /*
     * A dialog, and dismissed on click rather than on pointerdown.
     *
     * Neither of these was true. Without `role="dialog"` and `aria-modal` a
     * reader treats this as more page — it reads the map behind it, and there
     * is nothing to say you have entered anything. And closing on
     * *pointerdown* meant selecting text inside the box and releasing a few
     * pixels outside it threw the panel away along with everything typed into
     * it, which is a gesture people make constantly.
     */
    <div className="overlay" {...useDismissable(() => setSettingsOpen(false))}>
      <div
        className="bar settings"
        data-testid="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="bar__head">
          <span id="settings-title">Settings</span>
          <span>esc</span>
        </div>

        <label className="settings__row">
          <span className="settings__body">
            <span className="settings__label">Let Recall reorganize on its own</span>
            <span className="settings__hint">
              Off means new items still get filed — the structure just stops moving
              without you.
            </span>
          </span>
          <input
            type="checkbox"
            data-testid="auto-reorganize"
            checked={auto}
            onChange={(e) => setAutoReorganize(e.target.checked)}
          />
        </label>

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">Data source</span>
            <span className="settings__hint" data-testid="settings-mode">
              {mode}
            </span>
          </span>
          {!offline && (
            <a className="settings__action" href="?offline=1">
              Go offline
            </a>
          )}
        </div>

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">Plan</span>
            <span className="settings__hint" data-testid="settings-plan">
              {currentPlan(undefined, payload?.workspace.plan) === 'free'
                ? `Free — your last ${FREE_WINDOW_DAYS} days, organized and askable. Older saves are archived, never deleted.`
                : 'Pro — everything you ever saved, organized and askable.'}
            </span>
          </span>
          {currentPlan(undefined, payload?.workspace.plan) === 'free' && (
            <button
              className="settings__action"
              data-testid="settings-upgrade"
              onClick={() => void startUpgrade()}
            >
              Upgrade
            </button>
          )}
        </div>

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">Reset the workspace</span>
            <span className="settings__hint">
              Back to the 47 seeded memories. Captures and corrections are discarded.
            </span>
          </span>
          <button className="settings__action" data-testid="reset-workspace" onClick={() => void reset()}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
