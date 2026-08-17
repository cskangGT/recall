import { useUiStore } from '../store/uiStore';
import { useDismissable } from './useDismissable';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isOffline } from '../data/dataSource';
import { currentPlan, FREE_WINDOW_DAYS } from '../core/plan';
import { startUpgrade } from '../billing/upgrade';
import { t, currentLocale, chooseLocale } from '../i18n';

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
  const mode = offline ? t('settings.source.offline') : source.mode;

  const reset = async () => {
    // Seed mode resets by reloading the committed corpus; the API has to be
    // told, because its copy lives in a database that survives a refresh.
    await load();
    setSettingsOpen(false);
    toast(t('toast.workspaceReset'));
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
          <span id="settings-title">{t('settings.title')}</span>
          <span>{t('settings.esc')}</span>
        </div>

        <label className="settings__row">
          <span className="settings__body">
            <span className="settings__label">{t('settings.auto.label')}</span>
            <span className="settings__hint">{t('settings.auto.hint')}</span>
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
            <span className="settings__label">{t('settings.source.label')}</span>
            <span className="settings__hint" data-testid="settings-mode">
              {mode}
            </span>
          </span>
          {!offline && (
            <a className="settings__action" href="?offline=1">
              {t('settings.source.goOffline')}
            </a>
          )}
        </div>

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">{t('settings.language.label')}</span>
            <span className="settings__hint">{t('settings.language.hint')}</span>
          </span>
          <button
            className="settings__action"
            data-testid="settings-language"
            onClick={() => chooseLocale(currentLocale() === 'ko' ? 'en' : 'ko')}
          >
            {currentLocale() === 'ko' ? 'English' : '한국어'}
          </button>
        </div>

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">{t('settings.plan.label')}</span>
            <span className="settings__hint" data-testid="settings-plan">
              {currentPlan(undefined, payload?.workspace.plan) === 'free'
                ? t('settings.plan.free', { days: FREE_WINDOW_DAYS })
                : t('settings.plan.pro')}
            </span>
          </span>
          {currentPlan(undefined, payload?.workspace.plan) === 'free' && (
            <button
              className="settings__action"
              data-testid="settings-upgrade"
              onClick={() => void startUpgrade()}
            >
              {t('settings.plan.upgrade')}
            </button>
          )}
        </div>

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">{t('settings.reset.label')}</span>
            <span className="settings__hint">{t('settings.reset.hint', { count: 47 })}</span>
          </span>
          <button className="settings__action" data-testid="reset-workspace" onClick={() => void reset()}>
            {t('settings.reset.action')}
          </button>
        </div>
      </div>
    </div>
  );
}
