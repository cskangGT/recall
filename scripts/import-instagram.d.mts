/** Types for import-instagram.mjs — the script stays plain JS so `npm run import:instagram` needs no build. */

export interface SavedPost {
  url: string;
  code: string;
  kind: 'post' | 'reel';
  author: string;
  caption: string | null;
  postedAt: string | null;
  description: string | null;
  collection: string | null;
}

export interface BatchItem {
  type: 'text';
  title: string;
  content: string;
  url: string;
}

export interface SeenSet {
  version: 1;
  posts: Record<string, { sourceId: string; workspace: string; importedAt: string }>;
}

export function canonicalUrl(url: unknown): string | null;
export function validatePosts(json: unknown): {
  posts: SavedPost[];
  dropped: { index: number; reason: string }[];
};
export function toItem(post: SavedPost): { item: BatchItem; droppedLines: number };
export function uniqueTitles<T extends { title: string; code: string }>(items: T[]): T[];
export function chunk<T>(arr: T[], size?: number): T[][];
export function periodOf(posts: readonly SavedPost[]): { from: string; to: string } | null;
export function loadSeen(file?: string): SeenSet;
export function saveSeen(file: string, seen: SeenSet): void;
export function main(argv?: string[]): Promise<void>;
