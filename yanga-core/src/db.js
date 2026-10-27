import mysql from 'mysql2/promise';
import { config } from './config.js';

// Small pool: shared hosting caps concurrent MySQL connections per account.
export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 8,
  supportBigNumbers: true,
  bigNumberStrings: true,   // BIGINTs come back as strings -> convert with BigInt()
  dateStrings: true,
  multipleStatements: false, // never on the platform pool
  timezone: 'Z',
});

/** Run fn inside a transaction; always releases the connection. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}
