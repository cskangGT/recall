import { useEffect, useState } from 'react';
import { t, PRODUCT } from '../i18n';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { PageDigest } from '../data/dataSource';
import { KeepLine } from './KeepLine';
import { extractClaims } from '../capture/extractLocal';

/**
 * Something read, before it is kept — a link's page or a file's text.
 *
 * The order the person asked for: see, shape, then keep. The card shows the
 * title and the opening of the text; where a model can, it reads the whole
 * and says what it comes to, then what each part says, as stars to leave on
 * or off with the text a press away; a line of the person's own goes on top;
 * and only then the keep. The same card for a link and for a file, so the
 * two ways in can never feel like two different tools.
 *
 * `onKeep` receives what to keep, assembled: the person's line, the title,
 * then either the gist and the parts left on (in the page's own words) or
 * the description and the text.
 */
export interface ReadCardProps {
  /** Prefix for test ids: `link` or `file`. */
  prefix: string;
  title: string | null;
  description?: string | null;
  excerpt?: string | null;
  text: string | null;
  chars: number;
  /** How much came through, or why not all of it. */
  readLine: string;
  askLine: string;
  keepLabel: string;
  skipLabel: string;
  /** `memories`: the lines the person chose and tidied — stored as they are. Absent: the text goes in and is read as usual. */
  onKeep: (content: string, memories?: string[]) => void;
  onSkip: () => void;
}

/** Below this, a page is short enough to read as it is; no digest is asked for. */
const DIGEST_MIN = 600;

