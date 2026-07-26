import type { SourceType } from '../types/graph';

const URL_RE = /https?:\/\/[^\s]+/g;

/**
 * The user never picks a type. A bare URL is the only thing that would be
 * fetched — a paste of meeting notes that happens to contain a link must not
 * silently turn into a webpage scrape. (spec 5.2)
 */
export function detectCaptureType(input: {
  text: string;
  hasImage: boolean;
}): { type: SourceType; referencedUrls: string[] } {
  if (input.hasImage) return { type: 'screenshot', referencedUrls: [] };

  const trimmed = input.text.trim();
  const matches = trimmed.match(URL_RE) ?? [];

  if (matches.length === 1 && matches[0] === trimmed) {
    return { type: 'link', referencedUrls: [] };
  }
  return { type: 'text', referencedUrls: matches };
}

export const TYPE_LABEL: Record<SourceType, string> = {
  text: 'Text',
  link: 'Link',
  screenshot: 'Screenshot',
};
