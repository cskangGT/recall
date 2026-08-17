import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Apple Notes, read where they live.
 *
 * The web app cannot touch Notes — a browser has no business inside another
 * app — but this server runs *on the user's Mac, as the user*, which is the
 * whole point of the local-first shape: "connect Apple Notes" can be a button
 * because the machine pressing it is the machine holding the notes. The first
 * call pops macOS's own automation consent; that is the OS asking, not us.
 *
 * Only ever wired up on darwin (main.ts decides), and injected into the route
 * as a capability — a hosted deployment simply doesn't have it, and answers
 * accordingly.
 */

const execFileAsync = promisify(execFile);

export interface AppleNote {
  title: string;
  content: string;
  modified: Date;
  /**
   * Where the original lives, when the source system has an address — Notion
   * pages do, Apple Notes do not. Carried so "safe to clear at the source"
   * can offer the walk back to the thing being cleared.
   */
  url?: string;
}

export interface NotesReadResult {
  notes: AppleNote[];
  /** Credential-shaped lines removed before anything left the process. */
  droppedSecretLines: number;
  /** Notes in the app, before the window filter. */
  total: number;
}

/*
 * Lines that look like credentials never leave this function.
 *
 * Learned on the very first real import: a note titled "스트라이프" carried a
 * live secret key, which was faithfully extracted into a memory and travelled
 * to the extraction model as prompt content. People keep secrets in notes
 * apps; an importer that forwards notes wholesale is an exfiltration tool
 * with good intentions. (scripts/import-notes.mjs carries the same list —
 * keep them in step.)
 */
export const SECRET_PATTERNS: RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]{8,}/, // Stripe secrets
  /whsec_[A-Za-z0-9]{8,}/, // Stripe webhook secrets
  /sk-[A-Za-z0-9_-]{20,}/, // OpenAI-style keys
  /AKIA[0-9A-Z]{16}/, // AWS access keys
  /gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(password|passwd|비밀번호)\s*[:=]\s*\S+/i,
];

export function stripSecrets(body: string): { kept: string; dropped: number } {
  let dropped = 0;
  const kept = body
    .split('\n')
    .filter((line) => {
      if (SECRET_PATTERNS.some((p) => p.test(line))) {
        dropped++;
        return false;
      }
      return true;
    })
    .join('\n');
  return { kept, dropped };
}

/*
 * One AppleScript pass, one record per note, unit/record separators — control
 * characters no note body can plausibly contain. `plaintext` spares us the
 * HTML `body`.
 */
const SCRIPT = `
set out to ""
tell application "Notes"
  repeat with n in notes
    set out to out & (name of n) & (ASCII character 31) & (modification date of n as «class isot» as string) & (ASCII character 31) & (plaintext of n) & (ASCII character 30)
  end repeat
end tell
return out
`;

export async function readAppleNotes(days: number): Promise<NotesReadResult> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('osascript', ['-e', SCRIPT], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    }));
  } catch (err) {
    const message = String((err as { stderr?: string }).stderr ?? err);
    if (/not allowed|authoriz|1743/i.test(message)) {
      throw new Error(
        'macOS declined access to Notes — allow it under System Settings → Privacy & Security → Automation, then try again',
      );
    }
    throw new Error(`could not read Notes: ${message.trim().slice(0, 200)}`);
  }

  const all = stdout
    .split('')
    .map((record) => record.split(''))
    .filter((fields): fields is [string, string, string] => fields.length === 3)
    .map(([title, modified, body]) => ({
      title: title.trim(),
      modified: new Date(modified.trim()),
      content: body.trim(),
    }))
    .filter((n) => n.content.length > 0);

  const cutoff = Date.now() - days * 864e5;
  const recent = Number.isFinite(days) ? all.filter((n) => n.modified.getTime() >= cutoff) : all;

  let droppedSecretLines = 0;
  const notes = recent
    .map((n) => {
      const { kept, dropped } = stripSecrets(n.content);
      droppedSecretLines += dropped;
      return { ...n, content: kept.length > 20_000 ? kept.slice(0, 20_000) : kept };
    })
    .filter((n) => n.content.trim().length > 0)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());

  return { notes, droppedSecretLines, total: all.length };
}
