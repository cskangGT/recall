import type { GraphPayload } from '../core/types';
import answers from '../../seed/answers.json';

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

export function answerQuestion(question: string, payload: GraphPayload): ScriptedAnswer {
  const q = question.toLowerCase();
  const entry = answers.find((a) => a.match.every((kw) => q.includes(kw)));

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

  return {
    answer: entry.answer,
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
