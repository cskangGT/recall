import type {
  AnswerCitation, AskTurn, ExtractResult, ExtractedMemory, NameCluster, NamedCluster,
  NormalizeInput, NormalizeResult, RetrievedMemory,
} from './provider.ts';
import { fallbackName, validateName } from './provider.ts';
import type { EntityKind, MemoryKind } from '../../src/core/types.ts';

/**
 * Everything about the model calls that does not need a network.
 *
 * Prompts, schemas, and the coercion of whatever comes back live here so they
 * can be tested without an API key — the same discipline that let the whole
 * backend be verified against `FixtureProvider`. `AnthropicProvider` is then
 * thin enough to be obviously correct: it makes a request and hands the result
 * to a function that is already covered.
 */

export const MODEL = 'claude-opus-5';

const MEMORY_KINDS: MemoryKind[] = ['fact', 'decision', 'opinion', 'question', 'task', 'reference'];
const ENTITY_KINDS: EntityKind[] = [
  'person', 'project', 'organization', 'tool', 'concept', 'decision', 'question',
];

/** Spec §10.2 caps a single source at ten memories. */
export const MAX_MEMORIES = 10;

// ------------------------------------------------------------------ normalize

export const normalizeSchema = {
  type: 'object',
  properties: {
    ocr_text: { type: 'string' },
    scene_description: { type: 'string' },
    detected_context: {
      type: 'string',
      enum: ['instagram_post', 'slack', 'article', 'dashboard', 'chart', 'document', 'photo', 'other'],
    },
    has_meaningful_text: { type: 'boolean' },
  },
  required: ['ocr_text', 'scene_description', 'detected_context', 'has_meaningful_text'],
  additionalProperties: false,
} as const;

export function buildNormalizePrompt(input: NormalizeInput): string {
  return [
    'Describe this capture so it can be filed in a personal memory system.',
    '',
    'ocr_text: every legible word, verbatim. Empty string if there is none.',
    'scene_description: one sentence naming what this *is*, in the second person',
    '  ("A screenshot of a thread about…"). Not a description of pixels.',
    'has_meaningful_text: false for a photo with no readable content worth keeping.',
    input.text ? `\nAccompanying text:\n${input.text}` : '',
  ].join('\n');
}

export function coerceNormalize(raw: unknown): NormalizeResult {
  const o = (raw ?? {}) as Partial<NormalizeResult>;
  const ocr = typeof o.ocr_text === 'string' ? o.ocr_text : '';
  const scene = typeof o.scene_description === 'string' ? o.scene_description : '';
  return {
    ocr_text: ocr,
    scene_description: scene,
    detected_context: normalizeSchema.properties.detected_context.enum.includes(
      o.detected_context as never,
    )
      ? (o.detected_context as NormalizeResult['detected_context'])
      : 'other',
    // Trust the model's own judgement, but never call something meaningful when
    // it produced nothing to be meaningful about.
    has_meaningful_text: o.has_meaningful_text === true && (ocr.length > 0 || scene.length > 0),
  };
}

// -------------------------------------------------------------------- extract

export const extractSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    suggested_title: { type: 'string' },
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: MEMORY_KINDS },
          confidence: { type: 'number' },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                kind: { type: 'string', enum: ENTITY_KINDS },
              },
              required: ['name', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['text', 'kind', 'confidence', 'entities'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'suggested_title', 'memories'],
  additionalProperties: false,
} as const;

export function buildExtractPrompt(input: {
  content: string;
  sceneDescription?: string;
  type: string;
}): string {
  return [
    'Pull out the things worth remembering from this, as atomic memories.',
    '',
    'A memory is one self-contained claim, readable a year from now with no other',
    'context. Write it as a full sentence in the past or present tense. Do not',
    'summarise the source; state what it says.',
    '',
    'Write every memory, the summary, and the title in the language the source',
    'is written in — a Korean caption yields Korean memories, never a translation.',
    '',
    `At most ${MAX_MEMORIES}. Returning none is a valid answer — plenty of things`,
    'are not worth remembering, and an empty list is better than padding.',
    '',
    'suggested_title: five words or fewer, naming the source, not the contents.',
    '',
    input.sceneDescription ? `What this capture is: ${input.sceneDescription}` : '',
    `Source type: ${input.type}`,
    '',
    'Content:',
    input.content,
  ]
    .filter(Boolean)
    .join('\n');
}

