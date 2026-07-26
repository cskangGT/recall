import { createHash } from 'node:crypto';
import type {
  AiProvider, AnswerResult, EmbeddingProvider, ExtractResult,
  NameCluster, NamedCluster, NormalizeInput, NormalizeResult, RetrievedMemory,
} from './provider';
import { fallbackName, validateName } from './provider';
import type { Memory, Source } from '../../src/core/types';
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

export class FixtureEmbeddings implements EmbeddingProvider {
  readonly dimensions = VECTOR_DIM;
  private readonly byText = new Map<string, number[]>();

  constructor() {
    // Seed texts get their authored vectors, so the tuned demo condition holds.
    for (const m of [...seedMemories, ...demoMemories]) this.byText.set(m.text, m.vector);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.byText.get(t) ?? hashVector(t, this.dimensions));
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

  /** The names the demo expects, with the same validation a real namer faces. */
  async nameClusters(input: {
    clusters: NameCluster[];
    forbiddenNames: string[];
  }): Promise<NamedCluster[]> {
    const canned = ['Agent Frameworks', 'Evals & Observability'];
    return input.clusters.map((c, i) => {
      const proposed = canned[i] ?? fallbackName(c.sample_texts, input.clusters.map((x) => x.sample_texts));
      const check = validateName(proposed, input.forbiddenNames);
      return {
        cluster_id: c.cluster_id,
        name: check.ok
          ? proposed
          : fallbackName(c.sample_texts, input.clusters.map((x) => x.sample_texts)),
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
    // Only cite memories retrieval actually surfaced — the same contract the
    // real provider is held to, so a retrieval regression shows up here too.
    const available = new Set(input.retrieved.map((r) => r.memory_id));
    const citations = entry.citations.filter((c) => available.has(c.memory_id));
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
