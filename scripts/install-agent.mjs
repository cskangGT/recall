import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  DB, ENV_FILE, HOME, LABEL, LOG_DIR, LOG_ERR, LOG_OUT, PLIST, PORT, ROOT, STATIC,
  probe,
} from './recall-paths.mjs';

/**
 * Recall, from login to shutdown. `npm run agent:install`.
 *
 * `npm start` is a foreground process in a terminal. Close the window or reboot
 * and Recall is gone — which is fine for a thing you open on purpose, and fatal
 * for a thing you reach for with a keystroke. A capture that fails because the
 * server happens not to be running is worse than no shortcut at all, because you
 * only find out later that the thing you meant to remember was never saved.
 *
 * So: a LaunchAgent. Starts at login, restarts if it dies.
 *
 * This script never reads the value of a key. It copies the file and reports
 * the *names* it found, because a secret you print while debugging is a secret
 * you have leaked.
 */

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const UNINSTALL = args.has('--uninstall');
const RESTART = args.has('--restart');

const uid = process.getuid();
const target = `gui/${uid}/${LABEL}`;

/** Never with `shell: true` — nothing here should be able to reach a history file. */
const run = (cmd, argv, opts = {}) =>
  spawnSync(cmd, argv, { encoding: 'utf8', stdio: 'pipe', ...opts });

// ---------------------------------------------------------------- uninstall

if (UNINSTALL) {
  const out = run('launchctl', ['bootout', target]);
  if (existsSync(PLIST)) rmSync(PLIST);
  console.log(
    out.status === 0
      ? `stopped and removed ${LABEL}`
      : `${LABEL} was not loaded; removed the plist if there was one`,
  );
  console.log(`\nyour memories are untouched, in ${DB}`);
  process.exit(0);
}

if (RESTART) {
  const out = run('launchctl', ['kickstart', '-k', target]);
  if (out.status !== 0) {
    console.error(out.stderr.trim() || `could not restart ${LABEL} — is it installed?`);
    process.exit(1);
  }
  console.log(`restarted ${LABEL}`);
  process.exit(0);
}

// ------------------------------------------------------------------ node

/**
 * launchd runs with a minimal PATH, so `node` has to be an absolute path — and
 * the obvious way to get one is wrong.
 *
 * `process.execPath` resolves symlinks. On a Homebrew install that yields
 * /opt/homebrew/Cellar/node/24.x.y/bin/node, which stops existing at the next
 * `brew upgrade` and takes Recall with it. The symlink in /opt/homebrew/bin is
 * the thing Homebrew maintains across upgrades, so prefer it when it is real
 * and new enough.
 */
function resolveNode() {
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (!existsSync(candidate)) continue;
    const out = run(candidate, ['--version']);
    const major = Number(/^v(\d+)/.exec(out.stdout?.trim() ?? '')?.[1]);
    if (out.status === 0 && major >= 22) return candidate;
  }
  return process.execPath;
}

const NODE = resolveNode();
const unstable = NODE.includes('/Cellar/') || NODE.includes('/.nvm/');

/*
 * Two places the agent cannot live, both of which fail in ways you would never
 * guess from the symptom.
 *
 * **A TCC-protected folder.** Desktop, Documents, Downloads and iCloud Drive
 * are gated by macOS privacy controls. An app gets a consent dialog; a launchd
 * agent has no UI, so there is no dialog and no denial — the process starts,
 * blocks inside the very first `open()` (Node walking up the tree looking for
 * package.json), and sits there forever. `launchctl print` reports
 * `state = running`, the log files are empty, and nothing is listening. Every
 * signal says it is fine.
 *
 * Measured, not assumed: a trivial LaunchAgent running one line of Node from
 * ~/Desktop produced nothing at all, and the identical job from outside it ran
 * immediately.
 *
 * Granting Full Disk Access to `node` would "fix" it, and would hand that
 * access to every script anyone ever runs with the same interpreter. Move the
 * checkout instead.
 *
 * **A git worktree.** The plist hard-codes an absolute path, and a worktree
 * disappears when its branch merges. Under KeepAlive that is not a clean
 * failure but a permanent one: launchd restarting a program that is not there,
 * six times a minute, until somebody notices.
 */
const PROTECTED = ['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents']
  .map((d) => path.join(process.env.HOME ?? '', d));
const inProtected = PROTECTED.find((dir) => ROOT === dir || ROOT.startsWith(dir + path.sep));

if (inProtected) {
  console.error(
    `Recall cannot run as a background agent from here:\n  ${ROOT}\n\n` +
      `${inProtected} is protected by macOS privacy controls. A LaunchAgent has\n` +
      `no way to ask for consent, so it does not fail — it starts and hangs, with\n` +
      `empty logs and "state = running". You would have no way to tell.\n\n` +
      `Move the checkout somewhere unprotected and re-run:\n` +
      `  mv "${ROOT}" ~/code/recall\n` +
      `  cd ~/code/recall && npm run agent:install\n\n` +
      `Your memories are not in the checkout — they stay in ${DB}.`,
  );
  process.exit(1);
}

