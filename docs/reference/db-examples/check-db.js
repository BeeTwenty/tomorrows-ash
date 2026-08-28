#!/usr/bin/env node
/**
 * Connectivity smoke test. Run this first - it tells you whether your .env is
 * right before you start writing application code.
 *
 *   npm install && node check-db.js
 */
'use strict';
require('dotenv').config({ path: process.env.ENV_FILE || '../.env' });
const mysql = require('mysql2/promise');

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`missing ${k} in .env`); process.exit(2); }
  return v;
};

(async () => {
  const conn = await mysql.createConnection({
    host: need('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: need('DB_USER'),
    password: need('DB_PASSWORD'),
  }).catch((e) => { console.error('connection failed:', e.message); process.exit(1); });

  console.log('connected to MySQL\n');

  const checks = [
    ['realm',            `SELECT name, address, port FROM \`${need('DB_AUTH')}\`.realmlist WHERE id = ${process.env.REALM_ID || 1}`],
    ['accounts',         `SELECT COUNT(*) AS n FROM \`${need('DB_AUTH')}\`.account`],
    ['characters',       `SELECT COUNT(*) AS n FROM \`${need('DB_CHARACTERS')}\`.characters`],
    ['online now',       `SELECT COUNT(*) AS n FROM \`${need('DB_CHARACTERS')}\`.characters WHERE online = 1`],
    ['world items',      `SELECT COUNT(*) AS n FROM \`${need('DB_WORLD')}\`.item_template`],
  ];

  for (const [label, sql] of checks) {
    try {
      const [rows] = await conn.query(sql);
      console.log(`  OK   ${label.padEnd(14)}`, JSON.stringify(rows[0]));
    } catch (e) {
      console.log(`  FAIL ${label.padEnd(14)} ${e.message}`);
    }
  }

  // The website must NOT be able to do these. Failures here are correct.
  console.log('\nprivilege boundaries (failures below are the desired outcome):');
  for (const [label, sql] of [
    ['delete account',  `DELETE FROM \`${need('DB_AUTH')}\`.account WHERE id = 0`],
    ['read GM levels',  `SELECT * FROM \`${need('DB_AUTH')}\`.account_access LIMIT 1`],
  ]) {
    try {
      await conn.query(sql);
      console.log(`  !!   ${label.padEnd(14)} SUCCEEDED - grants are too wide, review sql/website/`);
    } catch (e) {
      console.log(`  OK   ${label.padEnd(14)} correctly denied`);
    }
  }

  await conn.end();
})();
