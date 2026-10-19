import { describe, it, expect } from 'vitest';
import { normalizeEntityName, emailToNames } from '../../server/entities/normalize';

describe('normalizeEntityName', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeEntityName('  Kim   Sujin ')).toBe('kim sujin');
  });

  it('folds compatibility forms (NFKC)', () => {
    // Fullwidth letters and a ligature are the same name to a person.
    expect(normalizeEntityName('Ａｃｍｅ')).toBe('acme');
    expect(normalizeEntityName('ﬁgma')).toBe('figma');
  });

  it('strips surrounding quotes and brackets', () => {
    expect(normalizeEntityName('"Braintrust"')).toBe('braintrust');
    expect(normalizeEntityName('“Braintrust”')).toBe('braintrust');
    expect(normalizeEntityName('[Acme]')).toBe('acme');
    expect(normalizeEntityName('(Acme)')).toBe('acme');
    expect(normalizeEntityName('「아크메」')).toBe('아크메');
  });

  it('drops a trailing parenthetical', () => {
    expect(normalizeEntityName('Kim Sujin (Acme)')).toBe('kim sujin');
    expect(normalizeEntityName('김수진 (아크메)')).toBe('김수진');
    expect(normalizeEntityName('Kim Sujin (Acme) ')).toBe('kim sujin');
  });

  it('keeps a parenthetical that is the whole name or not at the end', () => {
    expect(normalizeEntityName('Anthropic (SDK) team')).toBe('anthropic (sdk) team');
  });

  it('drops a Korean honorific after a space', () => {
    expect(normalizeEntityName('김수진 님')).toBe('김수진');
    expect(normalizeEntityName('김수진 씨')).toBe('김수진');
    expect(normalizeEntityName('김수진 대표')).toBe('김수진');
    expect(normalizeEntityName('김수진 팀장')).toBe('김수진');
    expect(normalizeEntityName('김수진 매니저')).toBe('김수진');
  });

  it('drops an attached 님/씨 only from a name three characters or longer', () => {
    expect(normalizeEntityName('김수진님')).toBe('김수진');
    expect(normalizeEntityName('김수진씨')).toBe('김수진');
    // Two characters could be the whole name.
    expect(normalizeEntityName('수님')).toBe('수님');
    // Attached titles other than 님/씨 stay — 김대표 may be how the name is known.
    expect(normalizeEntityName('김대표')).toBe('김대표');
  });

  it('keeps everything else — no diacritic folding', () => {
    expect(normalizeEntityName('Zoë Müller')).toBe('zoë müller');
    expect(normalizeEntityName('LangChain')).toBe('langchain');
  });

  it('returns an empty string for nothing', () => {
    expect(normalizeEntityName('   ')).toBe('');
    expect(normalizeEntityName('""')).toBe('');
  });
});

describe('emailToNames', () => {
  it('splits local and domain and names the company label', () => {
    expect(emailToNames('sujin.kim@acme.co.kr')).toEqual({
      local: 'sujin.kim', domain: 'acme.co.kr', domainName: 'acme',
    });
    expect(emailToNames('Sujin@Acme.com')).toEqual({
      local: 'sujin', domain: 'acme.com', domainName: 'acme',
    });
    expect(emailToNames('x@mail.acme.io')).toEqual({
      local: 'x', domain: 'mail.acme.io', domainName: 'acme',
    });
  });

  it('names no company for a free-mail provider', () => {
    for (const d of [
      'gmail.com', 'googlemail.com', 'naver.com', 'kakao.com', 'outlook.com',
      'hotmail.com', 'icloud.com', 'yahoo.com', 'yahoo.co.kr',
    ]) {
      expect(emailToNames(`someone@${d}`).domainName).toBeNull();
    }
  });

  it('tolerates something that is not an email', () => {
    expect(emailToNames('not-an-email')).toEqual({ local: 'not-an-email', domain: null, domainName: null });
    expect(emailToNames('')).toEqual({ local: '', domain: null, domainName: null });
  });
});