if (ROOT.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`) &&
    process.env.RECALL_ALLOW_WORKTREE !== '1') {
  console.error(
    `refusing to install from a git worktree:\n  ${ROOT}\n\n` +
      `This path disappears when the branch merges, and launchd would spend\n` +
      `forever restarting a program that is not there. Run this from your main\n` +
      `checkout. (RECALL_ALLOW_WORKTREE=1 overrides, for testing this script.)`,
  );
  process.exit(1);
}

// ------------------------------------------------------------------ plist

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>

  <!--
    main.ts directly, not \`npm start\`. start.mjs rebuilds the client on every
    run and spawns npm, which needs a PATH launchd does not have — and under
    KeepAlive a crash loop would become a build loop. The installer builds dist
    once instead.
  -->
  <key>ProgramArguments</key>
  <array>
    <string>${escape(NODE)}</string>
    <string>--env-file-if-exists=${escape(ENV_FILE)}</string>
    <string>${escape(path.join(ROOT, 'server/http/main.ts'))}</string>
  </array>

  <key>WorkingDirectory</key><string>${escape(ROOT)}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <!-- No secrets here: the value comes back out of \`launchctl print\`, and
         this file is the first thing you cat when something is wrong. The keys
         live in ${escape(ENV_FILE)}, mode 0600. -->
    <key>RECALL_DB</key><string>${escape(DB)}</string>
    <key>RECALL_STATIC</key><string>${escape(STATIC)}</string>
    <key>PORT</key><string>${PORT}</string>
    <key>RECALL_HOST</key><string>127.0.0.1</string>
  </dict>

  <key>RunAtLoad</key><true/>

  <!--
    Plain true rather than {SuccessfulExit: false}, because a clean exit is
    still an exit and "always up" is what this is for. The cost: main.ts's
    refuse-to-bind path exits 1, and launchd has no expression for "do not
    restart on this code" — so that would crash-loop. ThrottleInterval caps it
    at six restarts a minute, and the reason is one line at the top of
    server.err.log.
  -->
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>

  <key>StandardOutPath</key><string>${escape(LOG_OUT)}</string>
  <key>StandardErrorPath</key><string>${escape(LOG_ERR)}</string>
</dict>
</plist>
`;

if (DRY) {
  console.log(plist);
  process.exit(0);
}

// ------------------------------------------------------------------ install

console.log(`node:  ${NODE}`);
if (unstable) {
  console.warn(
    '  ⚠  that path is version-specific (Homebrew Cellar or nvm). It will stop\n' +
      '     existing at your next Node upgrade, and Recall will stop with it.\n' +
      '     Re-run `npm run agent:install` after upgrading Node.',
  );
}

mkdirSync(HOME, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });  // launchd will not create this itself,
                                          // and the job just fails to start.

// ---- the keys

const localEnv = path.join(ROOT, '.env.local');
if (!existsSync(ENV_FILE) && existsSync(localEnv)) {
  copyFileSync(localEnv, ENV_FILE);
  chmodSync(ENV_FILE, 0o600);
  // Left-hand sides only. This script must never be able to print a key.
  const names = readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)=/.exec(line.trim())?.[1])
    .filter(Boolean);
  console.log(`keys:  copied ${names.join(', ')} to ${ENV_FILE} (0600)`);
} else if (existsSync(ENV_FILE)) {
  console.log(`keys:  ${ENV_FILE} already there, left alone`);
} else {
  console.warn(
    `keys:  none found.\n` +
      `  ⚠  --env-file-if-exists does not fail when the file is missing, so the\n` +
      `     agent will start and run on the fixture provider — every capture\n` +
      `     returns scripted demo output that looks entirely plausible. Put your\n` +
      `     keys in ${ENV_FILE} and re-run. The startup line in\n` +
      `     ${LOG_OUT} says which provider it actually chose.`,
  );
}

// ---- the client

console.log('build: compiling the client…');
const build = run('npm', ['run', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_DEFAULT: '1' },
});
if (build.status !== 0) process.exit(build.status ?? 1);

// ---- the job

mkdirSync(path.dirname(PLIST), { recursive: true });
writeFileSync(PLIST, plist);

// bootstrap fails with "5: Input/output error" if the label is already loaded,
// so always bootout first — and ignore its failure, which is the normal
// first-install case.
run('launchctl', ['bootout', target]);
const boot = run('launchctl', ['bootstrap', `gui/${uid}`, PLIST]);
if (boot.status !== 0) {
  console.error(`\ncould not load the agent:\n${boot.stderr.trim()}`);
  process.exit(1);
}

// ---- did it actually come up?

const deadline = Date.now() + 12_000;
let state = 'free';
while (Date.now() < deadline) {
  state = await probe(PORT);
  if (state === 'recall') break;
  await new Promise((r) => setTimeout(r, 400));
}

if (state === 'recall') {
  console.log(`\nRecall is up at http://127.0.0.1:${PORT} and will be after you log back in.`);
  console.log(`  memories  ${DB}`);
  console.log(`  logs      ${LOG_OUT}`);
  console.log(`  stop      npm run agent:uninstall`);
} else {
  console.error(`\nthe agent loaded but nothing answered on ${PORT}. Last lines of the log:\n`);
  const tail = existsSync(LOG_ERR) ? readFileSync(LOG_ERR, 'utf8').split('\n').slice(-15) : [];
  console.error(tail.join('\n') || '(the error log is empty)');
  console.error(
    `\nOn macOS 13+, check System Settings → General → Login Items →\n` +
      `"Allow in the Background". A LaunchAgent turned off there never runs and\n` +
      `says nothing about it. Then: launchctl print ${target}`,
  );
  process.exit(1);
}
