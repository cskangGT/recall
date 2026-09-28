import { describe, it, expect } from 'vitest';
import { revealUrl, INSTAGRAM_SEEN } from '../../scripts/recall-paths.mjs';

/**
 * The link a CLI import ends with: the page reads the ids and the period out
 * of it and plays the declaration (src/capture/revealOnReturn.ts is the
 * other half — the two have to agree on the parameter names).
 */
describe('revealUrl', () => {
  it('names the sources and the stretch of time they cover', () => {
    expect(revealUrl(['src_a', 'src_b'], { from: '2026-08-01', to: '2026-08-14' })).toBe(
      'http://localhost:5173/?api=1&reveal=src_a%2Csrc_b&from=2026-08-01&to=2026-08-14',
    );
  });

  it('leaves the period out when the import does not know it', () => {
    expect(revealUrl(['src_a'])).toBe('http://localhost:5173/?api=1&reveal=src_a');
    expect(revealUrl(['src_a'], null)).toBe('http://localhost:5173/?api=1&reveal=src_a');
  });

  it('points at whatever origin the app is served from', () => {
    expect(revealUrl(['src_a'], null, 'http://127.0.0.1:5170')).toBe(
      'http://127.0.0.1:5170/?api=1&reveal=src_a',
    );
  });

  it('the seen-set lives beside the database', () => {
    expect(INSTAGRAM_SEEN.endsWith('/.recall/instagram-seen.json')).toBe(true);
  });
});
