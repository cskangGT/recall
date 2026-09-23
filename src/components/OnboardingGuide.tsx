import { useUiStore } from '../store/uiStore';
import { readStep, writeStep } from '../core/onboarding';
import { t } from '../i18n';

/**
 * The third beat of the first conversation, held on the map.
 *
 * The person's own stars are threaded on the sky and Mado has just tied
 * them into one thought. This strip says what to do with it — keep a line
 * — and offers the way on. It is drawn only during that beat, and the way
 * on returns to the greeting for the last one.
 */
export function OnboardingGuide() {
  const view = useUiStore((s) => s.view);
  const answer = useUiStore((s) => s.answer);
  const bundle = useUiStore((s) => s.bundle);
  if (view !== 'map' || readStep() !== 'think') return null;

  const onward = () => {
    writeStep('learn');
    useUiStore.getState().showGreeting();
  };

  return (
    <div className="obguide" data-testid="onboarding-guide">
      <span className="obguide__step">{t('welcome.step', { n: 3, total: 4 })}</span>
      <span className="obguide__text">
        {bundle
          ? t('welcome.guide.kept', { name: bundle.name })
          : answer
            ? t('welcome.guide.keep')
            : t('welcome.guide.wait')}
      </span>
      <button className="obguide__next" data-testid="onboarding-next" onClick={onward}>
        {bundle ? t('welcome.guide.onward') : t('welcome.guide.skip')}
      </button>
    </div>
  );
}
