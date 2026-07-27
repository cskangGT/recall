import type { AiProvider, EmbeddingProvider } from './provider.ts';
import { FixtureProvider, FixtureEmbeddings } from './fixture.ts';
import { AnthropicProvider } from './anthropic.ts';
import { VoyageEmbeddings } from './voyage.ts';

/**
 * Which brain the server runs on.
 *
 * Fixture unless both keys are present, and the two are chosen together on
 * purpose: real embeddings with a fixture namer, or vice versa, produces a
 * system that half works in a way that is very hard to read from the outside.
 * `RECALL_AI=fixture` forces the fixture even when keys exist, which is what
 * the demo and the test suite want.
 *
 * The seeded corpus carries 8-dimensional hand-authored vectors. Voyage returns
 * 1024, so switching providers on an existing database would compare vectors
 * from two different spaces — the caller has to re-embed, and `selectAi`
 * reports the mismatch rather than letting it happen quietly.
 */

export interface Selection {
  ai: AiProvider;
  embeddings: EmbeddingProvider;
  /** True when the real providers are in use. */
  live: boolean;
  reason: string;
}

export function selectAi(env: NodeJS.ProcessEnv = process.env): Selection {
  const forced = env.RECALL_AI?.toLowerCase();

  if (forced === 'fixture') {
    return {
      ai: new FixtureProvider(),
      embeddings: new FixtureEmbeddings(),
      live: false,
      reason: 'RECALL_AI=fixture',
    };
  }

  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasVoyage = Boolean(env.VOYAGE_API_KEY);

  if (hasAnthropic && hasVoyage) {
    return {
      ai: new AnthropicProvider(env.ANTHROPIC_API_KEY),
      embeddings: new VoyageEmbeddings({ apiKey: env.VOYAGE_API_KEY }),
      live: true,
      reason: 'ANTHROPIC_API_KEY and VOYAGE_API_KEY are set',
    };
  }

  const missing = [
    hasAnthropic ? null : 'ANTHROPIC_API_KEY',
    hasVoyage ? null : 'VOYAGE_API_KEY',
  ].filter(Boolean);

  return {
    ai: new FixtureProvider(),
    embeddings: new FixtureEmbeddings(),
    live: false,
    reason:
      forced === 'live'
        ? `RECALL_AI=live but ${missing.join(' and ')} missing — falling back to fixture`
        : `${missing.join(' and ')} not set`,
  };
}
