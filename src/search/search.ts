import type { GraphPayload, Memory, SourceType } from '../core/types';

/**
 * Instant search — spec §5.6 and the keyword half of §9.1.
 *
 * Built because the command bar already claimed it: typing something that is
 * not a question flips the chip to "Search", and pressing Enter ran Ask
 * anyway. The chip was lying.
 *
 * Keyword only, deliberately. Spec §9.1 fuses keywords with vector similarity,
 * but the vector half needs the *query* embedded, and in seed mode there is no
 * embedder — a hash vector would rank by noise. At 47 memories a term match
 * over memory text and source titles is genuinely the whole signal, and it is
 * the half a user typing "langchain" actually wants. When a query embedding
 * exists, fuse this ranking with cosine using `server/search/retrieve.ts`.
 */

export const MAX_RESULTS = 8;

export interface SearchSegment {
  text: string;
  matched: boolean;
}

export interface SearchResult {
  memory: Memory;
  categoryId: string;
  categoryName: string;
  sourceTitle: string;
  sourceType: SourceType;
  score: number;
  /** The memory text split so the UI can bold what matched. */
  segments: SearchSegment[];
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'at',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this',
  'that', 'about',
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits text into matched and unmatched runs so the UI can bold the hits.
 * Word-prefix anchored: searching "eval" should light up "evals" and
 * "evaluation" but not the "eval" inside an unrelated word.
 */
export function highlight(text: string, terms: string[]): SearchSegment[] {
  if (terms.length === 0) return [{ text, matched: false }];

  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escapeRegExp).join('|')})`, 'giu');
  const segments: SearchSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    // Extend to the end of the word so "evals" highlights whole, not "eval"+"s".
    let end = start + match[0].length;
    while (end < text.length && /[\p{L}\p{N}]/u.test(text[end]!)) end++;

    if (start > cursor) segments.push({ text: text.slice(cursor, start), matched: false });
    segments.push({ text: text.slice(start, end), matched: true });
    cursor = end;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  return segments;
}

/**
 * Ranks memories against a query.
 *
 * Scoring, highest first: an exact phrase in the memory text, then how many
 * query terms it contains, then a term in the source title. A memory that
 * matches every term outranks one that matches more terms *more often* —
 * coverage beats frequency at this corpus size, where a repeated word is noise
 * rather than signal.
 */
export function search(payload: GraphPayload, query: string): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const phrase = query.trim().toLowerCase();
  const categoryName = new Map(payload.categories.map((c) => [c.id, c.name]));
  const sourceById = new Map(payload.sources.map((s) => [s.id, s]));
  const entityName = new Map(payload.entities.map((e) => [e.id, e.name.toLowerCase()]));

  const scored: SearchResult[] = [];
  for (const memory of payload.memories) {
    const haystack = memory.text.toLowerCase();
    const source = sourceById.get(memory.source_id);
    const titleHaystack = (source?.title ?? '').toLowerCase();
    /*
     * The map draws three kinds of words — memory text, category names, entity
     * labels — and search used to read only the first. Staring at the label
     * "기억 문장" and typing 기억 returned nothing, which reads as the search
     * being broken rather than the index being narrow. What the map shows,
     * search finds: a memory now also matches through the name of the category
     * it sits in and the entities it mentions, below a hit in its own words.
     */
    const catHaystack = (categoryName.get(memory.category_id) ?? '').toLowerCase();
    const entityHaystack = memory.entity_ids
      .map((eid) => entityName.get(eid) ?? '')
      .join(' ');

    const hits = terms.filter((t) => haystack.includes(t));
    const titleHits = terms.filter((t) => titleHaystack.includes(t));
    const labelHits = terms.filter(
      (t) => catHaystack.includes(t) || entityHaystack.includes(t),
    );
    if (hits.length === 0 && titleHits.length === 0 && labelHits.length === 0) continue;

    let score = hits.length * 10 + labelHits.length * 5 + titleHits.length * 3;
    if (phrase.length > 2 && haystack.includes(phrase)) score += 50;
    if (hits.length === terms.length) score += 20;

    scored.push({
      memory,
      categoryId: memory.category_id,
      categoryName: categoryName.get(memory.category_id) ?? 'Uncategorised',
      sourceTitle: source?.title ?? 'Unknown source',
      sourceType: source?.type ?? 'text',
      score,
      segments: highlight(memory.text, terms),
    });
  }

  return scored
    .sort((a, b) => (b.score - a.score) || a.memory.id.localeCompare(b.memory.id))
    .slice(0, MAX_RESULTS);
}

/**
 * The label nodes — categories and entities — whose names contain every term.
 *
 * The map's search highlights these alongside the matching memories, so the
 * word the user is literally looking at lights up instead of staying dim while
 * its members glow. AND across terms: "기억 문장" names one label, not every
 * label containing either word.
 */
export function matchedLabelNodes(payload: GraphPayload, query: string): string[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const matches = (name: string): boolean => {
    const lowered = name.toLowerCase();
    return terms.every((t) => lowered.includes(t));
  };
  return [
    ...payload.categories.filter((c) => matches(c.name)).map((c) => c.id),
    ...payload.entities.filter((e) => matches(e.name)).map((e) => e.id),
  ];
}

/** Grouped by category for display, preserving rank order within and across groups. */
export function groupByCategory(
  results: SearchResult[],
): { categoryId: string; categoryName: string; results: SearchResult[] }[] {
  const groups: { categoryId: string; categoryName: string; results: SearchResult[] }[] = [];
  for (const result of results) {
    const existing = groups.find((g) => g.categoryId === result.categoryId);
    if (existing) existing.results.push(result);
    else groups.push({
      categoryId: result.categoryId,
      categoryName: result.categoryName,
      results: [result],
    });
  }
  return groups;
}
