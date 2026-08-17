import type { PageText } from './pageText.js';

export const MAX_PAGE_CHARS: number;
export const MIN_PAGE_CHARS: number;
export const TRUNCATION_MARKER: string;

export interface CaptureBody {
  type: 'link';
  url: string;
  title: string;
  content: string;
  includeGraph: false;
}

/** Either a body to POST, or a reason to tell the user and send nothing. */
export type CaptureRequest = { body: CaptureBody; skip?: undefined } | { skip: string; body?: undefined };

export interface CaptureResult {
  status?: 'complete' | 'no_memories' | 'failed';
  addedMemoryIds?: string[];
  skipped?: { text: string; similarity: number }[];
  touchedCategories?: { id: string; name: string }[];
  reorg?: { banner_text?: string } | null;
  note?: string;
}

/** Null when the page is fine to save; a sentence to show when it is not. */
export function skipReason(url: string, endpointOrigin: string): string | null;

export function buildCaptureRequest(page: PageText): CaptureRequest;

export function describeResult(result: CaptureResult): { title: string; message: string };