export function ReadCard(p: ReadCardProps) {
  const [digest, setDigest] = useState<
    | { loading: true }
    | { loading: false; failed: true }
    | { loading: false; failed?: false; summary: string; sections: PageDigest['sections']; on: boolean[]; open: boolean[] }
    | null
  >(null);
  const [myLine, setMyLine] = useState('');

  useEffect(() => {
    if (!p.text || p.chars < DIGEST_MIN) {
      setDigest(null);
      return;
    }
    const reader = useWorkspaceStore.getState().source.digest;
    if (!reader) return;
    let live = true;
    setDigest({ loading: true });
    reader(p.title, p.text).then(
      (d) => {
        if (!live) return;
        if (d.sections.length === 0) setDigest(null);
        else setDigest({ loading: false, summary: d.summary, sections: d.sections, on: d.sections.map(() => true), open: d.sections.map(() => false) });
      },
      () => live && setDigest({ loading: false, failed: true }),
    );
    return () => {
      live = false;
    };
    // A new text is a new read; the title alone changing is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.text]);

  const ready = digest && !digest.loading && !digest.failed ? digest : null;
  const parts = ready && ready.sections.length > 1 ? ready : null;
  const picked = parts ? parts.on.filter(Boolean).length : 0;

  /*
   * The second step: what this would become. Mado reads what is left on and
   * says the memories it would keep, as lines — the person turns off, edits,
   * tidies, and what stays goes in exactly so. The text itself can still go
   * in as it is, read the usual way.
   */
  const [memories, setMemories] = useState<{ text: string; on: boolean }[] | null>(null);
  const [pickingMemories, setPickingMemories] = useState(false);
  const [memoriesFailed, setMemoriesFailed] = useState(false);

  const pickMemories = async () => {
    if (pickingMemories) return;
    setPickingMemories(true);
    setMemoriesFailed(false);
    try {
      const content = assembled();
      const source = useWorkspaceStore.getState().source.previewMemories;
      let lines: string[] = [];
      try {
        lines = source ? (await source(content, p.prefix === 'link' ? 'link' : 'text')).lines : extractClaims(content);
      } catch {
        lines = extractClaims(content);
      }
      if (lines.length === 0) setMemoriesFailed(true);
      setMemories(lines.map((text) => ({ text, on: true })));
    } finally {
      setPickingMemories(false);
    }
  };

  const keepMemories = () => {
    const chosen = (memories ?? []).filter((m) => m.on).map((m) => m.text.trim()).filter(Boolean);
    if (chosen.length === 0) return;
    p.onKeep(assembled(), chosen);
  };

  const assembled = () => {
    const out: (string | null | undefined)[] = [];
    const mine = myLine.trim();
    if (mine) out.push(`${t('capture.myLineLead')}${mine}`);
    out.push(p.title);
    if (ready) {
      // The gist first, then only the parts left on — their own words, whole.
      out.push(`${t('capture.summaryLead')}${ready.summary}`);
      ready.sections.forEach((sec, i) => {
        if (ready.on[i]) out.push(sec.heading ? `${sec.heading}\n${sec.text}` : sec.text);
      });
    } else {
      out.push(p.description, p.text ?? p.excerpt);
    }
    return out.filter(Boolean).join('\n\n');
  };

  /** The text as it is, read the usual way. */
  const keep = () => p.onKeep(assembled());

  const chosenCount = (memories ?? []).filter((m) => m.on && m.text.trim()).length;
  if (memories !== null || pickingMemories) {
    return (
      <div className="bar__preview" data-testid={`${p.prefix}-preview`} data-stage="memories">
        <span className="bar__preview-title">{p.title ?? ''}</span>
        <span className="bar__digest-head">{t('capture.memoriesHead')}</span>
        <span className="bar__preview-note">{t('capture.memoriesAside', { product: PRODUCT })}</span>
        {pickingMemories ? (
          <span className="bar__preview-reading" data-testid={`${p.prefix}-memories-picking`}>{t('capture.pickingMemories')}</span>
        ) : memoriesFailed || (memories && memories.length === 0) ? (
          <span className="bar__preview-note" data-testid={`${p.prefix}-memories-none`}>{t('capture.noMemories')}</span>
        ) : (
          <ul className="bar__sections" data-testid={`${p.prefix}-memories`}>
            {(memories ?? []).map((m, i) => (
              <KeepLine
                key={i}
                prefix={`${p.prefix}-mem`}
                index={i}
                text={m.text}
                on={m.on}
                onText={(text) => setMemories((memories ?? []).map((x, j) => (j === i ? { ...x, text } : x)))}
                onToggle={() => setMemories((memories ?? []).map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                onEnter={keepMemories}
              />
            ))}
          </ul>
        )}
        <span className="bar__preview-actions">
          <button
            className="bar__preview-keep"
            data-testid={`${p.prefix}-preview-keep`}
            disabled={pickingMemories || chosenCount === 0}
            autoFocus
            onClick={keepMemories}
          >
            {t('capture.keepMemories', { n: chosenCount })}
          </button>
          <button className="bar__preview-skip" data-testid={`${p.prefix}-preview-raw`} onClick={keep}>
            {t('capture.keepRaw')}
          </button>
          <button className="bar__section-more" data-testid={`${p.prefix}-memories-back`} onClick={() => setMemories(null)}>
            {t('capture.memoriesBack')}
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="bar__preview" data-testid={`${p.prefix}-preview`} data-stage="parts">
      <span className="bar__preview-title">{p.title ?? ''}</span>
      {/* The page's own description, then the opening of what was actually
          read — so the eye can tell an article from a menu before anything is
          kept. Once the whole is summarised, the opening steps aside. */}
      {p.description && <span className="bar__preview-desc">{p.description}</span>}
      {p.excerpt && p.excerpt !== p.description && !ready && (
        <span className="bar__preview-excerpt" data-testid={`${p.prefix}-preview-excerpt`}>
          {p.excerpt}
        </span>
      )}
      {digest && (
        <div className="bar__digest" data-testid={`${p.prefix}-digest`}>
          {digest.loading ? (
            <span className="bar__preview-reading">{t('capture.digesting')}</span>
          ) : digest.failed ? (
            <span className="bar__preview-note">{t('capture.digestFailed')}</span>
          ) : (
            <>
              <span className="bar__digest-head">{t('capture.digestHead')}</span>
              <p className="bar__digest-summary" data-testid={`${p.prefix}-digest-summary`}>
                {digest.summary}
              </p>
              {parts && (
                <>
                  <span className="bar__digest-head">{t('capture.sectionsHead')}</span>
                  <ul className="bar__sections" data-testid={`${p.prefix}-sections`}>
                    {parts.sections.map((sec, i) => (
                      <li key={i} className={`bar__section${parts.on[i] ? '' : ' bar__section--off'}`} data-testid={`${p.prefix}-section-${i}`}>
                        <button
                          className="bar__section-star"
                          data-testid={`${p.prefix}-section-toggle-${i}`}
                          aria-pressed={parts.on[i]}
                          aria-label={parts.on[i] ? t('capture.sectionOff') : t('capture.sectionOn')}
                          onClick={() => setDigest({ ...parts, on: parts.on.map((v, j) => (j === i ? !v : v)) })}
                        >
                          {parts.on[i] ? '★' : '☆'}
                        </button>
                        <span className="bar__section-body">
                          {sec.heading && <span className="bar__section-heading">{sec.heading}</span>}
                          <span className="bar__section-sum">{sec.summary}</span>
                          {parts.open[i] && <p className="bar__section-text">{sec.text}</p>}
                        </span>
                        <button
                          className="bar__section-more"
                          data-testid={`${p.prefix}-section-text-${i}`}
                          onClick={() => setDigest({ ...parts, open: parts.open.map((v, j) => (j === i ? !v : v)) })}
                        >
                          {parts.open[i] ? t('capture.sectionHide') : t('capture.sectionShow')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
      <input
        className="bar__myline"
        data-testid={`${p.prefix}-my-line`}
        placeholder={t('capture.myLine')}
        value={myLine}
        onChange={(e) => setMyLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            keep();
          }
        }}
      />
      <span className="bar__preview-note" data-testid={`${p.prefix}-preview-note`}>
        {p.readLine}
      </span>
      <span className="bar__preview-ask">{p.askLine}</span>
      <span className="bar__preview-actions">
        {p.text ? (
          <>
            <button
              className="bar__preview-keep"
              data-testid={`${p.prefix}-preview-lines`}
              disabled={Boolean(parts && picked === 0) || Boolean(digest && digest.loading)}
              autoFocus
              onClick={() => void pickMemories()}
            >
              {t('capture.pickMemories')}
            </button>
            <button className="bar__preview-skip" data-testid={`${p.prefix}-preview-keep`} disabled={Boolean(parts && picked === 0)} onClick={keep}>
              {parts ? t('capture.linkKeepParts', { n: picked }) : t('capture.keepRaw')}
            </button>
          </>
        ) : (
          <button className="bar__preview-keep" data-testid={`${p.prefix}-preview-keep`} autoFocus onClick={keep}>
            {p.keepLabel}
          </button>
        )}
        <button className="bar__preview-skip" data-testid={`${p.prefix}-preview-skip`} onClick={p.onSkip}>
          {p.skipLabel}
        </button>
      </span>
    </div>
  );
}

/** The line under a read: how much came through, or why not all of it. */
export function readLineFor(input: { chars: number; truncated?: boolean; note?: string | null; redacted?: number }): string {
  if (input.note) return t(`capture.linkNote.${input.note}` as 'capture.linkNote.thin', { product: PRODUCT });
  const n = input.chars.toLocaleString();
  const base = input.truncated ? t('capture.linkReadCut', { n }) : t('capture.linkRead', { n });
  return input.redacted ? `${base} ${t('toast.redacted', { count: input.redacted })}` : base;
}
