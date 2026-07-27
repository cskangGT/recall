import type { EmbeddingProvider } from './provider.ts';

/**
 * Voyage embeddings.
 *
 * Anthropic has no embedding endpoint and its docs point here, so this is the
 * one place the stack talks to somebody else. Raw HTTP rather than a client
 * library: it is one POST, and a dependency whose only job is to serialise a
 * JSON body is a dependency to patch later for nothing.
 *
 * `document` and `query` are not cosmetic — Voyage embeds them into the same
 * space with different intent, and using the wrong one quietly degrades every
 * retrieval in a way no test will notice.
 */

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/** Voyage caps a single request; larger corpora are chunked. */
export const BATCH_SIZE = 128;

export interface VoyageOptions {
  apiKey?: string;
  model?: string;
  /** Voyage returns 1024 dimensions by default for voyage-4. */
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

export class VoyageEmbeddings implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VoyageOptions = {}) {
    const key = options.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!key) {
      throw new Error('VOYAGE_API_KEY is not set. Run without it to use the fixture provider.');
    }
    this.apiKey = key;
    this.model = options.model ?? 'voyage-4';
    this.dimensions = options.dimensions ?? 1024;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[], purpose: 'document' | 'query'): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: batch,
          model: this.model,
          input_type: purpose,
          output_dimension: this.dimensions,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Voyage ${response.status}: ${detail.slice(0, 200)}`);
      }

      out.push(...parseVoyageResponse(await response.json(), batch.length, this.dimensions));
    }
    return out;
  }
}

/**
 * Pulled out so the failure modes are testable without a key.
 *
 * Voyage returns results with an explicit `index`, and does not promise input
 * order — sorting by it rather than trusting arrival order is the difference
 * between correct retrieval and silently embedding every memory as its
 * neighbour.
 */
export function parseVoyageResponse(
  body: unknown,
  expected: number,
  dimensions: number,
): number[][] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('Voyage response had no data array');
  if (data.length !== expected) {
    throw new Error(`Voyage returned ${data.length} embeddings for ${expected} inputs`);
  }

  const ordered = [...data].sort(
    (a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0),
  );

  return ordered.map((entry, i) => {
    const vector = (entry as { embedding?: unknown }).embedding;
    if (!Array.isArray(vector) || vector.some((n) => typeof n !== 'number')) {
      throw new Error(`Voyage embedding ${i} was not a number array`);
    }
    if (vector.length !== dimensions) {
      throw new Error(
        `Voyage returned ${vector.length} dimensions, expected ${dimensions} — ` +
          'the stored vectors and the query would be in different spaces',
      );
    }
    return vector as number[];
  });
}
