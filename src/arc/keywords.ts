import type { GraphPayload, Memory } from '../core/types';
import { nameTokens } from '../core/naming';

/**
 * The keyword lens.
 *
 * A category's reading list is sentences, and sentences have to be read;
 * keywords can be scanned. This derives a strip of keyword chips from the
 * memories currently on screen — entities the pipeline already extracted,
 * plus the frequent terms of the texts themselves — and each selection
 * narrows the list and re-derives the chips from what is left. Structure is
 * not required: a flat category splits just as well as a nested one, which is
 * what makes the lens the drill-down and the subcategories merely one input
 * to it.
 *
 * Pure functions over the payload; the component owns the selection state.
 */

export interface Keyword {
  label: string;
  /** Memories in the current set this keyword would keep. */
  count: number;
  /** Entities outrank bare terms at equal count — they are curated names. */
  kind: 'entity' | 'term';
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Whether a memory matches a keyword label.
 *
 * Substring on the lowercased text, not token equality: Korean terms arrive
 * particle-stripped ("러닝"), and the stem is a prefix of every inflected form
 * ("러닝을", "러닝이"), so containment is exactly the match wanted. Multi-word
 * entity names ("Apple Notes") fall out of the same rule. Entity links count
 * as a match even when the surface text used an alias.
 */
export function memoryMatches(memory: Memory, label: string, payload: GraphPayload): boolean {
  const l = norm(label);
  if (memory.text.toLowerCase().includes(l)) return true;
  return payload.entities.some(
    (e) => norm(e.name) === l && memory.entity_ids.includes(e.id),
  );
}

/** The current set, narrowed by every selected keyword (AND). */
export function filterByKeywords(
  memories: Memory[],
  selected: string[],
  payload: GraphPayload,
): Memory[] {
  if (selected.length === 0) return memories;
  return memories.filter((m) => selected.every((k) => memoryMatches(m, k, payload)));
}

/**
 * The chips for the current set, best first.
 *
 * A chip must discriminate: one that matches everything narrows nothing and
 * one that matches a single memory is a title, not a group — both are dropped
 * (the singleton rule relaxes for tiny sets, where pairs are all there is).
 * Already-selected labels are excluded, so each selection re-splits what
 * remains instead of echoing the path taken.
 */
export function keywordsFor(
  memories: Memory[],
  selected: string[],
  payload: GraphPayload,
  limit = 10,
): Keyword[] {
  if (memories.length < 2) return [];
  const chosen = new Set(selected.map(norm));
  const total = memories.length;
  const minCount = total <= 3 ? 1 : 2;

  const candidates = new Map<string, Keyword>();

  // Entities first — they win ties against a bare term of the same count.
  for (const e of payload.entities) {
    const label = e.name.trim();
    if (!label || chosen.has(norm(label))) continue;
    const count = memories.filter((m) => memoryMatches(m, label, payload)).length;
    if (count < minCount || count === total) continue;
    candidates.set(norm(label), { label, count, kind: 'entity' });
  }

  // Then the texts' own terms. Tokenizing proposes the candidates, but each
  // one is counted with `memoryMatches` — the same substring rule the filter
  // uses — so a chip's number is exactly what clicking it will leave. Counted
  // any other way, "러닝" would promise three and deliver four, because the
  // token "러닝화" contains it.
  const terms = new Set<string>();
  for (const m of memories) {
    for (const w of nameTokens(m.text)) {
      if (/^[0-9]/.test(w)) continue; // digit-led tokens make bad handles
      terms.add(w);
    }
  }
  for (const label of terms) {
    if (chosen.has(label) || candidates.has(label)) continue;
    const count = memories.filter((m) => memoryMatches(m, label, payload)).length;
    if (count < Math.max(2, minCount) || count === total) continue;
    candidates.set(label, { label, count, kind: 'term' });
  }

  return [...candidates.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.kind === b.kind ? 0 : a.kind === 'entity' ? -1 : 1) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, limit);
}
