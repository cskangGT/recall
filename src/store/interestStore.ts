import { create } from 'zustand';
import type { InterestEvent } from '../arc/interest';

/**
 * What the user did, so the arc can show what they have been on.
 *
 * Two of the three signals the arc ranks by are already in the corpus or
 * derivable from it — a memory knows when it arrived. Asking and opening leave
 * no trace anywhere: `ask_history` is written on the server
 * (server/pipeline/ask.ts) and read by nothing, exposed by no route, and absent
 * from the payload; opening a category sets `openCategoryId`, a single current
 * value that the next click overwrites. So this is where those two get kept.
 *
 * **The first persistence in the client.** Nothing else in `src/` writes to
 * localStorage, and that is deliberate — the workspace is the server's, and a
 * second copy of it in the browser would be a second source of truth. This is
 * not a copy of anything: it is a log of interactions the server never sees, and
 * losing it on reload would make the arc's entire premise ("lately") a claim
 * about the last few minutes. When the server grows an interest endpoint this
 * becomes its cache rather than its home.
 *
 * Reads and writes are wrapped, because storage throws for reasons that have
 * nothing to do with us — Safari private browsing, a full quota, a user who
 * turned it off. A ranked arc that fails is a worse product than an unranked one.
 */

const STORAGE_KEY = 'recall.interest.v1';

/**
 * Two hundred events.
 *
 * Past the 120-day horizon in `interest.ts` an event scores exactly zero, so the
 * cap is not about relevance — it is about a log that grows forever in a place
 * with a few megabytes to spend. At a realistic pace this is months of history,
 * and the oldest thing to fall off is by construction the least valuable.
 */
export const MAX_EVENTS = 200;

interface InterestState {
  events: InterestEvent[];
  /** Records attention. `categoryId` must already be a top-level category. */
  record: (categoryId: string, kind: InterestEvent['kind']) => void;
  /** Forgets everything. Wired to the same reset that clears the workspace. */
  clear: () => void;
}

function load(): InterestEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validated rather than trusted: this string is user-editable, survives
    // across deploys, and a malformed entry would otherwise reach the scorer.
    return parsed.filter(
      (e): e is InterestEvent =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as InterestEvent).categoryId === 'string' &&
        typeof (e as InterestEvent).at === 'string' &&
        ((e as InterestEvent).kind === 'asked' || (e as InterestEvent).kind === 'opened'),
    );
  } catch {
    return [];
  }
}

function save(events: InterestEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Quota, private mode, storage disabled. The arc falls back to ranking on
    // the corpus alone, which is degraded but not broken.
  }
}

export const useInterestStore = create<InterestState>((set) => ({
  events: load(),

  record: (categoryId, kind) =>
    set((s) => {
      /*
       * Opening the same category twice in a row is one visit, not two.
       *
       * Without this, walking back and forth between two categories inflates
       * both of them faster than actually reading anything, and the arc ends up
       * ranking navigation rather than interest. Asking twice about the same
       * category *is* two questions, so only visits are collapsed.
       */
      const last = s.events[s.events.length - 1];
      if (kind === 'opened' && last?.kind === 'opened' && last.categoryId === categoryId) {
        return s;
      }
      const events = [...s.events, { categoryId, kind, at: new Date().toISOString() }].slice(
        -MAX_EVENTS,
      );
      save(events);
      return { events };
    }),

  clear: () =>
    set(() => {
      save([]);
      return { events: [] };
    }),
}));
