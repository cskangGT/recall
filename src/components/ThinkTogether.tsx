import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useState } from 'react';
import { Bundle } from './Bundle';

/**
 * Thinking with picked memories — the mode, and the picks.
 *
 * Two pieces. The switch stands on the map, where it applies: on, a press
 * picks a star instead of travelling to it, and nothing else about the map
 * changes; off, the picks are put down. The strip stands in the bar, above
 * the input, and names what has been picked so far — each memory a chip
 * that can be taken out — with the two things to do with them: spread them
 * out on their own, and (later) bundle them. The input beneath is where
 * Mado is asked to think with them.
 */
export function ThinkSwitch() {
  const thinking = useUiStore((s) => s.thinking);
  const setThinking = useUiStore((s) => s.setThinking);
  return (
    <button
      className={`think${thinking ? ' think--on' : ''}`}
      data-testid="think-switch"
      aria-pressed={thinking}
      onClick={() => setThinking(!thinking)}
    >
      <span aria-hidden="true">✦</span> {thinking ? t('think.on') : t('think.off')}
    </button>
  );
}

export function ThinkPicks() {
  const thinking = useUiStore((s) => s.thinking);
  const picked = useUiStore((s) => s.picked);
  const setPicked = useUiStore((s) => s.setPicked);
  const selectedId = useUiStore((s) => s.selectedId);
  const focused = useUiStore((s) => s.mapFocus !== null);
  const payload = useWorkspaceStore((s) => s.payload);
  const [bundling, setBundling] = useState(false);
  if (!thinking || !payload) return null;

  // Every pick, named: a strip that hid the rest behind "and n more" was a
  // strip nothing could be taken out of. It wraps, and past a few rows scrolls.
  const memories = picked
    .map((id) => payload.memories.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  return (
    <div className="picks" data-testid="think-picks">
      <div className="picks__head">
        <span className="picks__count">
          {memories.length === 0 ? t('think.none') : t('think.count', { count: memories.length })}
        </span>
        {memories.length > 0 && (
          <span className="picks__actions">
            <button
              className="picks__action"
              data-testid="think-spread"
              disabled={focused}
              onClick={() => {
                const ui = useUiStore.getState();
                ui.setMapFocus({ ids: picked });
              }}
            >
              {t('think.spread')}
            </button>
            <button
              className={`picks__action${bundling ? ' picks__action--on' : ''}`}
              data-testid="think-bundle"
              aria-expanded={bundling}
              onClick={() => setBundling((v) => !v)}
            >
              {t('think.bundle')}
            </button>
            <button className="picks__action picks__action--quiet" data-testid="think-clear" onClick={() => setPicked([])}>
              {t('think.clear')}
            </button>
          </span>
        )}
      </div>
      {memories.length > 0 && (
        <div className="picks__chips">
          {memories.map((m) => (
            <span key={m.id} className={`pick${selectedId === m.id ? ' pick--on' : ''}`} data-testid={`pick-${m.id}`}>
              <span className="pick__star" aria-hidden="true">✦</span>
              <button
                className="pick__text"
                title={m.text}
                onClick={() => useUiStore.getState().select(m.id)}
              >
                {m.text}
              </button>
              <button
                className="pick__x"
                aria-label={t('think.remove')}
                onClick={() => setPicked(picked.filter((id) => id !== m.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {bundling && memories.length > 0 && <Bundle onClose={() => setBundling(false)} />}
    </div>
  );
}
