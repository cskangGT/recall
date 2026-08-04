import { describe, it, expect } from 'vitest';
import {
  MAX_REDIRECTS, checkUrl, isForbiddenAddress, parseHead,
} from '../../server/net/fetchPage';

/**
 * This is the first thing in Recall that takes a URL from a request body and
 * opens a socket with it, on a server that runs from login to shutdown. Most of
 * these tests are about the ways that goes wrong.
 */

describe('addresses this machine must not be pointed at', () => {
  it('refuses loopback', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      expect(isForbiddenAddress(a)).toBe(true);
    }
  });

  it('refuses private space', () => {
    for (const a of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', 'fd00::1', 'fc00::1']) {
      expect(isForbiddenAddress(a)).toBe(true);
    }
  });

  it('refuses link-local, which is where cloud metadata lives', () => {
    // 169.254.169.254 is the one that hands out credentials.
    expect(isForbiddenAddress('169.254.169.254')).toBe(true);
    expect(isForbiddenAddress('fe80::1')).toBe(true);
  });

  it('refuses the edges people forget', () => {
    expect(isForbiddenAddress('0.0.0.0')).toBe(true);
    expect(isForbiddenAddress('100.64.0.1')).toBe(true); // carrier-grade NAT
    expect(isForbiddenAddress('224.0.0.1')).toBe(true);  // multicast
    expect(isForbiddenAddress('not-an-address')).toBe(true);
  });

  it('allows ordinary public addresses', () => {
    for (const a of ['1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isForbiddenAddress(a)).toBe(false);
    }
  });
});

describe('checkUrl', () => {
  it('refuses anything that is not http(s)', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com', 'data:text/html,hi', 'javascript:alert(1)']) {
      expect(await checkUrl(u)).toMatch(/only opens http/);
    }
  });

  it('refuses a literal private address without a DNS round trip', async () => {
    expect(await checkUrl('http://127.0.0.1:5170/api')).toMatch(/your own machine/);
    expect(await checkUrl('http://169.254.169.254/latest/meta-data/')).toMatch(/your own machine/);
    expect(await checkUrl('http://[::1]:5170/')).toMatch(/your own machine/);
  });

  it('refuses a public *name* that resolves to loopback', async () => {
    // The reason this resolves rather than string-matching "localhost":
    // localtest.me and many others are public names pointing at 127.0.0.1.
    expect(await checkUrl('http://localhost:5170/')).toMatch(/your own machine/);
  });

  it('says so when the name does not resolve at all', async () => {
    const said = await checkUrl('https://this-name-does-not-exist.invalid/x');
    expect(said).toMatch(/couldn't find that address/i);
  });

  it('refuses something that is not a URL', async () => {
    expect(await checkUrl('not a url')).toMatch(/doesn't look like an address/);
    expect(await checkUrl('')).toMatch(/doesn't look like an address/);
  });
});

describe('reading the head', () => {
  const base = 'https://example.com/post/1';

  it('prefers Open Graph over the title tag', () => {
    const meta = parseHead(
      `<html><head><title>Site — Page</title>
       <meta property="og:title" content="The Real Title">
       <meta property="og:description" content="What it is about.">
       </head></html>`,
      base,
    );
    expect(meta.title).toBe('The Real Title');
    expect(meta.description).toBe('What it is about.');
  });

  it('falls back to <title>, then to nothing', () => {
    expect(parseHead('<html><head><title>Just A Title</title></head>', base).title)
      .toBe('Just A Title');
    expect(parseHead('<html><head></head><body>hi</body></html>', base).title).toBeNull();
  });

  it('reads attributes in either order and either quote style', () => {
    const a = parseHead(`<meta content="Backwards" property="og:title">`, base);
    const b = parseHead(`<meta property='og:title' content='Single'>`, base);
    expect(a.title).toBe('Backwards');
    expect(b.title).toBe('Single');
  });

  it('resolves a relative image against the page it came from', () => {
    // A hero image is nearly always a path, not an absolute URL.
    const meta = parseHead(`<meta property="og:image" content="/img/hero.png">`, base);
    expect(meta.imageUrl).toBe('https://example.com/img/hero.png');
  });

  it('takes the canonical URL from og:url or rel=canonical', () => {
    expect(parseHead(`<meta property="og:url" content="https://example.com/canonical">`, base).canonicalUrl)
      .toBe('https://example.com/canonical');
    expect(parseHead(`<link rel="canonical" href="/other">`, base).canonicalUrl)
      .toBe('https://example.com/other');
  });

  it('decodes the entities a real page is full of', () => {
    const meta = parseHead(
      `<meta property="og:title" content="Tips &amp; Tricks &#8212; Part 1 &quot;One&quot;">`,
      base,
    );
    expect(meta.title).toBe('Tips & Tricks — Part 1 "One"');
  });

  it('collapses the whitespace a hand-written <title> carries', () => {
    expect(parseHead("<title>\n  Spread\n  Across Lines\n</title>", base).title)
      .toBe('Spread Across Lines');
  });

  it('treats an empty content attribute as absent', () => {
    const meta = parseHead(`<meta property="og:title" content=""><title>Fallback</title>`, base);
    expect(meta.title).toBe('Fallback');
  });

  it('does not throw on a malformed or truncated document', () => {
    // The head is read from a capped stream, so a truncated tag is normal.
    for (const html of ['<html><head><meta property="og:ti', '', '<<<>>>', '<title>']) {
      expect(() => parseHead(html, base)).not.toThrow();
    }
  });

  it('refuses an image URL that is not http — it ends up in an <img src>', () => {
    // og:image is attacker-controlled on any page you save, and both of these
    // resolve happily through `new URL`.
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>']) {
      expect(parseHead(`<meta property="og:image" content="${bad}">`, base).imageUrl).toBeNull();
    }
    expect(parseHead(`<link rel="canonical" href="javascript:alert(1)">`, base).canonicalUrl)
      .toBeNull();
  });
});

describe('redirects', () => {
  it('caps them', () => {
    // The guard runs per hop, so the cap is what stops a redirect loop from
    // being an unbounded number of DNS lookups.
    expect(MAX_REDIRECTS).toBeGreaterThan(0);
    expect(MAX_REDIRECTS).toBeLessThanOrEqual(5);
  });
});
