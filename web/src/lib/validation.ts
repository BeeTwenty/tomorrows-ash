import { MAX_PASSWORD_LENGTH, upperLatin } from "./limits";

/**
 * Input rules for account forms.
 *
 * These are deliberately *stricter* than AzerothCore's own limits
 * (`MAX_ACCOUNT_STR` 17, `MAX_PASS_STR` 16, `MAX_EMAIL_STR` 255). A web form
 * that lets someone create an account the game client cannot type into is
 * worse than a web form that says no.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = MAX_PASSWORD_LENGTH;
export const EMAIL_MAX = 255;

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
/** Printable ASCII only - the 3.3.5a login box cannot reliably send anything else. */
const PASSWORD_PATTERN = /^[\x20-\x7E]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateUsername(raw: unknown): Validated<string> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "Choose an account name." };
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return { ok: false, error: `Account names are ${USERNAME_MIN}-${USERNAME_MAX} characters.` };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { ok: false, error: "Account names use letters, numbers and underscores only." };
  }
  // The realm stores and compares account names uppercased.
  return { ok: true, value: upperLatin(value) };
}

export function validatePassword(raw: unknown, username?: string): Validated<string> {
  const value = typeof raw === "string" ? raw : "";
  if (!value) return { ok: false, error: "Choose a password." };
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return {
      ok: false,
      error: `Passwords are ${PASSWORD_MIN}-${PASSWORD_MAX} characters. The game client cannot send more than ${PASSWORD_MAX}.`,
    };
  }
  if (!PASSWORD_PATTERN.test(value)) {
    return { ok: false, error: "Passwords may only contain standard keyboard characters." };
  }
  if (username && upperLatin(value) === upperLatin(username)) {
    return { ok: false, error: "Your password cannot be your account name." };
  }
  return { ok: true, value };
}

export function validateEmail(raw: unknown, { required = true } = {}): Validated<string> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return required
      ? { ok: false, error: "An email address is required so you can reset your password." }
      : { ok: true, value: "" };
  }
  if (value.length > EMAIL_MAX) return { ok: false, error: "That email address is too long." };
  if (!EMAIL_PATTERN.test(value)) return { ok: false, error: "That does not look like an email address." };
  // AccountMgr::CreateAccount runs the email through Utf8ToUpperOnlyLatin, so
  // an account made here is byte-identical to one made with `account create`.
  return { ok: true, value: upperLatin(value) };
}

/** Character names: 2-12 letters, as enforced by the client and `characters.name`. */
export function validateCharacterName(raw: unknown): Validated<string> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 2 || value.length > 12) {
    return { ok: false, error: "Character names are 2-12 characters." };
  }
  if (!/^[A-Za-zÀ-ÿ]+$/.test(value)) {
    return { ok: false, error: "Character names are letters only." };
  }
  return { ok: true, value };
}