export function coerceExtract(raw: unknown): ExtractResult {
  const o = (raw ?? {}) as Partial<ExtractResult>;
  const memories: ExtractedMemory[] = (Array.isArray(o.memories) ? o.memories : [])
    .filter((m): m is ExtractedMemory => typeof m?.text === 'string' && m.text.trim().length > 0)
    .slice(0, MAX_MEMORIES)
    .map((m) => ({
      text: m.text.trim(),
      kind: MEMORY_KINDS.includes(m.kind) ? m.kind : 'fact',
      // A model that omits confidence is not thereby certain.
      confidence: typeof m.confidence === 'number' && m.confidence >= 0 && m.confidence <= 1
        ? m.confidence
        : 0.5,
      entities: (Array.isArray(m.entities) ? m.entities : [])
        .filter((e) => typeof e?.name === 'string' && e.name.trim().length > 0)
        .map((e) => ({
          name: e.name.trim(),
          kind: ENTITY_KINDS.includes(e.kind) ? e.kind : 'concept',
        })),
    }));

  return {
    memories,
    summary: typeof o.summary === 'string' ? o.summary : '',
    suggested_title:
      typeof o.suggested_title === 'string' && o.suggested_title.trim().length > 0
        ? o.suggested_title.trim()
        : 'Untitled capture',
  };
}

// ----------------------------------------------------------------------- name

export const nameSchema = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cluster_id: { type: 'string' },
          name: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['cluster_id', 'name', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['clusters'],
  additionalProperties: false,
} as const;

export function buildNamePrompt(input: {
  operation: string;
  clusters: NameCluster[];
  forbiddenNames: string[];
  retryReasons?: Record<string, string>;
  /** The viewer's language — a category name is UI, not content. */
  locale?: 'en' | 'ko';
}): string {
  /*
   * Phrased per operation rather than interpolated raw. "Name the result of this
   * new_category" is a sentence about the codebase; the others are sentences
   * about what happened, and the model answers the second kind better.
   */
  const opening =
    input.operation === 'new_category'
      ? [
          'Name the category these belong in. They arrived together and nothing',
          'already saved is close enough to hold them, so this is a new one.',
        ]
      : [
          `Name the result of this ${input.operation}. The change has already been decided;`,
          'you are naming it, not judging it.',
        ];

  const lines = [
    ...opening,
    '',
    'One to three words. A name a person would recognise as their own category.',
    'Never a container word — "Miscellaneous", "Other", "General", "Various" are',
    'refusals to decide, not names.',
    '',
    // The names sit in the chrome next to translated labels — mixed-language
    // shelves read as a bug even when every individual name is good.
    input.locale === 'ko' ? 'Write the names in Korean (한국어로).' : '',
    '',
    /*
     * The headings below are identifiers, and the model has to be told so.
     *
     * Without this line gpt-4.1 reads "## new_0" as a placeholder heading and
     * answers with a cluster_id of its own invention — "pricing_decisions" for
     * a name of "Pricing Decisions". `resolveNames` matches on cluster_id, so a
     * perfectly good name arrives as "no name returned", is retried once, and
     * lands on TF-IDF. That is how a note about a pricing argument came out
     * called "Discussed Lowering" *with the namer working*.
     */
    'Return one entry per section below. Its `cluster_id` must be the section',
    'heading copied exactly — it is an identifier, not a title to improve.',
    '',
    input.forbiddenNames.length > 0
      ? `Already taken, do not reuse: ${input.forbiddenNames.join(', ')}`
      : '',
    '',
  ];

  for (const cluster of input.clusters) {
    lines.push(`## ${cluster.cluster_id}`);
    const reason = input.retryReasons?.[cluster.cluster_id];
    if (reason) lines.push(`Your previous name was rejected: ${reason}. Try again.`);
    for (const text of cluster.sample_texts) lines.push(`- ${text}`);
    lines.push('');
  }

  return lines.filter((l) => l !== undefined).join('\n');
}

export interface NameResolution {
  accepted: NamedCluster[];
  /** cluster_id -> why it was rejected, for the retry prompt. */
  rejected: Record<string, string>;
}

/**
 * Splits model output into names that pass spec §10.4's rules and ones that do
 * not. The caller retries the rejects once, then falls back to TF-IDF — a bad
 * name is recoverable by the user, an abandoned reorganization is not.
 */
