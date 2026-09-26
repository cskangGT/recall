/**
 * One spelling of a name, so that two mentions of the same person or company
 * land on the same entity row.
 *
 * `entities.normalized_name` is the key `upsertEntity` looks up by, alias
 * first; whatever this function returns is what deduplicates the graph.
 * Extraction, seed import and calendar matching all go through it, which is
 * the point — an attendee named "Kim Sujin (Acme)" in Google has to find the
 * entity the extractor once stored as "Kim Sujin", and the only way that
 * holds is if both sides agree on one function.
 *
 * Deliberately conservative: it folds what is certainly the same (case,
 * width, wrapping punctuation, a trailing affiliation in brackets, a Korean
 * honorific) and leaves everything else, diacritics included. "Zoë" and
 * "Zoe" may be the same person, but folding them would also merge names that
 * only differ by an accent — and a false merge is worse than a missed one,
 * because the graph then attributes one person's memories to another.
 */

/** Characters that only wrap a name — straight and curly quotes, all brackets. */
const WRAPPING = /^[\s"'“”‘’«»「」『』()\[\]{}<>]+|[\s"'“”‘’«»「」『』()\[\]{}<>]+$/g;

/**
 * Titles a Korean speaker attaches after a name. Only ones that are never
 * part of the name itself; a longer list would start eating real syllables.
 */
const KOREAN_HONORIFICS = ['님', '씨', '대표', '팀장', '매니저'];

export function normalizeEntityName(name: string): string {
  let s = name.normalize('NFKC').toLowerCase().trim();

  // "Kim Sujin (Acme)" — the affiliation helps a reader, not a key. Only a
  // parenthetical at the very end, and only when something precedes it: a name
  // that is nothing but a bracketed word is handled by the unwrapping below.
  s = s.replace(/\s*[(\[（]\S[^)\]）]*[)\]）]\s*$/u, (match, offset: number) => (offset > 0 ? '' : match));

  s = s.replace(WRAPPING, '').replace(/\s+/g, ' ').trim();

  // "김수진 님" / "김수진 대표" → 김수진. Attached (no space) only for 님/씨 and
  // only on a name long enough that the honorific cannot be the name.
  for (const title of KOREAN_HONORIFICS) {
    if (s.endsWith(` ${title}`)) {
      s = s.slice(0, -title.length - 1).trim();
      break;
    }
  }
  if ((s.endsWith('님') || s.endsWith('씨')) && [...s].length >= 3) {
    s = s.slice(0, -1);
  }

  return s;
}

/**
 * Domains that name a mail provider, not the writer's company. A person on
 * gmail is not a member of an organization called "gmail".
 */
const FREE_MAIL = new Set([
  'gmail', 'googlemail', 'naver', 'kakao', 'daum', 'hanmail', 'nate',
  'outlook', 'hotmail', 'live', 'msn', 'icloud', 'me', 'mac', 'yahoo',
  'proton', 'protonmail', 'aol', 'gmx', 'qq', '163', '126',
]);

/**
 * Second-level labels that are part of a country's public suffix rather
 * than a registrant's name — "acme.co.kr" is registered as "acme", not "co".
 * Not the full public suffix list; the common shapes cover the calendars
 * this is run over, and a wrong guess here only costs one matching hint.
 */
const PUBLIC_SECOND_LEVEL = new Set(['co', 'com', 'ne', 'net', 'or', 'org', 'go', 'gov', 'ac', 'edu', 're', 'pe', 'ltd', 'plc']);

/**
 * What an address can say about a person: the local part (often their name)
 * and the label of the domain they write from (often their company).
 */
export function emailToNames(email: string): {
  local: string;
  domain: string | null;
  domainName: string | null;
} {
  const at = email.indexOf('@');
  if (at < 0) return { local: email.trim().toLowerCase(), domain: null, domainName: null };

  const local = email.slice(0, at).trim().toLowerCase();
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return { local, domain: null, domainName: null };

  const labels = domain.split('.').filter(Boolean);
  // A ccTLD (two letters) under a public second-level label — "co.kr" — is a
  // two-label suffix; everything else is a one-label suffix.
  let suffix = 1;
  if (labels.length >= 3 && labels.at(-1)!.length === 2 && PUBLIC_SECOND_LEVEL.has(labels.at(-2)!)) {
    suffix = 2;
  }
  const registrable = labels.length > suffix ? labels[labels.length - suffix - 1]! : null;
  const domainName = registrable && !FREE_MAIL.has(registrable) ? registrable : null;

  return { local, domain, domainName };
}
