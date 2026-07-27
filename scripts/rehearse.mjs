#!/usr/bin/env node
/**
 * Runs the spec 15.3 demo click path N times and reports timing and deviation.
 *
 * Spec 15.4 requires 20 consecutive clean runs on the demo machine before demo
 * day. Doing that by hand is both tedious and useless — a human can't tell a
 * 6.2-second beat from a 7.8-second one, and those two feel very different when
 * you're narrating over them. This measures each beat instead.
 *
 * Every run asserts the same invariants the E2E suite does, plus the ones that
 * only matter on stage: no console errors, no network egress, and a banner
 * whose text is exactly what the presenter is about to say out loud.
 *
 * Usage:
 *   npm run dev                      # in another terminal
 *   node scripts/rehearse.mjs        # 20 runs
 *   node scripts/rehearse.mjs 3      # 3 runs, for a quick check
 */

import pw from '@playwright/test';

const { chromium } = pw;
const RUNS = Number(process.argv[2] ?? 20);
const RAW_BASE = process.env.REHEARSAL_URL ?? 'http://localhost:5173';
// The welcome screen is a conversation, not something to automate through: the
// rehearsal measures the demo from the arc onward.
const BASE = `${RAW_BASE}${RAW_BASE.includes('?') ? '&' : '?'}skipWelcome=1`;

/** Spec 15.2: the whole path must land between these with narration. */
const TARGET_TOTAL_MIN_MS = 55_000;
const TARGET_TOTAL_MAX_MS = 65_000;

/** Spec 5.3 latency budget, measured from submit to the banner. */
const PROCESSING_P95_MS = 12_000;

/** Spec 5.1: first painted node. */
const PAINT_BUDGET_MS = 1_500;

const BANNER_TEXT =
  'Split AI Tooling into Agent Frameworks and Evals & Observability';

const REFUSAL = "I don't have anything saved about that yet.";

const fmt = (ms) => `${(ms / 1000).toFixed(2)}s`;

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    min: s[0],
    median: at(0.5),
    p95: at(0.95),
    max: s[s.length - 1],
    spread: s[s.length - 1] - s[0],
  };
}

/** Non-blocking DOM probe. A locator's auto-wait would sit through the banner's
 *  12-second lifetime and miss it entirely. */
const probe = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, selector);

