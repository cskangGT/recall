/**
 * Secrets never leave the process.
 *
 * Learned on the first real import: a note carried a live payment key,
 * which was faithfully extracted into a memory and travelled to the model as
 * prompt content. People keep secrets in the things they save; a memory that
 * forwards them wholesale is an exfiltration tool with good intentions.
 *
 * This is the one place that knows what a secret looks like, and it runs on
 * every capture before anything is stored or sent — pasted text, a link's
 * fetched body, a diary page, a meeting's line, the words read out of a
 * screenshot or a PDF. Two shapes of rule:
 *
 *   token   a credential-shaped string is replaced in place with a marker,
 *           and the rest of the line stays — "the Stripe key is [redacted]"
 *           is still a memory worth keeping
 *   line    a `password: …` line goes whole, because what follows the colon
 *           is the secret and the label is all that is left
 *
 * Numbers are the hard part: a card number and an order id look alike. A
 * run of 13–19 digits is redacted only when it passes the Luhn check, and a
 * Korean resident number only in its own 6-7 shape with a valid date. Order
 * ids, phone numbers, dates and prices stay.
 */

export const MARK = '[redacted]';

/** Whole-line rules: the label survives, the value goes with the line. */
export const LINE_PATTERNS: RegExp[] = [
  /(password|passwd|passphrase|비밀번호|비번)\s*[:=]\s*\S+/i,
];

/** In-place rules: the token goes, the sentence around it stays. */
export const TOKEN_PATTERNS: RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]{8,}/g, // Stripe secrets
  /whsec_[A-Za-z0-9]{8,}/g, // Stripe webhook secrets
  /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic-style keys
  /AKIA[0-9A-Z]{16}/g, // AWS access keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{12,}['"]?/gi,
];

/** A card number, in any of its spellings — kept only if Luhn says so. */
const CARD_RUN = /\b(?:\d[ -]?){12,18}\d\b/g;
/** 주민등록번호: yymmdd-gxxxxxx, with a real-looking date and a gender digit. */
const RRN = /\b(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[ -]?([1-8])\d{6}\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface Redaction {
  text: string;
  /** How many secrets were replaced or removed. Zero means the text is as it came. */
  count: number;
}

export function redact(text: string): Redaction {
  if (!text) return { text, count: 0 };
  let count = 0;

  // Private key blocks first — multi-line, and the lines inside would
  // otherwise read as harmless base64.
  let out = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g,
    () => {
      count++;
      return MARK;
    },
  );

  out = out
    .split('\n')
    .filter((line) => {
      if (LINE_PATTERNS.some((p) => p.test(line))) {
        count++;
        return false;
      }
      return true;
    })
    .join('\n');

  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      count++;
      return MARK;
    });
  }

  out = out.replace(CARD_RUN, (run) => {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return run;
    count++;
    return MARK;
  });

  out = out.replace(RRN, () => {
    count++;
    return MARK;
  });

  return { text: out, count };
}

/**
 * The readers' older contract: whole lines dropped, a count returned. Kept
 * for the notes, Notion and Instagram importers, which report "n lines
 * stayed on your Mac"; new code should call `redact`.
 */
export function stripSecrets(body: string): { kept: string; dropped: number } {
  let dropped = 0;
  const kept = body
    .split('\n')
    .filter((line) => {
      if (LINE_PATTERNS.some((p) => p.test(line)) || TOKEN_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(line))) {
        dropped++;
        return false;
      }
      return true;
    })
    .join('\n');
  return { kept, dropped };
}
