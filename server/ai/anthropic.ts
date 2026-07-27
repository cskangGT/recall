import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider, AnswerResult, ExtractResult, NameCluster, NamedCluster,
  NormalizeInput, NormalizeResult, RetrievedMemory,
} from './provider.ts';
import {
  MODEL, answerSchema, buildAnswerPrompt, buildExtractPrompt, buildNamePrompt,
  buildNormalizePrompt, coerceExtract, coerceNormalize, extractSchema, nameByFallback,
  nameSchema, normalizeSchema, resolveAnswer, resolveNames,
} from './prompts.ts';
import type { SourceType } from '../../src/core/types.ts';

/**
 * The real provider.
 *
 * Deliberately thin: prompts, schemas and coercion live in `prompts.ts` where
 * they are unit-tested without credentials, so what remains here is one request
 * shape repeated four times. If this file gets clever, the cleverness has
 * escaped its tests.
 *
 * Structured outputs rather than "reply with JSON": the schema is enforced by
 * the API, which removes the entire class of parse failures that would
 * otherwise surface as a broken reorganization mid-demo.
 */

const MIME: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Run without it to use the fixture provider.',
      );
    }
    this.client = new Anthropic({ apiKey: key });
  }

  private async json(prompt: unknown, schema: object, maxTokens: number): Promise<unknown> {
    const message = await this.client.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt as never }],
      output_config: { format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
    });
    return message.parsed_output ?? null;
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
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: buildNormalizePrompt(input) },
    ];
    return coerceNormalize(await this.json(content, normalizeSchema, 2048));
  }

  async extract(input: {
    content: string;
    sceneDescription?: string;
    type: SourceType;
  }): Promise<ExtractResult> {
    const prompt = buildExtractPrompt(input);
    return coerceExtract(await this.json(prompt, extractSchema, 4096));
  }

  async nameClusters(input: {
    operation: 'split' | 'merge' | 'promote';
    clusters: NameCluster[];
    forbiddenNames: string[];
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

  async answer(input: { question: string; retrieved: RetrievedMemory[] }): Promise<AnswerResult> {
    const raw = await this.json(buildAnswerPrompt(input), answerSchema, 2048);
    return resolveAnswer(raw, input.retrieved);
  }
}
