#!/usr/bin/env node
/**
 * Minimal account registration against the Ashmorrow auth database.
 *
 *   node register.js <username> <password> [email]
 *
 * Demonstrates the only non-obvious part: AzerothCore wants an SRP6
 * salt/verifier pair, not a password hash. See docs/WEBSITE-DB.md.
 */
'use strict';
require('dotenv').config({ path: process.env.ENV_FILE || '../.env' });
const mysql = require('mysql2/promise');
const { makeRegistrationData } = require('../srp6/srp6.js');

const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/;

(async () => {
  const [, , username, password, email = ''] = process.argv;
  if (!username || !password) {
    console.error('usage: node register.js <username> <password> [email]');
    process.exit(2);
  }
  if (!USERNAME_RE.test(username)) {
    console.error('username must be 3-16 chars, letters/digits/underscore/hyphen');
    process.exit(2);
  }

  const { salt, verifier } = makeRegistrationData(username, password);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_AUTH,
  });

  try {
    // username stored UPPERCASE - the client uppercases before authenticating.
    // expansion 2 = Wrath of the Lich King, matching our 3.3.5a client.
    await conn.execute(
      `INSERT INTO account (username, salt, verifier, email, expansion)
       VALUES (UPPER(?), ?, ?, ?, 2)`,
      [username, salt, verifier, email]
    );
    console.log(`registered '${username.toUpperCase()}' - it can now log in to Ashmorrow`);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') console.error('that username is already taken');
    else console.error('registration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
