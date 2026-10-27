// Reserve -> settle credit flow. All amounts are BigInt micro-credits.
// Every mutation: row-lock wallet, mutate, append ledger entry with an idempotency key.
import { tx } from '../db.js';

export class InsufficientCredits extends Error {
  constructor(need, available) { super('insufficient_credits'); this.code = 'INSUFFICIENT_CREDITS'; this.need = need; this.available = available; }
}

async function lockWallet(conn, userId) {
  const [rows] = await conn.query('SELECT balance_micro, held_micro FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
  if (!rows.length) return { balance: 0n, held: 0n, missing: true };
  return { balance: BigInt(rows[0].balance_micro), held: BigInt(rows[0].held_micro) };
}

async function writeWallet(conn, userId, balance, held) {
  await conn.query(
    'INSERT INTO wallets (user_id, balance_micro, held_micro) VALUES (?,?,?) ON DUPLICATE KEY UPDATE balance_micro=VALUES(balance_micro), held_micro=VALUES(held_micro)',
    [userId, balance.toString(), held.toString()]);
}

async function append(conn, e) {
  // Duplicate idempotency key => ER_DUP_ENTRY => caller treats as "already applied".
  await conn.query(
    `INSERT INTO credit_ledger (user_id, entry_type, amount_micro, balance_after, held_after, ref_type, ref_id, idempotency_key, note)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [e.userId, e.type, e.amount.toString(), e.balance.toString(), e.held.toString(), e.refType, e.refId, e.key, e.note ?? null]);
}

const isDup = (err) => err?.code === 'ER_DUP_ENTRY';

/** Reserve `amount` for a job. Throws InsufficientCredits. */
export async function hold(userId, jobId, amount) {
  if (amount <= 0n) return;
  try {
    await tx(async (c) => {
      const w = await lockWallet(c, userId);
      const available = w.balance - w.held;
      if (available < amount) throw new InsufficientCredits(amount, available);
      const held = w.held + amount;
      await writeWallet(c, userId, w.balance, held);
      await append(c, { userId, type: 'HOLD', amount, balance: w.balance, held, refType: 'job', refId: jobId, key: `job:${jobId}:hold` });
    });
  } catch (e) { if (!isDup(e)) throw e; }
}

/**
 * Release the hold and debit the actual charge in ONE transaction.
 * charge is capped at the hold: if a provider over-runs, we absorb it (and alert), never the user.
 */
export async function settle(userId, jobId, holdAmount, charge) {
  const debit = charge > holdAmount && holdAmount > 0n ? holdAmount : charge;
  try {
    await tx(async (c) => {
      const w = await lockWallet(c, userId);
      let held = w.held, balance = w.balance;
      if (holdAmount > 0n) {
        held = held - holdAmount < 0n ? 0n : held - holdAmount;
        await append(c, { userId, type: 'RELEASE', amount: holdAmount, balance, held, refType: 'job', refId: jobId, key: `job:${jobId}:release` });
      }
      if (debit > 0n) {
        if (balance - held < debit) throw new InsufficientCredits(debit, balance - held); // only possible for BYOK fee
        balance -= debit;
        await append(c, { userId, type: 'DEBIT', amount: -debit, balance, held, refType: 'job', refId: jobId, key: `job:${jobId}:debit` });
      }
      await writeWallet(c, userId, balance, held);
    });
  } catch (e) { if (!isDup(e)) throw e; }
  return debit;
}

/** Credit a verified payment. Idempotent per gateway reference. */
export async function topUp(userId, paymentId, amount, idemKey) {
  try {
    await tx(async (c) => {
      const w = await lockWallet(c, userId);
      const balance = w.balance + amount;
      await writeWallet(c, userId, balance, w.held);
      await append(c, { userId, type: 'TOPUP', amount, balance, held: w.held, refType: 'payment', refId: paymentId, key: idemKey });
      await c.query("UPDATE payments SET status='success', credited_micro=?, verified_at=NOW(3) WHERE id=?", [amount.toString(), paymentId]);
    });
    return true;
  } catch (e) { if (isDup(e)) return false; throw e; }
}
