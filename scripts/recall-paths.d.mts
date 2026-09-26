/** Types for recall-paths.mjs — the script stays plain JS so `node scripts/…` needs no build. */
export const ROOT: string;
export const HOME: string;
export const DB: string;
export const STATIC: string;
export const ENV_FILE: string;
export const LOG_DIR: string;
export const LOG_OUT: string;
export const LOG_ERR: string;
export const PORT: number;
export const WORKSPACE: string;
export const INSTAGRAM_SEEN: string;
export const LABEL: string;
export const PLIST: string;
export function healthUrl(port?: number): string;
export function probe(port?: number, timeoutMs?: number): Promise<'free' | 'occupied' | 'recall'>;
export function revealUrl(
  sourceIds: readonly string[],
  period?: { from: string; to: string } | null,
  app?: string,
): string;
