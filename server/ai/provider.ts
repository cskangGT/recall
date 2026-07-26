import type { EntityKind, MemoryKind, SourceType } from '../../src/core/types';

/**
 * The four model calls of spec §10, plus embeddings, behind one interface.
 *
 * Everything the pipeline does is expressed against these types, so the whole
 * backend runs headless with `FixtureProvider` and no credentials. That is the
 * same discipline that made Phase 1 verifiable: if the only way to exercise the
 * pipeline is to hold a paid API key, it does not get exercised.
 */

// ---------------------------------------------------------------- call 1: normalize

export interface NormalizeInput {
  type: SourceType;
  /** Raw pasted text, fetched article body, or an image reference. */
  text?: string;
  imagePath?: string;
}

export interface NormalizeResult {
  ocr_text: string;
  scene_description: string;
  detected_context:
    | 'instagram_post' | 'slack' | 'article' | 'dashboard'
    | 'chart' | 'document' | 'photo' | 'other';
  has_meaningful_text: boolean;
}

// ---------------------------------------------------------------- call 2: extract

export interface ExtractedEntity {
  name: string;
  kind: EntityKind;
}

export interface ExtractedMemory {
  text: string;
  kind: MemoryKind;
  confidence: number;
  entities: ExtractedEntity[];
}

export interface ExtractResult {
  /**
   * 1–10 items, or empty. An empty array is a valid, expected outcome — the
   * source is still persisted and surfaced in Sources (spec §7.4).
   */
  memories: ExtractedMemory[];
  summary: string;
  suggested_title: string;
}

// ---------------------------------------------------------------- call 4: name

export type NameOperation = 'split' | 'merge' | 'promote';

export interface NameCluster {
  cluster_id: string;
  /** Up to 12 sampled member memory texts — the only context the namer gets. */
  sample_texts: string[];
}

export interface NamedCluster {
  cluster_id: string;
  name: string;
  rationale: string;
}

// ---------------------------------------------------------------- ask

export interface AnswerCitation {
  n: number;
  memory_id: string;
  source_id: string;
}

export interface AnswerResult {
  answer: string;
  citations: AnswerCitation[];
  refused: boolean;
}

export interface RetrievedMemory {
  memory_id: string;
  source_id: string;
  text: string;
  category_name: string;
  source_title: string;
  source_type: SourceType;
}

// ---------------------------------------------------------------- the interfaces

export interface EmbeddingProvider {
  /** Dimensionality is the provider's choice — see spec §18. */
  readonly dimensions: number;
  embed(texts: string[], purpose: 'document' | 'query'): Promise<number[][]>;
}

export interface AiProvider {
  readonly name: string;
  /** Screenshots only; text and link sources skip it (spec §10.1). */
  normalize(input: NormalizeInput): Promise<NormalizeResult>;
  extract(input: { content: string; sceneDescription?: string; type: SourceType }): Promise<ExtractResult>;
  /**
   * Names the result of a structural change. Receives the operation and the
   * clusters, and has **no** say in whether the change happens (spec §10.4).
   */
  nameClusters(input: {
    operation: NameOperation;
    clusters: NameCluster[];
    /** Sibling names the result must not collide with. */
    forbiddenNames: string[];
  }): Promise<NamedCluster[]>;
  answer(input: { question: string; retrieved: RetrievedMemory[] }): Promise<AnswerResult>;
}

// ---------------------------------------------------------------- naming validation

/** Rejected outright by spec §10.4 — a container name is a failure to decide. */
const GENERIC = new Set(['miscellaneous', 'other', 'general', 'various', 'stuff', 'misc']);

export interface NameValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Applied to model output before it is written. A badly named category is
 * recoverable by the user; a failed reorganization is not — so callers fall
 * back to a TF-IDF name rather than abandoning the operation (spec §10.4).
 */
export function validateName(name: string, forbidden: string[]): NameValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return { ok: false, reason: `${words.length} words, max 3` };
  if (GENERIC.has(trimmed.toLowerCase())) return { ok: false, reason: 'generic container name' };
  if (forbidden.some((f) => f.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, reason: 'duplicates an existing or tombstoned name' };
  }
  return { ok: true };
}

/**
 * Deterministic fallback when naming fails validation twice: the two highest
 * TF-IDF terms in the cluster, title-cased.
 */
export function fallbackName(sampleTexts: string[], allTexts: string[][]): string {
  const STOP = new Set(
    ('the a an and or but of to in for on with at by from as is are was were be been it its this that ' +
      'these those not no you your we our they their he she i me my more most than then so if when ' +
      'what which who how why can could should would will just also very much every all any'
    ).split(' '),
  );
  const tokens = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

  const tf = new Map<string, number>();
  for (const t of sampleTexts) for (const w of tokens(t)) tf.set(w, (tf.get(w) ?? 0) + 1);

  const df = new Map<string, number>();
  for (const doc of allTexts) {
    for (const w of new Set(doc.flatMap(tokens))) df.set(w, (df.get(w) ?? 0) + 1);
  }

  const n = Math.max(1, allTexts.length);
  const scored = [...tf.entries()]
    .map(([w, freq]) => ({ w, score: freq * Math.log(n / (1 + (df.get(w) ?? 0))) }))
    .sort((a, b) => (b.score - a.score) || a.w.localeCompare(b.w));

  const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const picked = scored.slice(0, 2).map((s) => title(s.w));
  return picked.length > 0 ? picked.join(' ') : 'Unsorted';
}
