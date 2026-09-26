import { useEffect, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useDismissable } from './useDismissable';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isOffline } from '../data/dataSource';
import { effectivePlan, trialDaysLeft, FREE_WINDOW_DAYS } from '../core/plan';
import { ReturnLink } from './ReturnLink';
import { t, currentLocale, chooseLocale } from '../i18n';
import type { GoogleStatus } from '../core/meetingTypes';

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

  /*
   * The calendar's row, only where the server has a door for it. The status
   * is asked for on open — the settings panel is where you come to check a
   * connection, so the answer should be the server's, not a cached one.
   */
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const hasGoogle = Boolean(source.googleStatus);
  useEffect(() => {
    if (!source.googleStatus) return;
    let live = true;
    void source
      .googleStatus()
      .then((status) => {
        if (live) setGoogle(status);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source]);

  const toggleGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      if (google?.connected) {
        await source.disconnectGoogle?.();
        setGoogle({ configured: true, connected: false, email: null });
        await useWorkspaceStore.getState().loadMeetings();
      } else if (source.connectGoogle) {
        const { url } = await source.connectGoogle();
        window.location.assign(url);
        return;
      }
    } catch {
      toast(t('toast.googleFailed'));
    }
    setGoogleBusy(false);
  };
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

        {hasGoogle && (
          <div className="settings__row">
            <span className="settings__body">
              <span className="settings__label">{t('settings.google.label')}</span>
              <span className="settings__hint" data-testid="settings-google-status">
                {google?.connected
                  ? t('settings.google.connected', { email: google.email ?? 'Google' })
                  : t('settings.google.off')}
              </span>
            </span>
            {google !== null && (
              <button
                className="settings__action"
                data-testid="settings-google"
                disabled={googleBusy}
                onClick={() => void toggleGoogle()}
              >
                {google.connected ? t('settings.google.disconnect') : t('settings.google.connect')}
              </button>
            )}
          </div>
        )}

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
              {trialDaysLeft(payload?.workspace) !== null
                ? t('settings.plan.trial', { days: trialDaysLeft(payload?.workspace)! })
                : effectivePlan(undefined, payload?.workspace) === 'free'
                  ? t('settings.plan.free', { days: FREE_WINDOW_DAYS })
                  : t('settings.plan.pro')}
            </span>
          </span>
          {effectivePlan(undefined, payload?.workspace) === 'free' && (
            <button
              className="settings__action"
              data-testid="settings-upgrade"
              onClick={() => useUiStore.getState().setUpgradeSheet(true)}
            >
              {t('settings.plan.upgrade')}
            </button>
          )}
        </div>

        <ReturnLinkRow />

        <div className="settings__row">
          <span className="settings__body">
            <span className="settings__label">{t('settings.welcome.label')}</span>
            <span className="settings__hint">{t('settings.welcome.hint')}</span>
          </span>
          <button
            className="settings__action"
            data-testid="settings-welcome-again"
            onClick={() => useUiStore.getState().welcomeAgain()}
          >
            {t('settings.welcome.action')}
          </button>
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

/** The way back, as a settings row — drawn only where there is a link to carry. */
function ReturnLinkRow() {
  const hasLink = Boolean(useWorkspaceStore((s) => s.source.returnLink));
  if (!hasLink) return null;
  return (
    <div className="settings__row settings__row--stack" data-testid="settings-return-link">
      <span className="settings__body">
        <span className="settings__label">{t('returnLink.label')}</span>
        <span className="settings__hint">{t('returnLink.hint')}</span>
      </span>
      <ReturnLink compact />
    </div>
  );
}
