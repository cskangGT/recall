import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';
import { t } from '../i18n';
import { summarizeSources } from './batch';

/**
 * The declaration for a batch that happened outside the page.
 *
 * `npm run import:instagram` (and `import:notes`) talk to the server directly;
 * the page never sees the batch go by. So the CLI ends by printing a link
 * carrying the ids it wrote, and the page, on arrival, plays the same
 * declaration a drop earns — read out of the loaded graph, since the result
 * is already in it. No request is made: seed mode is a no-op by construction.
 *
 * The parameter is spent on arrival, whatever happens next — a reload should
 * not declare twice, and a link pasted into a seed-mode tab should not haunt
 * its address bar.
 *
 * Not replayed, on purpose: the reorganization banners (the link cannot carry
 * the server's events, and the graph already holds their result) and the
 * first-drop sky ceremony (that is the in-page ritual for the first thing
 * handed over by hand).
 */

export interface RevealRequest {
  sourceIds: string[];
  period: { from: string; to: string } | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `?reveal=src_a,src_b&from=YYYY-MM-DD&to=YYYY-MM-DD` → what to declare, or nothing. */
export function parseRevealParams(search: string): RevealRequest | null {
  const params = new URLSearchParams(search);
  const raw = params.get('reveal');
  if (!raw) return null;
  const sourceIds = [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0))];
  if (sourceIds.length === 0) return null;

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const period = DAY.test(from) && DAY.test(to) && from <= to ? { from, to } : null;
  return { sourceIds, period };
}

/** The same query with the reveal spent — everything else (api, lang, plan, invite) stays. */
export function stripRevealParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('reveal');
  params.delete('from');
  params.delete('to');
  return params.toString();
}

export function revealOnReturn(): void {
  const request = parseRevealParams(window.location.search);
  if (!request) return;

  const query = stripRevealParams(window.location.search);
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);

  const ws = useWorkspaceStore.getState();
  if (ws.source.mode !== 'api' || !ws.payload) return;

  const summary = summarizeSources(ws.payload, request.sourceIds, request.period);
  const ui = useUiStore.getState();
  if (!summary) {
    ui.toast(t('toast.revealMissing'));
    return;
  }

  // Putting something in is looking around — the arc only draws once the
  // welcome has stepped aside, and the declaration's "look around" lands there.
  ui.dismissWelcome();
  ui.setBatchReveal({
    phase: 'declare',
    total: summary.sources,
    read: summary.sources,
    summary,
  });
}
