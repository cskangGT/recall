import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The paths `npm start` and the launchd agent must agree on.
 *
 * They did not used to share anything, which was fine while only one of them
 * existed. Two processes that can each start Recall and disagree about where
 * the database is would be a very quiet bug: everything works, and half your
 * memories are in a file you never open.
 */

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const HOME = path.join(homedir(), '.recall');

/** The corpus. Outside the checkout, because a checkout is disposable. */
export const DB = process.env.RECALL_DB ?? path.join(HOME, 'recall.db');

/** The built client, served from the same process on the same origin. */
export const STATIC = path.join(ROOT, 'dist');

/**
 * The agent's key file.
 *
 * `.env.local` lives in the checkout and keeps working for `npm start`. The
 * agent gets its own copy here for the same reason the database is here: an
 * always-on service that stops working because you re-cloned the repo is not
 * always-on. Two files, two lifetimes.
 */
export const ENV_FILE = path.join(HOME, 'env');

export const LOG_DIR = path.join(HOME, 'logs');
export const LOG_OUT = path.join(LOG_DIR, 'server.log');
export const LOG_ERR = path.join(LOG_DIR, 'server.err.log');

export const PORT = Number(process.env.PORT ?? 5170);
export const WORKSPACE = process.env.RECALL_WORKSPACE ?? 'ws_demo';

export const LABEL = 'com.recall.server';
export const PLIST = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

/** The URL that answers if — and only if — Recall is the thing on this port. */
export const healthUrl = (port = PORT) =>
  `http://127.0.0.1:${port}/api/workspaces/${WORKSPACE}/graph`;

/**
 * Is Recall already answering on this port?
 *
 * Distinguishes three states the caller needs to tell apart: nothing is there,
 * something is there but is not Recall, and Recall is there. "Port is open" is
 * not enough — starting a second Recall over somebody else's dev server and
 * starting one over your own agent are different problems.
 */
export async function probe(port = PORT, timeoutMs = 700) {
  try {
    const res = await fetch(healthUrl(port), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return 'occupied';
    const body = await res.json();
    return Array.isArray(body?.memories) ? 'recall' : 'occupied';
  } catch (err) {
    // A refused connection means the port is free; anything else (a timeout, a
    // socket hangup, a non-JSON body) means something is listening and is not
    // answering like Recall.
    return err?.cause?.code === 'ECONNREFUSED' ? 'free' : 'occupied';
  }
}
