import type { EmbeddingProvider } from './provider.ts';

/**
 * OpenAI embeddings.
 *
 * A second embedder alongside Voyage, for the same reason there is a fixture
 * one: the choice of who embeds should not be the choice of who reasons. Voyage
 * was here first because Anthropic's docs point there, and it stayed the only
 * option long enough that `selectAi` would silently drop the whole stack to
 * fixtures if `VOYAGE_API_KEY` was missing — even with two other keys present.
 *
 * Raw HTTP rather than the SDK, matching `voyage.ts`: it is one POST, and a
 * dependency whose only job is to serialise a JSON body is a dependency to
 * patch later for nothing.
 *
 * **`text-embedding-3-*` is Matryoshka.** The width is a request parameter, not
 * a property of the model — the first coordinates carry the most signal, so a
 * shortened vector is still a real embedding rather than a truncated one. That
 * matters here beyond neatness: `seed/workspace.json` is a *static import* in
 * the client bundle, so every dimension is shipped to the browser 49 times.
 *
 * 1024 rather than the model's native 1536, and rather than the 512 this was
 * planned at, because the narrowing is not free and the cost was measured
 * against the demo's own gate:
 *
 *     512   margin 0.0083   FAIL — under the harness's 0.01 floor
 *     768   margin 0.0095   WARN
 *     1024  margin 0.0133   PASS
 *     1536  margin 0.0154   PASS
 *
 * 1024 is the narrowest width where the split the demo is built on still fires
 * with room to spare. It is also Voyage's native width, so the two providers
 * produce vectors of the same shape and a workspace does not have to be
 * re-embedded to change supplier.
 *
 * `document` and `query` are accepted and ignored: unlike Voyage, OpenAI embeds
 * both into one space with no asymmetric hint. Taking the argument anyway keeps
 * the two providers substitutable, and keeps the call sites honest about which
 * side of a retrieval they are on.
 */

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

/** OpenAI accepts far more, but a bounded request is a debuggable one. */
export const BATCH_SIZE = 128;

/**
 * The narrowest width that keeps the demo's split, measured — see the class
 * comment. Exported so the harness and the reseed cannot drift from it.
 */
export const DEFAULT_DIMENSIONS = 1024;

export interface OpenAiEmbeddingOptions {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

export class OpenAiEmbeddings implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiEmbeddingOptions = {}) {
    const key = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is not set. Run without it to use the fixture provider.');
    }
    this.apiKey = key;
    this.model = options.model ?? 'text-embedding-3-small';
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[], _purpose: 'document' | 'query'): Promise<number[][]> {
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
          dimensions: this.dimensions,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 200)}`);
      }

      out.push(...parseOpenAiResponse(await response.json(), batch.length, this.dimensions));
    }
    return out;
  }
}

/**
 * Pulled out so the failure modes are testable without a key.
 *
 * The ordering guard is the one that matters. OpenAI returns an explicit
 * `index` per embedding and does not promise arrival order; trusting the array
 * as it comes is the difference between correct retrieval and silently
 * embedding every memory as its neighbour — a corruption that no assertion
 * downstream would catch, because every vector is still a valid vector.
 */
export function parseOpenAiResponse(
  body: unknown,
  expected: number,
  dimensions: number,
): number[][] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('OpenAI response had no data array');
  if (data.length !== expected) {
    throw new Error(`OpenAI returned ${data.length} embeddings for ${expected} inputs`);
  }

  const ordered = [...data].sort(
    (a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0),
  );

  return ordered.map((entry, i) => {
    const vector = (entry as { embedding?: unknown }).embedding;
    if (!Array.isArray(vector) || vector.some((n) => typeof n !== 'number')) {
      throw new Error(`OpenAI embedding ${i} was not a number array`);
    }
    if (vector.length !== dimensions) {
      throw new Error(
        `OpenAI returned ${vector.length} dimensions, expected ${dimensions} — ` +
          'the stored vectors and the query would be in different spaces',
      );
    }
    return vector as number[];
  });
}
