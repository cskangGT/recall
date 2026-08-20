import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AiProvider, AnswerResult, AskTurn, EmbeddingProvider, ExtractResult, MergeDraft, NameCluster,
  NamedCluster, NormalizeInput, NormalizeResult, RetrievedMemory,
  NameOperation,
} from './provider.ts';
import {
  answerSchema, answerSoFar, buildAnswerPrompt, buildExtractPrompt, buildMergePrompt,
  buildNamePrompt, buildNormalizePrompt, coerceExtract, coerceMerge, coerceNormalize,
  extractSchema, mergeSchema, nameByFallback, nameSchema, normalizeSchema, resolveAnswer,
  resolveNames,
} from './prompts.ts';
import type { SourceType } from '../../src/core/types.ts';

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

// ---------------------------------------------------------------- extraction

/**
 * The same four jobs as `AnthropicProvider`, on the account that has credit.
 *
 * Extraction is where the money goes and where it was blocked: a well-formed,
 * authenticated request to Anthropic came back
 * `"Your credit balance is too low"`, while the OpenAI key was already paying
 * for every embedding in the corpus. Moving the one call is cheaper than
 * moving the billing.
 *
 * Deliberately thin, for the reason `anthropic.ts` gives: the prompts, the
 * schemas and the coercion live in `prompts.ts` where they are unit-tested
 * without credentials, so what remains here is one request shape repeated four
 * times. Both providers share every one of them, which is the point — if the
 * two ever disagree about what a memory is, it will be because a model
 * disagreed, not because a file did.
 *
 * Structured Outputs with `strict: true`, matching Anthropic's schema
 * enforcement. The schemas in `prompts.ts` already satisfy what strict mode
 * demands — every property required, `additionalProperties: false` throughout —
 * because they were written for an API that asks the same thing.
 */

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** Strong instruction-following, and the "returning none is valid" line in the
 *  extract prompt needs a model that will actually return none. */
