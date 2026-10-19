import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { effectivePlan, freeCutoff, sleepingCountOf, FREE_WINDOW_DAYS } from '../core/plan';
import { startUpgrade } from '../billing/upgrade';
import { t } from '../i18n';

/**
 * The one door to payment. Every wake CTA — the paywall line, a sleeping
 * star, the counter, the weekly card, Settings — opens this sheet rather than
 * checkout directly, so the price, the terms, and the promise ("no plan ever
 * deletes a memory") are always read before a card is. Loss says why; the
 * sheet says exactly what, for how much, and how to leave.
 */
export function UpgradeSheet() {
  const open = useUiStore((s) => s.upgradeSheet);
  const payload = useWorkspaceStore((s) => s.payload);
  if (!open || !payload) return null;

  // What actually wakes up — under a live trial nothing sleeps yet, so the
  // title speaks to keeping rather than waking.
  const count = sleepingCountOf(
    payload.memories,
    freeCutoff(payload.memories, effectivePlan(undefined, payload.workspace)),
  );
  const close = () => useUiStore.getState().setUpgradeSheet(false);

  return (
    <div className="sheet" data-testid="upgrade-sheet" role="dialog" aria-label={t('sheet.aria')} onClick={close}>
      <div className="sheet__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="sheet__title">
          {count > 0 ? t('sheet.title', { count }) : t('sheet.titleZero')}
        </h2>
        <p className="sheet__body">{t('sheet.body', { days: FREE_WINDOW_DAYS })}</p>
        <p className="sheet__price">{t('sheet.price')}</p>
        <p className="sheet__terms">{t('sheet.terms')}</p>
        <div className="sheet__actions">
          <button
            className="sheet__cta"
            data-testid="sheet-upgrade"
            autoFocus
            onClick={() => {
              close();
              void startUpgrade();
            }}
          >
            {t('sheet.cta')}
          </button>
          <button className="sheet__later" data-testid="sheet-later" onClick={close}>
            {t('sheet.later')}
          </button>
        </div>
        <p className="sheet__trust">{t('sheet.trust')}</p>
      </div>
    </div>
  );
}
