import { useMemo } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { t } from '../i18n';

/**
 * The recent sky — the browse view's original intent, made visible.
 *
 * The space was designed as somewhere to feel your way back to what you have
 * been thinking about lately and talk to it; but the only stars were
 * categories, so "recent" lived in the arc's ordering where nobody could see
 * it. Now the memories themselves hang in the upper sky: the newest burn
 * brightest, a thought that keeps returning (times_seen) grows, hovering
 * whispers the text, and clicking opens it below.
 *
 * Deterministic positions (hashed from the id) — the same sky every visit,
 * because spatial memory is the whole point of this product.
 */

const STAR_COUNT = 12;

function hashToUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function RecentStars() {
  const payload = useWorkspaceStore((s) => s.payload);
  const select = useUiStore((s) => s.select);
  const openCategoryId = useUiStore((s) => s.openCategoryId);
  const welcomeDismissed = useUiStore((s) => s.welcomeDismissed);

  const stars = useMemo(() => {
    if (!payload) return [];
    return [...payload.memories]
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) ||
          (b.times_seen ?? 1) - (a.times_seen ?? 1) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, STAR_COUNT)
      .map((m, rank) => ({
        memory: m,
        rank,
        /*
         * The upper strip of sky, clear of the arc below. Each star owns a
         * horizontal lane (rank-spaced) with a hashed jitter inside it —
         * scattered to the eye, but two stars can never overlap and steal
         * each other's hover.
         */
        left: 7 + rank * (86 / STAR_COUNT) + hashToUnit(m.id, 1) * (86 / STAR_COUNT) * 0.55,
        top: 4 + hashToUnit(m.id, 2) * 9,
        // Newest brightest; a returning thought grows.
        brightness: 1 - (rank / STAR_COUNT) * 0.65,
        size: 3.5 + Math.min(3, ((m.times_seen ?? 1) - 1) * 1.4) + (rank < 3 ? 1.2 : 0),
        tilt: Math.round(hashToUnit(m.id, 3) * 90),
        // Staggered twinkle, so the sky breathes instead of blinking in unison.
        delay: Math.round(hashToUnit(m.id, 4) * 5200),
      }));
  }, [payload]);

  // The recent sky belongs to the resting state — reading a list or an answer
  // has the eye elsewhere, and twinkles above it would be noise.
  if (!welcomeDismissed || openCategoryId !== null || stars.length === 0) return null;

  return (
    <div className="recentsky" data-testid="recent-stars" aria-label={t('recent.aria')}>
      {stars.map(({ memory, left, top, brightness, size, tilt, delay }) => (
        <button
          key={memory.id}
          className={`recentstar${left < 18 ? ' recentstar--left' : left > 82 ? ' recentstar--right' : ''}`}
          data-testid={`recent-star-${memory.id}`}
          style={
            {
              left: `${left}%`,
              top: `${top}%`,
              '--star-brightness': brightness,
              '--twinkle-delay': `${delay}ms`,
            } as React.CSSProperties
          }
          onClick={() => select(memory.id)}
        >
          {/* The same star the arc's categories wear — core, glow, spikes —
              scaled down to a memory's size. One sky, one kind of light. */}
          <span
            className="arc__star recentstar__glint"
            aria-hidden="true"
            style={
              {
                '--star-core': `${size}px`,
                '--star-glow': `${size * 4.4}px`,
                '--star-spikes': `${size * 3.4}px`,
                '--star-tilt': `${tilt}deg`,
              } as React.CSSProperties
            }
          />
          <span className="recentstar__whisper" role="tooltip">
            {memory.text}
            {(memory.times_seen ?? 1) > 1 && (
              <span className="recentstar__times"> · ×{memory.times_seen}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
