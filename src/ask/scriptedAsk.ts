import type { GraphPayload } from '../core/types';
import answers from '../../seed/answers.json';
import { isReflectiveQuestion, recentSample } from '../core/reflect';
import { t, currentLocale } from '../i18n';
import { KO_ANSWERS } from './answersKo';

/**
 * Verbatim and exact. Recall's credibility rests entirely on every answer being
 * traceable to a saved source — one hallucinated answer kills the pitch. (spec 9.2)
 */
export const REFUSAL = "I don't have anything saved about that yet.";

export interface Citation {
  n: number;
  memory_id: string;
  source_id: string;
}

export interface ScriptedAnswer {
  answer: string;
  citations: Citation[];
  highlighted_node_ids: string[];
  refused: boolean;
}

const QUESTION_WORDS = /^(what|why|how|when|who|where|which|did|do|does|should|is|are|can|will)\b/i;

export function isQuestion(input: string): boolean {
  const t = input.trim();
  if (t.length === 0) return false;
  return t.endsWith('?') || QUESTION_WORDS.test(t) || t.split(/\s+/).length > 6;
}

export function answerQuestion(
  question: string,
  payload: GraphPayload,
  history: { question: string; answer: string }[] = [],
  focus: string[] = [],
): ScriptedAnswer {
  // Picked memories are thought with, never refused: the seed's stand-in
  // strings them together in one sentence, citing each, so the surface —
  // the numbers, the map, the evidence beside it — behaves as it will live.
  const picked = focus
    .map((id) => payload.memories.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)
    .slice(0, 6);
  if (picked.length > 0) {
    const cites = picked.map((m, i) => ({ n: i + 1, memory_id: m.id, source_id: m.source_id }));
    const line = picked.map((m, i) => `${m.text} [${i + 1}]`).join(' ');
    const ko = currentLocale() === 'ko';
    return {
      answer: ko ? `고른 것들을 나란히 두고 보면 — ${line}` : `Held side by side, these say — ${line}`,
      citations: cites,
      highlighted_node_ids: [...new Set([...picked.map((m) => m.id), ...picked.map((m) => m.category_id)])],
      refused: false,
    };
  }

  // "What have I been into lately?" is answered by looking around, not by a
  // script: the last two weeks by interest, phrased from the counts — the
  // seed's honest stand-in for what a model does with the same sample.
  if (isReflectiveQuestion(question)) return reflect(payload);

  const q = question.toLowerCase();
  // A follow-up rarely repeats its referent's keywords — "which tool won?"
  // says nothing about evals. The question alone is matched first; failing
  // that, the conversation is, which is the scripted stand-in for what a real
  // model does with the history block. No entry either way still refuses.
  const withHistory = [...history.map((t) => t.question), question].join(' ').toLowerCase();
  const entry =
    answers.find((a) => a.match.every((kw) => q.includes(kw))) ??
    (history.length > 0
      ? answers.find((a) => a.match.every((kw) => withHistory.includes(kw)))
      : undefined);

  // Never answer from world knowledge.
  if (!entry) {
    return { answer: REFUSAL, citations: [], highlighted_node_ids: [], refused: true };
  }

  const highlighted = new Set<string>();
  for (const c of entry.citations) {
    highlighted.add(c.memory_id);
    const memory = payload.memories.find((m) => m.id === c.memory_id);
    if (memory) highlighted.add(memory.category_id);
  }

  // The viewer's language, in the memory's register — the English seed reads
  // as a briefing, and the demo is the first answer a tester ever hears.
  const ko = currentLocale() === 'ko' ? KO_ANSWERS[entry.match.join('+')] : undefined;
  return {
    answer: ko ?? entry.answer,
    citations: entry.citations,
    highlighted_node_ids: [...highlighted],
    refused: false,
  };
}

/** Recent questions, offered as suggestions when the ask bar opens empty. */
export const SUGGESTED_QUESTIONS = [
  'What did we decide about our eval stack?',
  'What are seed rounds landing at?',
  'What works for hiring?',
  'What did we decide about pricing?',
];

function reflect(payload: GraphPayload): ScriptedAnswer {
  const sample = recentSample(payload, { cap: 3, perInterest: 1 });
  const [top, ...others] = sample.interests;
  if (!top) return { answer: REFUSAL, citations: [], highlighted_node_ids: [], refused: true };

  const citations: Citation[] = sample.picks.map((m, i) => ({
    n: i + 1,
    memory_id: m.id,
    source_id: m.source_id,
  }));
  const marks = (from: number, to: number) =>
    citations.slice(from, to).map((c) => `[${c.n}]`).join(' ');
  const rest = others
    .slice(0, 3)
    .map((i) => t('ask.reflect.item', { name: i.name, count: i.count }))
    .join(', ');
  const answer =
    others.length === 0
      ? `${t('ask.reflect.one', { top: top.name, count: top.count })} ${marks(0, 1)}`
      : `${t('ask.reflect.lead', { top: top.name, count: top.count })} ${marks(0, 1)} ` +
        `${t('ask.reflect.rest', { rest })} ${marks(1, citations.length)}`;

  const highlighted = new Set<string>();
  for (const m of sample.picks) {
    highlighted.add(m.id);
    highlighted.add(m.category_id);
  }
  return { answer: answer.trim(), citations, highlighted_node_ids: [...highlighted], refused: false };
}
