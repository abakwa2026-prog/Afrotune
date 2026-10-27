import { pool } from '../db.js';
import { sha256 } from '../lib/crypto.js';

/** Bearer API token -> req.user. Tokens are stored only as SHA-256 hashes. */
export async function auth(req, res, next) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.get('authorization') || '');
  if (!m) return res.status(401).json({ error: 'unauthorized' });
  const [rows] = await pool.query(
    `SELECT u.id, u.public_id, u.billing_mode, u.country_iso2, u.locale, u.status, t.id AS token_id
       FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL LIMIT 1`, [sha256(m[1])]);
  const u = rows[0];
  if (!u || u.status !== 'active') return res.status(401).json({ error: 'unauthorized' });
  pool.query('UPDATE api_tokens SET last_used_at=NOW(3) WHERE id=?', [u.token_id]).catch(() => {});
  req.user = u;
  next();
}
