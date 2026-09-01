#!/usr/bin/env node
import { randomBytes } from "node:crypto";

/**
 * Print the panel's two secrets. Deliberately does not write to .env.local: a
 * generator that edits files can overwrite a working deployment's keys, and
 * overwriting ADMIN_TOTP_KEY locks every administrator out of the panel.
 *
 * They are separate keys on purpose. Rotating the session secret should sign
 * everyone out - a normal, occasionally useful thing to do. Rotating the TOTP
 * key makes every enrolled authenticator unreadable, which is not.
 */
console.log(`ADMIN_SESSION_SECRET=${randomBytes(48).toString("base64url")}`);
console.log(`ADMIN_TOTP_KEY=${randomBytes(48).toString("base64url")}`);
console.log("");
console.log("Copy both lines into web-admin/.env.local (or your service environment).");
console.log("ADMIN_SESSION_SECRET: changing it signs all staff out. Safe to rotate.");
console.log("ADMIN_TOTP_KEY:       changing it invalidates every enrolled authenticator. Back it up.");
