/**
 * A page in sections, so that a summary can miss nothing.
 *
 * The person asked for two things of a link: the whole of it summarised, and
 * — where there is a lot — the parts, each said briefly, so they can take
 * only what they want. "Miss nothing" cannot be asked of a model; it can be
 * built. The text is cut here, deterministically, into sections that between
 * them hold every line of it, and the model is made to write one summary per
 * section, in order, exactly as many as there are. A section it leaves out
 * gets its own first sentence instead. Nothing on the page can fall through.
 */

export interface Section {
  heading: string | null;
  text: string;
}

export interface Digest {
  /** What the whole page says. */
  summary: string;
  /** One per section, in order. */
  sections: { summary: string }[];
}

/** A section grows to about this before the next paragraph starts a new one. */
const TARGET = 1_400;
/** No section is longer than this; a single long paragraph is cut at a sentence. */
const MAX = 2_200;
/** A section shorter than this absorbs the heading that follows rather than closing. */
const MIN = 300;

const looksLikeHeading = (line: string): boolean =>
  line.length <= 60 && !/[.!?。…:;,]$/.test(line) && !/^[-•*·\d]/.test(line) && line.split(/\s+/).length <= 10;

/** A paragraph too long for one section, cut at sentence ends. */
function cutLong(line: string): string[] {
  if (line.length <= MAX) return [line];
  const out: string[] = [];
  let cur = '';
  for (const sentence of line.split(/(?<=[.!?。])\s+/)) {
    if (cur && cur.length + sentence.length + 1 > MAX) {
      out.push(cur);
      cur = sentence;
    } else cur = cur ? `${cur} ${sentence}` : sentence;
  }
  if (cur) out.push(cur);
  // A sentence longer than MAX on its own: hard cut, still nothing lost.
  return out.flatMap((s) => (s.length <= MAX ? [s] : (s.match(new RegExp(`[\\s\\S]{1,${MAX}}`, 'g')) ?? [s])));
}

/** Every non-empty line of the text lands in exactly one section, in order. */
export function splitSections(text: string): Section[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap(cutLong);
  const sections: Section[] = [];
  let cur: Section = { heading: null, text: '' };
  const close = () => {
    if (cur.text || cur.heading) sections.push(cur);
    cur = { heading: null, text: '' };
  };
  for (const line of lines) {
    if (looksLikeHeading(line)) {
      if (cur.text.length >= MIN) {
        close();
        cur.heading = line;
      } else if (!cur.text) {
        // Consecutive headings: the last one names the section; the earlier stay as text.
        if (cur.heading) cur.text = cur.heading;
        cur.heading = line;
      } else {
        cur.text += `\n${line}`;
      }
      continue;
    }
    if (cur.text && cur.text.length + line.length > (cur.text.length >= TARGET ? 0 : MAX) && cur.text.length >= MIN) {
      close();
    }
    cur.text = cur.text ? `${cur.text}\n${line}` : line;
  }
  close();
  // A trailing heading with nothing under it is text, not a section.
  return sections.map((s) => (s.text ? s : { heading: null, text: s.heading ?? '' })).filter((s) => s.text);
}

/** The first sentence of a section, for where the model said nothing. */
export function firstSentence(text: string, max = 160): string {
  const first = text.split(/(?<=[.!?。])\s+|\n/)[0] ?? text;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/** The digest without a model: first sentences, joined. Honest, if flat. */
export function fallbackDigest(sections: Section[]): Digest {
  const each = sections.map((s) => ({ summary: firstSentence(s.text) }));
  return { summary: each.map((s) => s.summary).join(' '), sections: each };
}
