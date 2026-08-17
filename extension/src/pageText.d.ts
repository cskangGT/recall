/**
 * Hand-written beside the .js, rather than compiling the extension.
 *
 * Chrome loads `extension/src/*.js` directly, and keeping it that way is the
 * same property the server has — `node server/http/main.ts`, no build step. But
 * the tests import these modules, and `tsc --noEmit` follows a declaration file
 * transitively from a test, so the extractor is type-checked by `npm run build`
 * with no tsconfig change and no `allowJs`.
 */

export interface PageText {
  /** `document.title`, then og:title, then the first h1. */
  title: string;
  url: string;
  /** What the user had selected, or '' if nothing. */
  selection: string;
  /** The readable body with navigation chrome removed. */
  text: string;
}

export function extractReadableText(): PageText;
