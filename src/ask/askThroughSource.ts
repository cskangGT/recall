import type { DataSource } from '../data/dataSource';
import type { GraphPayload } from '../core/types';
import { answerQuestion, type ScriptedAnswer } from './scriptedAsk';

/**
 * Ask, without ever passing fiction off as memory.
 *
 * Both ask surfaces used to read:
 *
 *     await source.ask(question).catch(() => answerQuestion(question, payload))
 *
 * which looks like a graceful degradation and is the opposite. `answerQuestion`
 * is a keyword lookup over `seed/answers.json` — a fictional corpus written for
 * the demo. So a server that was down, or an API key that had expired, or any
 * error at all, produced a confident answer citing memories that are not in
 * your corpus and never were, with no indication that anything had gone wrong.
 * If the question missed every scripted keyword you instead got "I don't have
 * anything saved about that yet" — a refusal, about a corpus that was never
 * consulted.
 *
 * For a tool whose entire promise is "everything it says points at something
 * you actually saved", that is not a missing error state. It is the one failure
 * that makes the product worthless, because it is indistinguishable from the
 * product working.
 *
 * The scripted answers stay for seed mode, which is the demo and has no server
 * to ask. What is gone is the *fallback*: once there is a real source, its
 * failure is reported as a failure.
 */

export type AskOutcome =
  | { kind: 'answered'; answer: ScriptedAnswer }
  | { kind: 'unreachable'; message: string };

export async function askThroughSource(
  source: DataSource,
  question: string,
  payload: GraphPayload,
): Promise<AskOutcome> {
  if (!source.ask) {
    // Seed mode. There is no server, the corpus *is* the fixture, and the
    // scripted answer is the honest answer to a question about it.
    return { kind: 'answered', answer: answerQuestion(question, payload) };
  }

  try {
    return { kind: 'answered', answer: await source.ask(question) };
  } catch (err) {
    return { kind: 'unreachable', message: askFailureMessage(err) };
  }
}

/**
 * What went wrong, in words that name the fix.
 *
 * "Failed to fetch" is what the browser says when the server is not running,
 * and it sends people to look at their network. The overwhelmingly likely cause
 * on a personal instance is that Recall itself is not up, so say that.
 */
export function askFailureMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  const looksLikeNoServer = /failed to fetch|networkerror|load failed|econnrefused/i.test(detail);
  return looksLikeNoServer
    ? "Couldn't reach Recall — nothing was answered. Is the server running?"
    : `Couldn't answer that — ${detail}`;
}
