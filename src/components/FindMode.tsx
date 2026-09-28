import { t } from '../i18n';
import { useUiStore, type Lens } from '../store/uiStore';

/**
 * Search, or ask Mado — said out loud.
 *
 * The bar used to guess: a word was looked for, a line ending in "?" was
 * asked. A rule the person has to remember is a rule they will get wrong, and
 * the two verbs are not alike — searching shows what you kept, asking has the
 * memory answer in its own voice. So the bar carries a switch, and the switch
 * is the whole rule. Each lens remembers its own side: browsing is a
 * conversation and starts on asking; the map and the archive start on search.
 */
export function FindMode({ lens }: { lens: Lens }) {
  const mode = useUiStore((s) => s.findMode[lens]);
  const setFindMode = useUiStore((s) => s.setFindMode);
  return (
    <div className="findmode" role="radiogroup" aria-label={t('find.mode.aria')} data-testid="find-mode">
      {(['search', 'ask'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={`findmode__opt${mode === m ? ' findmode__opt--on' : ''}`}
          data-testid={`find-mode-${m}`}
          onClick={() => setFindMode(lens, m)}
        >
          {t(m === 'search' ? 'find.mode.find' : 'find.mode.ask')}
        </button>
      ))}
    </div>
  );
}
