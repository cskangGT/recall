import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { redact, stripSecrets, MARK } from '../../server/secrets/redact';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { AskPipeline } from '../../server/pipeline/ask';

/**
 * Secrets never leave the process. Keys, tokens, card and resident numbers
 * are replaced in place; a password line goes whole; and everything that
 * merely looks like a number — an order id, a phone, a date, a price —
 * stays. The pipeline runs it before a row is written or a model reads.
 */
describe('redact', () => {
  it('replaces credential-shaped tokens in place and keeps the sentence', () => {
    const key = 'sk_live_' + 'a'.repeat(24);
    const { text, count } = redact(`the Stripe key is ${key}, put it in the env`);
    expect(count).toBe(1);
    expect(text).toBe(`the Stripe key is ${MARK}, put it in the env`);
  });

  it('knows the common shapes', () => {
    const cases = [
      'sk-proj-' + 'x'.repeat(40),
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_' + 'A'.repeat(36),
      'xoxb-1234567890-abcdefghij',
      'AIza' + 'B'.repeat(35),
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      'api_key = 1234567890abcdefGHIJ',
    ];
    for (const c of cases) {
      const { count } = redact(`before ${c} after`);
      expect(count, c).toBe(1);
    }
  });

  it('drops a password line whole, label and all', () => {
    const { text, count } = redact('login memo\npassword: hunter2\nkeep this');
    expect(count).toBe(1);
    expect(text).toBe('login memo\nkeep this');
    expect(redact('비밀번호 = 1234abcd').count).toBe(1);
  });

  it('a card number goes only when Luhn says it is one; ids, phones, dates and prices stay', () => {
    expect(redact('paid with 4242 4242 4242 4242 today').text).toContain(MARK);
    expect(redact('card 4111-1111-1111-1111').count).toBe(1);
    // Same length, fails Luhn: an order number.
    expect(redact('order 4242 4242 4242 4243').count).toBe(0);
    expect(redact('call 010-1234-5678 or 02-345-6789').count).toBe(0);
    expect(redact('on 2026-09-24 at 14:30, 1,500,000원').count).toBe(0);
    expect(redact('prod_V1f624pSwxhhr1 is the product id').count).toBe(0);
  });

  it('a resident registration number goes, a random 13-digit run does not', () => {
    expect(redact('주민번호 900101-1234567').count).toBe(1);
    expect(redact('주민번호 9001011234567').count).toBe(1);
    // Month 13 — not a date, not a number to hide.
    expect(redact('ref 901301-1234567').count).toBe(0);
  });

  it('a private key block goes whole, even unterminated', () => {
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA\n-----END RSA PRIVATE KEY-----';
    expect(redact(`here:\n${block}\nthen more`).text).toBe(`here:\n${MARK}\nthen more`);
    expect(redact('-----BEGIN PRIVATE KEY-----\nMIIE').text).toBe(MARK);
  });

  it('leaves clean text exactly as it came, and the readers\' line filter still counts', () => {
    const clean = '오늘 아침 루틴을 바꿨다. 운동 20분, 독서 10분.';
    expect(redact(clean)).toEqual({ text: clean, count: 0 });
    const { kept, dropped } = stripSecrets('a\nsk_test_' + 'b'.repeat(24) + '\nc');
    expect(dropped).toBe(1);
    expect(kept).toBe('a\nc');
  });
});

describe('the pipeline runs it first', () => {
  const WS = 'ws_demo';
  let repo: SqliteRepository;
  let deps: Deps;
  beforeEach(() => {
    repo = new SqliteRepository(':memory:');
    repo.migrate();
    importSeed(repo, WS);
    deps = {
      repo,
      ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
      ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
      reset: () => {},
    };
  });
  afterEach(() => repo.close());

  it('the stored original and the response carry the redaction, and the key is nowhere', async () => {
    const key = 'sk_live_' + 'z'.repeat(24);
    const res = await handle(
      { method: 'POST', path: `/api/workspaces/${WS}/capture`, body: { type: 'text', content: `deploy note — key ${key} rotate monthly`, title: `note ${key}` } },
      deps,
    );
    expect(res.status).toBe(200);
    const body = res.body as { redacted: number; sourceId: string };
    expect(body.redacted).toBe(2);
    const source = repo.listSources(WS).find((s) => s.id === body.sourceId)!;
    expect(source.raw_content).not.toContain('sk_live_');
    expect(source.raw_content).toContain(MARK);
    expect(source.title).not.toContain('sk_live_');
    for (const m of repo.listMemories(WS)) expect(m.text).not.toContain('sk_live_');
  });

  it('clean text reports zero', async () => {
    const res = await handle(
      { method: 'POST', path: `/api/workspaces/${WS}/capture`, body: { type: 'text', content: 'a plain note about running' } },
      deps,
    );
    expect((res.body as { redacted: number }).redacted).toBe(0);
  });
});
