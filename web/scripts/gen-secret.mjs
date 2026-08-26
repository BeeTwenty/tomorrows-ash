#!/usr/bin/env node
import { randomBytes } from "node:crypto";

/**
 * Print a session secret. Deliberately does not write to .env.local: a
 * generator that edits files can overwrite a working deployment's secret and
 * sign every player out.
 */
const secret = randomBytes(48).toString("base64url");

console.log(`SESSION_SECRET=${secret}`);
console.log("");
console.log("Copy that line into web/.env.local (or your service environment).");
console.log("Changing it later signs everyone out; it never needs to be shared.");
