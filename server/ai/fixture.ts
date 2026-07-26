import { createHash } from 'node:crypto';
import type {
  AiProvider, AnswerResult, EmbeddingProvider, ExtractResult,
  NameCluster, NamedCluster, NormalizeInput, NormalizeResult, RetrievedMemory,
} from './provider.ts';
import { fallbackName, validateName } from './provider.ts';
import type { Memory, Source } from '../../src/core/types.ts';
import workspaceJson from '../../seed/workspace.json' with { type: 'json' };
import demoItem from '../../seed/demo-item.json' with { type: 'json' };
import answers from '../../seed/answers.json' with { type: 'json' };

/**
 * Zero-credential provider: every call is answered from seed/ or from a
 * deterministic hash. The whole backend pipeline runs and is tested against
 * this, which is what lets Phase 3 be verified before anyone buys an API key.
 *
 * It is not a mock in the test-double sense — it is a real implementation of
 * the interface whose knowledge happens to be finite. The pipeline cannot tell
 * the difference, which is the point: swapping in AnthropicProvider must not
 * change any control flow.
 */

const seedMemories = workspaceJson.memories as unknown as Memory[];
const demoMemories = demoItem.memories as unknown as Memory[];
const seedSources = workspaceJson.sources as unknown as Source[];

const VECTOR_DIM = seedMemories[0]!.vector.length;

/** Stable pseudo-embedding for text the seed has never seen. */
function hashVector(text: string, dim: number): number[] {
  const out: number[] = [];
  let counter = 0;
  while (out.length < dim) {
    const digest = createHash('sha256').update(`${text}#${counter++}`).digest();
    for (const byte of digest) {
      if (out.length >= dim) break;
      out.push(byte / 255 - 0.5);
    }
  }
  const norm = Math.hypot(...out);
  return out.map((x) => x / norm);
}

const textById = new Map([...seedMemories, ...demoMemories].map((m) => [m.id, m.text]));

/** Componentwise mean, normalized — the direction a set of memories points in. */
function meanDirection(vectors: number[][]): number[] {
  const dim = vectors[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i]! += v[i]! / vectors.length;
  const norm = Math.hypot(...out) || 1;
  return out.map((x) => x / norm);
}

export class FixtureEmbeddings implements EmbeddingProvider {
  readonly dimensions = VECTOR_DIM;
  private readonly byText = new Map<string, number[]>();

  constructor() {
    // Seed texts get their authored vectors, so the tuned demo condition holds.
    for (const m of [...seedMemories, ...demoMemories]) this.byText.set(m.text, m.vector);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.byText.get(t) ?? this.derive(t));
  }

  /**
   * A question is never a seed text, so it would otherwise get a hash vector —
   * a direction unrelated to the corpus, which puts every memory under the
   * relevance floor and makes Ask refuse everything. That would test nothing.
   *
   * Instead, a question that matches a scripted answer embeds to the mean
   * direction of the memories that answer it, which is what a real embedding
   * model does: it puts a question near its answers. Anything else still falls
   * back to a hash, so an unanswerable question is still genuinely far away and
   * the refusal path stays real.
   */
  private derive(text: string): number[] {
    const q = text.toLowerCase();
    const entry = answers.find((a) => a.match.every((kw) => q.includes(kw)));
    if (!entry) return hashVector(text, this.dimensions);

    const vectors = entry.citations
      .map((c) => textById.get(c.memory_id))
      .map((t) => (t === undefined ? undefined : this.byText.get(t)))
      .filter((v): v is number[] => v !== undefined);

    return vectors.length > 0 ? meanDirection(vectors) : hashVector(text, this.dimensions);
  }
}

export class FixtureProvider implements AiProvider {
  readonly name = 'fixture';

  async normalize(input: NormalizeInput): Promise<NormalizeResult> {
    const source = seedSources.find((s) => s.image_path === input.imagePath);
    const demoSource = demoItem.source as unknown as Source;
    const match = source ?? (input.imagePath === demoSource.image_path ? demoSource : null);
    return {
      ocr_text: match?.raw_content ?? input.text ?? '',
      scene_description: match?.scene_description ?? 'A screenshot of unrecognised content.',
      detected_context: match ? 'article' : 'other',
      has_meaningful_text: Boolean(match?.raw_content ?? input.text),
    };
  }

  /**
   * Any capture yields the demo item's memories — the same behaviour the Phase 1
   * frontend has, and the reason the runbook warns against taking audience input
   * on the capture step. A real provider reads the actual content.
   */
  async extract(): Promise<ExtractResult> {
    return {
      memories: demoMemories.map((m) => ({
        text: m.text,
        kind: m.kind,
        confidence: m.confidence,
        entities: [],
      })),
      summary: (demoItem.source as unknown as Source).raw_content.slice(0, 120),
      suggested_title: (demoItem.source as unknown as Source).title,
    };
  }

  /**
   * The names the demo expects for a split; TF-IDF for anything else. Both go
   * through the same validation a real namer faces, so a fixture run exercises
   * the fallback path rather than sidestepping it.
   */
  async nameClusters(input: {
    operation?: 'split' | 'merge' | 'promote';
    clusters: NameCluster[];
    forbiddenNames: string[];
  }): Promise<NamedCluster[]> {
    const allTexts = input.clusters.map((x) => x.sample_texts);
    const canned = input.operation === 'merge' ? [] : ['Agent Frameworks', 'Evals & Observability'];
    return input.clusters.map((c, i) => {
      const proposed = canned[i] ?? fallbackName(c.sample_texts, allTexts);
      const check = validateName(proposed, input.forbiddenNames);
      return {
        cluster_id: c.cluster_id,
        name: check.ok ? proposed : fallbackName(c.sample_texts, allTexts),
        rationale: check.ok ? 'fixture' : `fell back: ${check.reason}`,
      };
    });
  }

  async answer(input: { question: string; retrieved: RetrievedMemory[] }): Promise<AnswerResult> {
    const q = input.question.toLowerCase();
    const entry = answers.find((a) => a.match.every((kw) => q.includes(kw)));
    if (!entry) {
      return {
        answer: "I don't have anything saved about that yet.",
        citations: [],
        refused: true,
      };
    }
    // Citations are resolved by *text*, not by id. The scripted answers name
    // seed ids, but the ingest pipeline mints fresh ids for anything it
    // captures — so `mem_demo_1` never exists once the demo item has actually
    // been ingested. Matching on text keeps the fixture faithful to the demo
    // narrative, where the third citation is the screenshot captured thirty
    // seconds earlier.
    const idByText = new Map(input.retrieved.map((r) => [r.text, r]));
    const citations = entry.citations
      .map((c) => {
        const text = textById.get(c.memory_id);
        const surfaced = text === undefined ? undefined : idByText.get(text);
        return surfaced ? { ...c, memory_id: surfaced.memory_id, source_id: surfaced.source_id } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    if (citations.length < 2) {
      return {
        answer: "I don't have anything saved about that yet.",
        citations: [],
        refused: true,
      };
    }
    return { answer: entry.answer, citations, refused: false };
  }
}