export function resolveNames(
  raw: unknown,
  clusters: NameCluster[],
  forbiddenNames: string[],
): NameResolution {
  const returned = new Map<string, { name: string; rationale: string }>();
  const list = (raw as { clusters?: unknown[] } | null)?.clusters;
  for (const entry of Array.isArray(list) ? list : []) {
    const e = entry as Partial<NamedCluster>;
    if (typeof e?.cluster_id === 'string' && typeof e.name === 'string') {
      returned.set(e.cluster_id, {
        name: e.name,
        rationale: typeof e.rationale === 'string' ? e.rationale : '',
      });
    }
  }

  const accepted: NamedCluster[] = [];
  const rejected: Record<string, string> = {};
  // Grows as names are accepted: two clusters from one split must not both be
  // called the same thing.
  const taken = [...forbiddenNames];

  for (const cluster of clusters) {
    const candidate = returned.get(cluster.cluster_id);
    if (!candidate) {
      rejected[cluster.cluster_id] = 'no name returned';
      continue;
    }
    const check = validateName(candidate.name, taken);
    if (!check.ok) {
      rejected[cluster.cluster_id] = check.reason ?? 'invalid';
      continue;
    }
    accepted.push({
      cluster_id: cluster.cluster_id,
      name: candidate.name.trim(),
      rationale: candidate.rationale,
    });
    taken.push(candidate.name.trim());
  }

  return { accepted, rejected };
}

/** Deterministic last resort, once the model has had its two attempts. */
export function nameByFallback(cluster: NameCluster, allClusters: NameCluster[]): NamedCluster {
  return {
    cluster_id: cluster.cluster_id,
    name: fallbackName(
      cluster.sample_texts,
      allClusters.map((c) => c.sample_texts),
    ),
    rationale: 'Named from the cluster\'s most distinctive terms — the model\'s names were rejected.',
  };
}

// --------------------------------------------------------------------- answer

export const answerSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
    refused: { type: 'boolean' },
  },
  required: ['answer', 'citations', 'refused'],
  additionalProperties: false,
} as const;

export function buildAnswerPrompt(input: {
  question: string;
  retrieved: RetrievedMemory[];
  history?: AskTurn[];
}): string {
  const numbered = input.retrieved
    .map(
      (m, i) =>
        `[${i + 1}] ${m.text}\n    (${m.category_name} · ${m.source_type} · ${m.source_title})`,
    )
    .join('\n');

  /*
   * The conversation resolves referents, nothing more. It sits above the
   * memories and below the rules so the model reads it as context for the
   * question — "which of those?" needs a *those* — while the citation contract
   * stays anchored to the numbered memories alone. A prior answer is never
   * evidence: it was built from citations that are not in this prompt, and
   * citing it would be citing a citation.
   */
  const conversation =
    input.history && input.history.length > 0
      ? [
          'Earlier in this conversation (context for pronouns and follow-ups only —',
          'never a source to cite or repeat from):',
          ...input.history.map((t) => `Q: ${t.question}\nA: ${t.answer}`),
          '',
        ]
      : [];

  return [
    'Answer using only the numbered memories below. They are the entire world.',
    '',
    'Every sentence must carry at least one [n] citation. Cite by number.',
    'Two or three sentences. Say what the person decided or believes, in their',
    'own terms — you are reminding them, not briefing a stranger.',
    '',
    'If the memories do not actually answer the question, set refused to true and',
    'leave citations empty. Refusing is correct and costs nothing; a confident',
    'answer built out of near-misses costs their trust in everything else here.',
    '',
    ...conversation,
    `Question: ${input.question}`,
    '',
    'Memories:',
    numbered,
  ].join('\n');
}

/**
 * Maps the model's [n] citations back to memory ids.
 *
 * The model is asked for numbers rather than ids on purpose: opaque ids invite
 * transcription errors, and a mistyped id is indistinguishable from a fabricated
 * one. Out-of-range numbers are dropped here; the pipeline separately refuses
 * anything that still does not resolve.
 */
export function resolveAnswer(raw: unknown, retrieved: RetrievedMemory[]): {
  answer: string;
  citations: AnswerCitation[];
  refused: boolean;
} {
  const o = (raw ?? {}) as { answer?: unknown; citations?: unknown; refused?: unknown };
  if (o.refused === true) return { answer: '', citations: [], refused: true };

  const seen = new Set<number>();
  const citations: AnswerCitation[] = [];
  for (const n of Array.isArray(o.citations) ? o.citations : []) {
    if (typeof n !== 'number' || !Number.isInteger(n)) continue;
    const memory = retrieved[n - 1];
    if (!memory || seen.has(n)) continue;
    seen.add(n);
    citations.push({ n, memory_id: memory.memory_id, source_id: memory.source_id });
  }

  const answer = typeof o.answer === 'string' ? o.answer.trim() : '';
  // An answer with nothing behind it is a refusal that forgot to say so.
  if (answer.length === 0 || citations.length === 0) {
    return { answer: '', citations: [], refused: true };
  }
  return { answer, citations, refused: false };
}
