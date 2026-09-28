import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { splitSections, fallbackDigest, firstSentence } from '../../server/link/digest';
import { coerceDigest, buildDigestPrompt } from '../../server/ai/prompts';

/**
 * A page whole and in parts, and "miss nothing" as a property the code holds:
 * every line of the text lands in exactly one section; the model answers one
 * summary per section or the section's own first sentence stands in; the
 * route says 501 where no model can write it.
 */

const WS = 'ws_demo';
let repo: SqliteRepository;
beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
});
afterEach(() => repo.close());

const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe('splitSections', () => {
  const page = [
    '왜 저온 발효인가',
    '반죽을 4도에서 12시간 두면 효모는 느리게, 효소는 계속 일한다. 그래서 풍미가 깊어진다.',
    '온도가 8도를 넘으면 신맛이 지나치게 강해진다.',
    '굽기',
    '오븐은 45분 예열한다. 더치오븐 뚜껑을 20분 덮었다가 연다.',
    ...Array.from({ length: 40 }, (_, i) => `문단 ${i + 1}: ${'크러스트는 수분이 빠지며 얇게 갈라진다. '.repeat(3)}`),
  ].join('\n');

  it('keeps every line of the text, in order, across the sections', () => {
    const sections = splitSections(page);
    expect(sections.length).toBeGreaterThan(1);
    const back = sections.flatMap((s) => [...(s.heading ? [s.heading] : []), s.text]).join('\n');
    expect(words(back)).toEqual(words(page));
  });

  it('uses short lines as headings and never leaves a section over the cap', () => {
    const sections = splitSections(page);
    expect(sections[0]!.heading).toBe('왜 저온 발효인가');
    for (const s of sections) expect(s.text.length).toBeLessThanOrEqual(2_200);
  });

  it('cuts one enormous paragraph at sentence ends rather than dropping any of it', () => {
    const huge = 'A sentence that is long enough to matter. '.repeat(200);
    const sections = splitSections(huge);
    expect(sections.length).toBeGreaterThan(2);
    expect(words(sections.map((s) => s.text).join(' '))).toEqual(words(huge));
  });

  it('is empty for empty text', () => {
    expect(splitSections('   \n  ')).toEqual([]);
  });
});

describe('coerceDigest', () => {
  const sections = [
    { heading: null, text: 'First fact here. Second sentence.' },
    { heading: 'Two', text: 'Another part of the page. More.' },
    { heading: null, text: 'Third part.' },
  ];
  it('fills a skipped or empty section with its own first sentence, one per section, in order', () => {
    const d = coerceDigest({ summary: 'All of it.', sections: [{ summary: 'One.' }, { summary: '' }] }, sections, firstSentence);
    expect(d.summary).toBe('All of it.');
    expect(d.sections.map((s) => s.summary)).toEqual(['One.', 'Another part of the page.', 'Third part.']);
  });
  it('makes a summary from the parts when the model gave none', () => {
    const d = coerceDigest({}, sections, firstSentence);
    expect(d.summary).toContain('First fact here.');
    expect(d.sections).toHaveLength(3);
  });
  it('the prompt numbers every section and demands exactly that many', () => {
    const p = buildDigestPrompt({ title: 'T', sections });
    expect(p).toContain('exactly 3 entries');
    expect(p).toContain('[3]');
  });
  it('fallbackDigest is honest and complete', () => {
    const d = fallbackDigest(sections);
    expect(d.sections).toHaveLength(3);
    expect(d.summary).toContain('Third part.');
  });
});

describe('POST /digest', () => {
  const base = (): Deps => ({
    repo,
    ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
    ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
    reset: () => {},
  });
  const post = (deps: Deps, body: unknown) => handle({ method: 'POST', path: `/api/workspaces/${WS}/digest`, body }, deps);

  it('answers 501 where the model cannot digest, and the capability says so', async () => {
    const deps = base();
    expect((await post(deps, { text: 'x'.repeat(10) })).status).toBe(501);
    const caps = await handle({ method: 'GET', path: '/api/capabilities', body: null }, deps);
    expect((caps.body as { digest: boolean }).digest).toBe(false);
  });

  it('hands back one summary and the sections with their text, where a model can', async () => {
    const provider = Object.assign(new FixtureProvider(), {
      digest: async (input: { sections: { text: string }[] }) => ({
        summary: 'The page, in short.',
        sections: input.sections.map((_, i) => ({ summary: `Part ${i + 1}.` })),
      }),
    });
    const deps: Deps = { ...base(), ingest: new IngestPipeline(repo, provider, new FixtureEmbeddings()) };
    const text = ['Heading', 'A paragraph of the page. '.repeat(30), 'Second heading', 'More words of the page. '.repeat(30)].join('\n');
    const res = await post(deps, { title: 'T', text, locale: 'en' });
    expect(res.status).toBe(200);
    const body = res.body as { summary: string; sections: { heading: string | null; text: string; summary: string }[] };
    expect(body.summary).toBe('The page, in short.');
    expect(body.sections.length).toBeGreaterThanOrEqual(2);
    expect(body.sections[0]).toMatchObject({ heading: 'Heading', summary: 'Part 1.' });
    expect(body.sections[0]!.text).toContain('A paragraph of the page.');
    expect((await post(deps, {})).status).toBe(400);
  });
});
