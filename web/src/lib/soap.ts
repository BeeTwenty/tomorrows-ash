import { env } from "./env";

/**
 * Optional SOAP client for the worldserver's remote console.
 *
 * The site does not need this: account creation writes SRP6 directly to the
 * auth database (ACCOUNT_WRITE_MODE=sql) and realm status is assembled from
 * the database plus TCP probes. SOAP adds one thing nothing else can give -
 * the running server's own answer to `server info` - and costs an open port
 * plus a GM account's credentials in the web service's environment.
 *
 * So it is off by default, and every caller must cope with it being absent.
 *
 * Requires in worldserver.conf:
 *   SOAP.Enabled = 1
 *   SOAP.IP / SOAP.Port   (default 127.0.0.1:7878 - never expose it publicly)
 */

const NAMESPACE = "urn:AC"; // ACSoap.cpp: the "ns1" prefix at the pinned commit.

export class SoapError extends Error {}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Run a console command on the worldserver.
 *
 * Commands are GM commands: whatever the configured account is allowed to do,
 * this can do. Never build one out of user input - every caller in this
 * codebase passes a fixed string.
 */
export async function executeCommand(command: string): Promise<string> {
  if (!env.soap.enabled) throw new SoapError("SOAP is disabled (SOAP_ENABLED=0).");
  if (!env.soap.user) throw new SoapError("SOAP_USER is not configured.");

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
      // Fault bodies carry the reason; the status alone is not enough to debug.
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

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface SoapServerInfo {
  raw: string;
  playersOnline: number | null;
  maxPlayers: number | null;
  uptimeText: string | null;
  revision: string | null;
}

/**
 * `server info` output looks roughly like:
 *   AzerothCore rev. 1a2b3c4d ...
 *   Connected players: 12. Characters in world: 11.
 *   Connection peak: 40.
 *   Server uptime: 2 Day(s) 3 Hour(s) 4 Minute(s)
 * The shape varies between builds, so every field is optional.
 */
export async function serverInfo(): Promise<SoapServerInfo | null> {
  try {
    const raw = await executeCommand("server info");
    const players = /Connected players:\s*(\d+)/i.exec(raw)?.[1];
    const peak = /Connection peak:\s*(\d+)/i.exec(raw)?.[1];
    const uptime = /Server uptime:\s*(.+)/i.exec(raw)?.[1];
    const revision = /rev\.\s*(\S+)/i.exec(raw)?.[1];
    return {
      raw,
      playersOnline: players ? Number.parseInt(players, 10) : null,
      maxPlayers: peak ? Number.parseInt(peak, 10) : null,
      uptimeText: uptime?.trim() ?? null,
      revision: revision ?? null,
    };
  } catch (error) {
    console.warn("[soap] server info failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