export const CHAT_MODEL = 'gpt-4.1';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}) {
    const key = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is not set. Run without it to use the fixture provider.');
    }
    this.apiKey = key;
    this.model = options.model ?? CHAT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async json(
    content: unknown,
    schemaName: string,
    schema: object,
    maxTokens: number,
  ): Promise<unknown> {
    const response = await this.fetchImpl(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: maxTokens,
        messages: [{ role: 'user', content }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 240)}`);
    }
    return parseChatJson(await response.json());
  }

  async normalize(input: NormalizeInput): Promise<NormalizeResult> {
    if (!input.imagePath) {
      // Text and links skip this call entirely (spec §10.1); if one arrives
      // anyway, answer from what we have rather than inventing a scene.
      return coerceNormalize({
        ocr_text: input.text ?? '',
        scene_description: '',
        detected_context: 'other',
        has_meaningful_text: (input.text ?? '').trim().length > 0,
      });
    }

    const ext = path.extname(input.imagePath).toLowerCase();
    const mediaType = MIME[ext];
    if (!mediaType) throw new Error(`Unsupported image type: ${ext || input.imagePath}`);
    const data = await readFile(input.imagePath, { encoding: 'base64' });

    const content = [
      { type: 'text', text: buildNormalizePrompt(input) },
      { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
    ];
    return coerceNormalize(await this.json(content, 'normalize', normalizeSchema, 2048));
  }

  async extract(input: {
    content: string;
    sceneDescription?: string;
    type: SourceType;
    rejectedExamples?: string[];
  }): Promise<ExtractResult> {
    return coerceExtract(
      await this.json(buildExtractPrompt(input), 'extract', extractSchema, 4096),
    );
  }

  async nameClusters(input: {
    operation: NameOperation;
    clusters: NameCluster[];
    forbiddenNames: string[];
    locale?: 'en' | 'ko';
  }): Promise<NamedCluster[]> {
    const accepted: NamedCluster[] = [];
    let pending = input.clusters;
    let retryReasons: Record<string, string> | undefined;

    // Two attempts, then TF-IDF. The gate has already decided the change is
    // happening — naming cannot be allowed to veto it (spec §10.4).
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
      const taken = [...input.forbiddenNames, ...accepted.map((a) => a.name)];
      const raw = await this.json(
        buildNamePrompt({ ...input, clusters: pending, forbiddenNames: taken, retryReasons }),
        'name_clusters',
        nameSchema,
        1024,
      );
      const { accepted: ok, rejected } = resolveNames(raw, pending, taken);
      accepted.push(...ok);
      pending = pending.filter((c) => rejected[c.cluster_id] !== undefined);
      retryReasons = rejected;
    }

    for (const cluster of pending) accepted.push(nameByFallback(cluster, input.clusters));

    // Back into the caller's order, so a split's two halves stay predictable.
    const byId = new Map(accepted.map((a) => [a.cluster_id, a]));
    return input.clusters
      .map((c) => byId.get(c.cluster_id))
      .filter((a): a is NamedCluster => a !== undefined);
  }

  async answer(input: {
    question: string;
    retrieved: RetrievedMemory[];
    history?: AskTurn[];
  }): Promise<AnswerResult> {
    return resolveAnswer(await this.json(buildAnswerPrompt(input), 'answer', answerSchema, 2048), input.retrieved);
  }

  async mergeMemories(input: { texts: string[]; locale?: 'en' | 'ko' }): Promise<MergeDraft> {
    return coerceMerge(
      await this.json(buildMergePrompt(input), 'merge', mergeSchema, 2048),
      input.texts,
    );
  }

  /**
   * `answer`, streamed. The API emits the schema'd response as JSON text in
   * SSE chunks; `answerSoFar` reads the answer field out of the partial JSON
   * and only the newly-arrived suffix goes to `onDelta`. The final result is
   * parsed from the complete buffer with the same `resolveAnswer` the
   * non-streaming path uses — streaming changes when words arrive, not what
   * the pipeline validates.
   */
  async answerStream(
    input: { question: string; retrieved: RetrievedMemory[]; history?: AskTurn[] },
    onDelta: (text: string) => void,
  ): Promise<AnswerResult> {
    const response = await this.fetchImpl(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: 2048,
        stream: true,
        messages: [{ role: 'user', content: buildAnswerPrompt(input) }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'answer', strict: true, schema: answerSchema },
        },
      }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 240)}`);
    }

    let buffer = '';
    let content = '';
    let sent = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are newline-delimited `data: {...}` lines; a frame can be
      // split across network chunks, so only complete lines are consumed.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data: ') ? line.slice(6).trim() : null;
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
          };
          content += parsed.choices?.[0]?.delta?.content ?? '';
        } catch {
          // A malformed frame is dropped; the final parse is the arbiter.
        }
        const soFar = answerSoFar(content);
        if (soFar.length > sent.length && soFar.startsWith(sent)) {
          onDelta(soFar.slice(sent.length));
          sent = soFar;
        }
      }
    }

    return resolveAnswer(JSON.parse(content), input.retrieved);
  }
}

/**
 * Pulled out so the failure modes are testable without a key.
 *
 * Two of them are specific to this API and both are silent. A refusal comes
 * back as a `refusal` field with `content` null, which would otherwise parse as
 * "no memories" rather than as an error. And a response truncated by the token
 * limit still arrives with `finish_reason: "length"` and a half-written JSON
 * body — strict mode guarantees the *shape* of a complete reply, not that the
 * reply completed.
 */
export function parseChatJson(body: unknown): unknown {
  const choice = (body as { choices?: { message?: Record<string, unknown>; finish_reason?: string }[] })
    ?.choices?.[0];
  if (!choice) throw new Error('OpenAI response had no choices');

  const refusal = choice.message?.refusal;
  if (typeof refusal === 'string' && refusal.length > 0) {
    throw new Error(`OpenAI refused: ${refusal.slice(0, 160)}`);
  }
  if (choice.finish_reason === 'length') {
    throw new Error('OpenAI response was truncated — raise max_completion_tokens');
  }

  const content = choice.message?.content;
  if (typeof content !== 'string') throw new Error('OpenAI response had no content');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`OpenAI returned unparseable JSON: ${content.slice(0, 160)}`);
  }
}
