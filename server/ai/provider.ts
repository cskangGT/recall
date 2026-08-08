import type { EntityKind, MemoryKind, SourceType } from '../../src/core/types.ts';

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

/**
 * What is being named.
 *
 * `new_category` is a category being born rather than one being rearranged, and
 * it was missing — so the one case a personal instance meets constantly, where
 * a capture arrives and nothing it could belong to exists yet, never reached the
 * model at all. It fell to `fallbackName`, which reads term statistics out of a
 * single sentence that has none.
 */
export type NameOperation = 'split' | 'merge' | 'promote' | 'new_category';

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

/**
 * One prior exchange, oldest first. Follow-ups carry the last few so "which of
 * those?" has a *those* — the model resolves the referent; retrieval gets the
 * same context separately (see AskPipeline). Each question is still answered
 * against the corpus alone: history disambiguates, it is never evidence.
 */
export interface AskTurn {
  question: string;
  answer: string;
}

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
    /** The viewer's language — names are UI, not content. */
    locale?: 'en' | 'ko';
  }): Promise<NamedCluster[]>;
  answer(input: {
    question: string;
    retrieved: RetrievedMemory[];
    /** Recent exchanges, oldest first — absent on a fresh question. */
    history?: AskTurn[];
  }): Promise<AnswerResult>;
}

// ---------------------------------------------------------------- naming validation

/*
 * Moved to src/core/naming.ts when the client's batch pipeline started naming
 * categories too — one rule, two ingest paths. Re-exported so everything
 * server-side keeps importing it from where the provider contract lives.
 */
export { validateName, fallbackName } from '../../src/core/naming.ts';
export type { NameValidation } from '../../src/core/naming.ts';
