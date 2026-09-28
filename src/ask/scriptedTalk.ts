import { t } from '../i18n';
import type { TalkTurn } from '../data/dataSource';

/**
 * The first conversation without a model: two fixed questions and a fixed
 * closing, and the person's own sentences as the lines worth keeping. The
 * seed rehearsal and a server without a talking model take this path; it is
 * honest about what it is — the shape of the talk, not the talk.
 */
export const TALK_TURNS = 3;

export function scriptedTalk(turns: TalkTurn[]): { text: string; closing: boolean } {
  const said = turns.filter((tn) => tn.who === 'mado').length;
  if (said >= TALK_TURNS - 1) return { text: t('welcome.talk.close'), closing: true };
  return { text: said === 0 ? t('welcome.talk.q1') : t('welcome.talk.q2'), closing: false };
}

export function scriptedLines(turns: TalkTurn[]): string[] {
  return turns
    .filter((tn) => tn.who === 'you')
    .flatMap((tn) => tn.text.split(/(?<=[.!?。])\s+|\n+/))
    .map((l) => l.trim())
    .filter((l) => l.length >= 8)
    .slice(0, 6);
}
