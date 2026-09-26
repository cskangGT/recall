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
 * Lines that look like credentials never leave this function — see
 * server/secrets/redact.ts, the one list every reader and every capture
 * shares. Re-exported here because scripts/import-notes.mjs and
 * import-instagram.mjs import it from this module.
 */
import { stripSecrets } from '../secrets/redact.ts';
export { stripSecrets };
export { TOKEN_PATTERNS as SECRET_PATTERNS } from '../secrets/redact.ts';

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
