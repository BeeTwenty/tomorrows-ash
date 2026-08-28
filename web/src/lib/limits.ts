/**
 * Account limits and text handling that both the server and the browser need.
 *
 * This module deliberately imports nothing. The form components are Client
 * Components, so anything they touch ends up in the browser bundle - and the
 * SRP6 module next door imports `node:crypto`, which cannot go there. Keeping
 * the shared constants here is what stops a validation import from dragging
 * cryptography into the client.
 */

/** AccountMgr.h: MAX_ACCOUNT_STR / MAX_PASS_STR at the pinned upstream commit. */
export const MAX_USERNAME_LENGTH = 17;
export const MAX_PASSWORD_LENGTH = 16;

/**
 * AzerothCore's `Utf8ToUpperOnlyLatin` uppercases *only* basic-latin letters
 * and leaves everything else untouched. JavaScript's `toUpperCase()` does far
 * more than that (it maps 'ß' to 'SS' and uppercases Cyrillic and Greek), which
 * would produce a different hash from the server's for such passwords.
 */
export function upperLatin(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x61 && code <= 0x7a ? String.fromCharCode(code - 32) : ch;
  }
  return out;
}
