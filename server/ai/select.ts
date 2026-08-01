import type { AiProvider, EmbeddingProvider } from './provider.ts';
import { FixtureProvider, FixtureEmbeddings } from './fixture.ts';
import { AnthropicProvider } from './anthropic.ts';
import { VoyageEmbeddings } from './voyage.ts';
import { OpenAiEmbeddings } from './openai.ts';

/**
 * Which brain the server runs on.
 *
 * Fixture unless a namer *and* an embedder are both available, and the two are
 * still chosen together on purpose: real embeddings with a fixture namer, or
 * vice versa, produces a system that half works in a way that is very hard to
 * read from the outside. `RECALL_AI=fixture` forces the fixture even when keys
 * exist, which is what the demo and the test suite want.
 *
 * What changed is that there are now two embedders. Voyage was here first —
 * Anthropic has no embedding endpoint and its docs point there — and being the
 * only one made `VOYAGE_API_KEY` load-bearing for the entire stack: with an
 * Anthropic key and an OpenAI key present and Voyage's missing, this returned
 * fixtures for everything and gave the reason as "VOYAGE_API_KEY not set",
 * which is true and useless. An embedder is an embedder; either key buys one.
 *
 * Voyage keeps precedence when both are set, because it is the one whose
 * `document`/`query` asymmetry the retrieval path was written against.
 *
 * Both default to 1024 dimensions, so the choice of supplier does not by itself
 * strand a stored corpus. The seeded workspace is the exception and always has
 * been — its vectors are authored, and `main.ts` warns when they disagree with
 * whatever the live provider returns.
 */

export interface Selection {
  ai: AiProvider;
  embeddings: EmbeddingProvider;
  /** True when the real providers are in use. */
  live: boolean;
  reason: string;
}

function fixture(reason: string): Selection {
  return {
    ai: new FixtureProvider(),
    embeddings: new FixtureEmbeddings(),
    live: false,
    reason,
  };
}

export function selectAi(env: NodeJS.ProcessEnv = process.env): Selection {
  const forced = env.RECALL_AI?.toLowerCase();

  if (forced === 'fixture') return fixture('RECALL_AI=fixture');

  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasVoyage = Boolean(env.VOYAGE_API_KEY);
  const hasOpenAi = Boolean(env.OPENAI_API_KEY);

  if (hasAnthropic && (hasVoyage || hasOpenAi)) {
    const embeddings = hasVoyage
      ? new VoyageEmbeddings({ apiKey: env.VOYAGE_API_KEY })
      : new OpenAiEmbeddings({ apiKey: env.OPENAI_API_KEY });
    return {
      ai: new AnthropicProvider(env.ANTHROPIC_API_KEY),
      embeddings,
      live: true,
      reason: `ANTHROPIC_API_KEY with ${hasVoyage ? 'VOYAGE_API_KEY' : 'OPENAI_API_KEY'}`,
    };
  }

  // Named as one requirement rather than two, because "no embedder" is a single
  // problem however many suppliers could have solved it.
  const missing = [
    hasAnthropic ? null : 'ANTHROPIC_API_KEY',
    hasVoyage || hasOpenAi ? null : 'VOYAGE_API_KEY or OPENAI_API_KEY',
  ].filter(Boolean);

  return fixture(
    forced === 'live'
      ? `RECALL_AI=live but ${missing.join(' and ')} missing — falling back to fixture`
      : `${missing.join(' and ')} not set`,
  );
}
