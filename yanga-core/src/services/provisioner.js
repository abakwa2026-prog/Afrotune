// Per-app MySQL provisioning. Two adapters:
//  - cpanel : shared hosting (UAPI). Most likely fit for a ServerByt shared account.
//  - direct : VPS/dedicated where we hold a MySQL admin user.
// Names are generated SERVER-SIDE ONLY and regex-checked; user text never reaches DDL.
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { randomSlugId, strongPassword } from '../lib/crypto.js';

const IDENT = /^[a-z0-9_]{1,48}$/;
const PRIVS = 'ALTER,CREATE,DELETE,INDEX,INSERT,SELECT,UPDATE,REFERENCES,LOCK TABLES,CREATE TEMPORARY TABLES';

function names() {
  const id = randomSlugId(8);
  const prefix = config.provisioner.kind === 'cpanel' ? `${config.provisioner.cpanel.user}_` : '';
  const db = `${prefix}app_${id}`;
  const user = `${prefix}u_${id}`.slice(0, 32); // MySQL user name limit
  if (!IDENT.test(db) || !IDENT.test(user)) throw new Error('bad_generated_identifier');
  return { db, user, password: strongPassword() };
}

// ---- cPanel UAPI ----------------------------------------------------------
async function uapi(fn, params) {
  const { host, user, token } = config.provisioner.cpanel;
  const res = await fetch(`${host}/execute/Mysql/${fn}`, {
    method: 'POST', // POST keeps the password out of access logs
    headers: { Authorization: `cpanel ${user}:${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 1) throw Object.assign(new Error(`cpanel_${fn}_failed`), { code: 'PROVISION_FAILED' });
  return data;
}

async function cpanelCreate(n) {
  await uapi('create_database', { name: n.db });
  await uapi('create_user', { name: n.user, password: n.password });
  await uapi('set_privileges_on_database', { user: n.user, database: n.db, privileges: PRIVS });
}

// ---- Direct (admin connection) -------------------------------------------
async function directCreate(n) {
  const admin = await mysql.createConnection({ host: config.db.host, ...config.provisioner.direct });
  try {
    await admin.query(`CREATE DATABASE \`${n.db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`CREATE USER ?@'localhost' IDENTIFIED BY ?`, [n.user, n.password]);
    await admin.query(`GRANT ${PRIVS} ON \`${n.db}\`.* TO ?@'localhost'`, [n.user]);
  } finally { await admin.end(); }
}

/** Create DB + scoped user, then apply the validated schema AS THE SCOPED USER. */
export async function provisionAppDatabase(statements) {
  const n = names();
  await (config.provisioner.kind === 'direct' ? directCreate(n) : cpanelCreate(n));
  if (statements.length) {
    const conn = await mysql.createConnection({
      host: config.db.host, user: n.user, password: n.password, database: n.db, multipleStatements: false,
    });
    try { for (const s of statements) await conn.query(s); }
    finally { await conn.end(); }
  }
  return n; // caller encrypts password before persisting
}
