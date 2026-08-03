import { CAPTURE_URL, ENDPOINT_ORIGIN } from './config.js';
import { extractReadableText } from './pageText.js';
import { buildCaptureRequest, describeResult, skipReason } from './captureRequest.js';

/**
 * The glue. Deliberately thin, because none of it is testable.
 *
 * Every decision — what to send, whether to send it, what to say afterwards —
 * lives in `captureRequest.js` and `pageText.js`, which are pure and covered.
 * What is left here is the command listener, the injection, the fetch, and the
 * notification: four things that only a browser can run.
 */

const ICON = 'icons/icon-128.png';

function notify(title, message) {
  // `type: 'basic'` requires an iconUrl, which is why there is a PNG committed
  // in a repository that otherwise has none.
  chrome.notifications.create({ type: 'basic', iconUrl: ICON, title, message });
}

/**
 * MV3 tears down an idle service worker, and a `fetch` nobody is awaiting is
 * not a reason to keep it alive — so fire-and-forget here is not "fast", it is
 * a capture that sometimes dies mid-flight, nondeterministically and silently.
 * We await. And since a capture runs several seconds against a real model, each
 * of these calls resets the idle timer while we do.
 */
function keepAlive() {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => clearInterval(timer);
}

async function save(tab) {
  if (!tab?.id || !tab.url) return;

  const skip = skipReason(tab.url, ENDPOINT_ORIGIN);
  if (skip) {
    notify('Not saved', skip);
    return;
  }

  // The badge, immediately. This is what makes the keypress feel acknowledged;
  // a notification here would only have to be corrected a few seconds later.
  await chrome.action.setBadgeText({ text: '…' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6c5ce7' });
  const stop = keepAlive();

  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractReadableText,
    });
    if (!injected?.result) {
      notify('Not saved', "Recall couldn't read that page.");
      return;
    }

    const { body, skip: tooShort } = buildCaptureRequest(injected.result);
    if (tooShort) {
      notify('Not saved', tooShort);
      return;
    }

    const res = await fetch(CAPTURE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      notify('Not saved', detail.error ?? `Recall answered ${res.status}.`);
      return;
    }

    const { title, message } = describeResult(await res.json());
    notify(title, message);
  } catch (err) {
    /*
     * Almost always one thing: Recall is not running. Say that rather than
     * "Failed to fetch", because the fix is a command and the user is the only
     * one who can run it.
     */
    notify(
      'Recall is not running',
      `Nothing was saved. Start it with \`npm run agent:install\`, or open ${ENDPOINT_ORIGIN}. (${err.message})`,
    );
  } finally {
    stop();
    await chrome.action.setBadgeText({ text: '' });
  }
}

const currentTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-page') await save(await currentTab());
});

// The same thing from the toolbar. Free, and it is how anyone discovers the
// extension exists before they learn the shortcut.
chrome.action.onClicked.addListener((tab) => void save(tab));
