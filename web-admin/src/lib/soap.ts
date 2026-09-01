import { env } from "./env";

/**
 * The worldserver's remote console.
 *
 * The panel needs this for exactly one class of thing: changes to a character
 * who is *online*. While a player is in the world the worldserver holds the
 * authoritative copy of their row in memory and writes it back on logout, so an
 * UPDATE underneath it is not merely racy - it is silently discarded, which is
 * the worst possible failure for a support action. SOAP hands the change to the
 * process that owns it.
 *
 * It is optional. Without it the panel refuses online edits and says why,
 * rather than pretending to make them.
 *
 * Requires in worldserver.conf:
 *   SOAP.Enabled = 1
 *   SOAP.IP / SOAP.Port   (default 127.0.0.1:7878 - never expose it publicly)
 *
 * The configured account's GM level bounds everything this can do. Give it the
 * lowest level that covers the commands the panel actually sends; the panel's
 * own permission tiers do not constrain the worldserver.
 */

const NAMESPACE = "urn:AC"; // ACSoap.cpp: the "ns1" prefix at the pinned commit.

export class SoapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoapError";
  }
}

export function soapAvailable(): boolean {
  return env.soap.enabled && Boolean(env.soap.user);
}

/**
 * Command arguments, validated rather than escaped.
 *
 * XML escaping protects the envelope. It does *not* protect the command line
 * the worldserver then parses - a character name containing a space would
 * split into two arguments and turn `.ban character Foo Bar` into something
 * nobody asked for. So every value that reaches a command goes through one of
 * these, and anything that does not match is refused outright.
 *
 * AzerothCore character names are letters only, 2-12 characters
 * (ObjectMgr::CheckPlayerName), so this rejects nothing a real name needs.
 */
export function characterName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-zÀ-ɏ]{2,12}$/.test(name)) {
    throw new SoapError(`${JSON.stringify(value)} is not a usable character name for a console command.`);
  }
  return name;
}

export function accountName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9_.\-]{1,16}$/.test(name)) {
    throw new SoapError(`${JSON.stringify(value)} is not a usable account name for a console command.`);
  }
  return name;
}

export function integerArg(value: number, min: number, max: number): string {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SoapError(`${value} is out of range for a console command (${min}..${max}).`);
  }
  return String(value);
}

/**
 * Free text - a ban reason, an announcement.
 *
 * Newlines are the dangerous character here, not quotes: the console reads one
 * command per line, so an embedded newline is a second command. They are
 * stripped rather than escaped because there is no escape for them.
 */
export function textArg(value: string, maxLength = 255): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Run a console command.
 *
 * Never build the string from raw user input. Every caller in this codebase
 * assembles it from the validators above, and that is the rule, not a style
 * preference: this runs as a GM account on the live realm.
 */
export async function executeCommand(command: string): Promise<string> {
  if (!env.soap.enabled) throw new SoapError("SOAP is disabled (SOAP_ENABLED=0).");
  if (!env.soap.user) throw new SoapError("SOAP_USER is not configured.");
  if (/[\r\n]/.test(command)) throw new SoapError("A console command cannot contain a newline.");

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="${NAMESPACE}">` +
    `<SOAP-ENV:Body><ns1:executeCommand><command>${escapeXml(command)}</command></ns1:executeCommand></SOAP-ENV:Body>` +
    `</SOAP-ENV:Envelope>`;

  const auth = Buffer.from(`${env.soap.user}:${env.soap.password}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.soap.timeoutMs);

  try {
    const response = await fetch(`http://${env.soap.host}:${env.soap.port}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Authorization: `Basic ${auth}`,
        SOAPAction: `${NAMESPACE}#executeCommand`,
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
      throw new SoapError(fault?.trim() || `worldserver returned HTTP ${response.status}`);
    }

    const result = /<result>([\s\S]*?)<\/result>/.exec(text)?.[1];
    if (result === undefined) throw new SoapError("worldserver returned no <result> element.");
    return decodeEntities(result).trim();
  } catch (error) {
    if (error instanceof SoapError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SoapError(`worldserver did not answer within ${env.soap.timeoutMs}ms`);
    }
    throw new SoapError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export interface SoapServerInfo {
  raw: string;
  playersOnline: number | null;
  peak: number | null;
  uptimeText: string | null;
  revision: string | null;
}

export async function serverInfo(): Promise<SoapServerInfo | null> {
  if (!soapAvailable()) return null;
  try {
    const raw = await executeCommand("server info");
    const players = /Connected players:\s*(\d+)/i.exec(raw)?.[1];
    const peak = /Connection peak:\s*(\d+)/i.exec(raw)?.[1];
    const uptime = /Server uptime:\s*(.+)/i.exec(raw)?.[1];
    const revision = /rev\.\s*(\S+)/i.exec(raw)?.[1];
    return {
      raw,
      playersOnline: players ? Number.parseInt(players, 10) : null,
      peak: peak ? Number.parseInt(peak, 10) : null,
      uptimeText: uptime?.trim() ?? null,
      revision: revision ?? null,
    };
  } catch (error) {
    console.warn("[soap] server info failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export interface SoapAttempt {
  attempted: boolean;
  ok: boolean;
  output: string | null;
  error: string | null;
}

/**
 * Try a command and report honestly.
 *
 * Callers use this where SOAP is an improvement rather than a requirement - a
 * kick after a ban, an in-game announcement after a MOTD change. The result is
 * surfaced to the operator: "banned, and the kick failed because SOAP is off"
 * is a useful sentence, and "banned" alone is a misleading one.
 */
export async function trySoap(command: string): Promise<SoapAttempt> {
  if (!soapAvailable()) {
    return { attempted: false, ok: false, output: null, error: "SOAP is not configured." };
  }
  try {
    const output = await executeCommand(command);
    return { attempted: true, ok: true, output, error: null };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      output: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
