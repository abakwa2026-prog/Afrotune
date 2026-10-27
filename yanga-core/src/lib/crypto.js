import crypto from 'node:crypto';
import { config } from '../config.js';

/** AES-256-GCM. Returns {ct, iv, tag} Buffers. AAD binds ciphertext to its owner/purpose. */
export function seal(plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', config.masterKey, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { ct, iv, tag: c.getAuthTag() };
}

export function open({ ct, iv, tag }, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', config.masterKey, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

export function timingSafeEqualStr(a, b) {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/** Lowercase base32-ish random id, safe for DB/repo names. */
export function randomSlugId(len = 8) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function strongPassword() {
  return crypto.randomBytes(24).toString('base64url'); // 32 chars, no quotes/escapes
}