async function waitFor(page, selector, timeoutMs, predicate = (t) => t !== null) {
  const started = Date.now();
  for (;;) {
    const text = await probe(page, selector);
    if (predicate(text)) return { text, elapsed: Date.now() - started };
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${selector}`);
    }
    await page.waitForTimeout(40);
  }
}

async function runOnce(browser, index) {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    // Checked against the origin, not BASE — BASE carries a query string, and
    // matching on it would flag every asset request as egress.
    if (!u.startsWith(RAW_BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) {
      problems.push(`network egress: ${u}`);
    }
  });

  const beats = {};
  const t0 = Date.now();

  try {
    // ---- Beat 1: recognition
    // The app lands in the arc browser. That is the opening frame the audience
    // sees once the greeting is answered, so it is the one the rehearsal times.
    await page.goto(BASE);
    await waitFor(page, '[data-testid="arc-browser"]', 8000, (t) => t !== null);
    beats.paint = Date.now() - t0;

    const opening = await probe(page, '[data-testid="inspector"]');
    for (const expected of ['47 memories', '22 sources', '20 categories']) {
      if (!opening?.includes(expected)) {
        problems.push(`opening inspector missing "${expected}"`);
      }
    }

    await page.keyboard.press('g');
    await waitFor(page, '[data-testid="map-canvas"]', 3000);
    beats.beat1 = Date.now() - t0;

    // ---- Beat 2: the magic
    const tCapture = Date.now();
    await page.keyboard.press('Meta+k');
    await waitFor(page, '[data-testid="capture-bar"]', 3000);
    beats.captureBar = Date.now() - tCapture;

    await page.locator('[data-testid="capture-input"]').fill(
      'Braintrust vs Langfuse — offline eval suites catch what tracing misses',
    );
    const tSubmit = Date.now();
    await page.keyboard.press('Enter');

    // Every ticker stage must appear, in order.
    const seen = [];
    const wantStages = ['Reading', 'Extracting', 'Finding connections', 'Reorganizing'];
    let bannerText = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const banner = await probe(page, '[role="status"]');
      if (banner) {
        bannerText = banner;
        break;
      }
      const ticker = await probe(page, '[data-testid="status-ticker"]');
      if (ticker && !seen.includes(ticker)) seen.push(ticker);
      await page.waitForTimeout(40);
    }
    beats.processing = Date.now() - tSubmit;

    if (!bannerText) throw new Error('banner never appeared');
    const flat = bannerText.replace(/\s+/g, ' ');
    if (!flat.includes(BANNER_TEXT)) {
      problems.push(`banner text drifted: ${JSON.stringify(flat)}`);
    }
    for (const want of wantStages) {
      if (!seen.some((s) => s.includes(want))) problems.push(`ticker stage missing: ${want}`);
    }

    const after = await probe(page, '[data-testid="inspector"]');
    for (const expected of ['49 memories', '23 sources', '22 categories']) {
      if (!after?.includes(expected)) problems.push(`post-split inspector missing "${expected}"`);
    }
    beats.beat2 = Date.now() - t0;

    // ---- Beat 3: the payoff
    const tAsk = Date.now();
    await page.keyboard.press('Meta+/');
    await waitFor(page, '[data-testid="ask-bar"]', 3000);
    await page.locator('[data-testid="ask-input"]').fill(
      'What did we decide about our eval stack?',
    );
    await page.keyboard.press('Enter');
    const answer = await waitFor(page, '[data-testid="answer"]', 5000);
    beats.ask = Date.now() - tAsk;

    const citations = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="citation-"]').length,
    );
    if (citations !== 3) problems.push(`expected 3 citations, got ${citations}`);
    for (const sentence of answer.text.split(/(?<=\.)\s+/)) {
      if (sentence.trim() && !/\[\d+\]/.test(sentence)) {
        problems.push(`uncited sentence: ${JSON.stringify(sentence.slice(0, 48))}`);
      }
    }

    await page.locator('[data-testid="citation-3"]').click();
    const source = await waitFor(page, '[data-testid="source-card"]', 3000);
    if (!source.text.includes('Thread on eval harnesses')) {
      problems.push('citation [3] did not resolve to the captured screenshot');
    }
    beats.beat3 = Date.now() - t0;

    // ---- Presenter safety nets, exercised every run
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(600);
    const undone = await probe(page, '[data-testid="inspector"]');
    if (!undone?.includes('20 categories')) {
      problems.push('undo did not restore the pre-split taxonomy');
    }

    await page.keyboard.press('Meta+/');
    await page.locator('[data-testid="ask-input"]').fill('What is the capital of France?');
    await page.keyboard.press('Enter');
    const refusal = await waitFor(page, '[data-testid="answer"]', 4000);
    if (refusal.text.trim() !== REFUSAL) {
      problems.push(`refusal drifted: ${JSON.stringify(refusal.text.slice(0, 60))}`);
    }

    beats.total = Date.now() - t0;
  } catch (err) {
    problems.push(`threw: ${err.message}`);
    beats.total = Date.now() - t0;
  } finally {
    await page.close();
  }

  const clean = problems.length === 0;
  const mark = clean ? '[32m✓[0m' : '[31m✗[0m';
  process.stdout.write(
    `${mark} run ${String(index + 1).padStart(2)}  ` +
      `paint ${fmt(beats.paint ?? 0)}  ` +
      `processing ${fmt(beats.processing ?? 0)}  ` +
      `ask ${fmt(beats.ask ?? 0)}  ` +
      `total ${fmt(beats.total ?? 0)}\n`,
  );
  for (const p of problems) console.log(`    ${p}`);
  return { clean, beats, problems };
}

const browser = await chromium.launch();
console.log(`Rehearsing the spec 15.3 click path ${RUNS}× against ${BASE}\n`);

const results = [];
for (let i = 0; i < RUNS; i++) results.push(await runOnce(browser, i));
await browser.close();

const cleanRuns = results.filter((r) => r.clean);
console.log(`\n${'='.repeat(72)}`);
console.log(`Clean runs: ${cleanRuns.length}/${RUNS}`);

if (cleanRuns.length > 0) {
  console.log('\nTiming across clean runs:');
  const rows = [
    ['first paint', 'paint', PAINT_BUDGET_MS],
    ['submit -> banner', 'processing', PROCESSING_P95_MS],
    ['ask -> answer', 'ask', null],
    ['whole path', 'total', null],
  ];
  for (const [label, key, budget] of rows) {
    const s = stats(cleanRuns.map((r) => r.beats[key]).filter((v) => v != null));
    const over = budget != null && s.p95 > budget ? `  OVER BUDGET (${fmt(budget)})` : '';
    console.log(
      `  ${label.padEnd(18)} min ${fmt(s.min)}  median ${fmt(s.median)}  ` +
        `p95 ${fmt(s.p95)}  max ${fmt(s.max)}  spread ${fmt(s.spread)}${over}`,
    );
  }
}

// The click path runs unnarrated here; on stage the presenter's talking sets
// the pace. Report the machine time so the gap to 60s is visible.
if (cleanRuns.length > 0) {
  const t = stats(cleanRuns.map((r) => r.beats.total));
  const slack = TARGET_TOTAL_MIN_MS - t.median;
  console.log(
    `\nMachine time is ${fmt(t.median)} median; the 55-65s target assumes ` +
      `~${fmt(Math.max(0, slack))} of narration.`,
  );
  if (t.median > TARGET_TOTAL_MAX_MS) {
    console.log('  The path alone already exceeds 65s — it cannot be narrated in budget.');
  }
}

const ok = cleanRuns.length === RUNS;
console.log(
  ok
    ? `\n${RUNS} consecutive clean runs — spec 15.4 satisfied.`
    : `\n${RUNS - cleanRuns.length} run(s) deviated. Spec 15.4 requires ${RUNS} consecutive clean.`,
);
console.log('='.repeat(72));
process.exit(ok ? 0 : 1);
