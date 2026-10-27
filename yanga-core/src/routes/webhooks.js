// Payment webhooks. Signature check -> server-side re-verification -> idempotent credit.
// Never trust the webhook body amount alone.
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { config } from '../config.js';
import { timingSafeEqualStr } from '../lib/crypto.js';
import { topUp } from '../services/credits.js';

export const webhooks = Router();
const raw = express.raw({ type: 'application/json', limit: '100kb' });

async function creditVerified({ gateway, ref, userPublicId, currency, amountMinor }) {
  const fx = config.pay.fx[currency];
  if (!fx) throw new Error(`fx_not_configured_${currency}`);
  const [u] = await pool.query('SELECT id FROM users WHERE public_id=?', [userPublicId]);
  if (!u.length) throw new Error('unknown_user');
  // amountMinor is always major*100 by the time it gets here (normalized per gateway below).
  const credited = (BigInt(amountMinor) * fx) / 100n;
  await pool.query(
    `INSERT INTO payments (user_id,gateway,gateway_ref,currency,amount_minor,fx_micro_per_unit) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [u[0].id, gateway, ref, currency, String(amountMinor), fx.toString()]);
  const [[p]] = await pool.query('SELECT id FROM payments WHERE gateway=? AND gateway_ref=?', [gateway, ref]);
  await topUp(u[0].id, p.id, credited, `${gateway}:${ref}`);
}

// ---- Paystack ---------------------------------------------------------------
webhooks.post('/paystack', raw, async (req, res) => {
  const sig = req.get('x-paystack-signature') || '';
  const expected = crypto.createHmac('sha512', config.pay.paystackSecret).update(req.body).digest('hex');
  if (!config.pay.paystackSecret || !timingSafeEqualStr(sig, expected)) return res.sendStatus(401);
  res.sendStatus(200); // ack fast; gateway retries otherwise
  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    if (evt.event !== 'charge.success') return;
    const ref = encodeURIComponent(String(evt.data?.reference || ''));
    const v = await fetch(`https://api.paystack.co/transaction/verify/${ref}`, {
      headers: { Authorization: `Bearer ${config.pay.paystackSecret}` }, signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
    if (!v.status || v.data?.status !== 'success') return;
    await creditVerified({ gateway: 'paystack', ref: v.data.reference, userPublicId: v.data.metadata?.user_id,
      currency: v.data.currency, amountMinor: v.data.amount });
  } catch (e) { console.error('paystack_webhook', e.message); }
});

// ---- Flutterwave (covers Cameroon XAF MoMo) -----------------------------------
webhooks.post('/flutterwave', raw, async (req, res) => {
  if (!config.pay.flwHash || !timingSafeEqualStr(req.get('verif-hash') || '', config.pay.flwHash)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    const id = Number(evt.data?.id);
    if (!Number.isSafeInteger(id)) return;
    const v = await fetch(`https://api.flutterwave.com/v3/transactions/${id}/verify`, {
      headers: { Authorization: `Bearer ${config.pay.flwSecret}` }, signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
    if (v.status !== 'success' || v.data?.status !== 'successful') return;
    // Flutterwave reports major units; convert to minor for a single code path.
    await creditVerified({ gateway: 'flutterwave', ref: v.data.tx_ref, userPublicId: v.data.meta?.user_id,
      currency: v.data.currency, amountMinor: Math.round(Number(v.data.amount) * 100) });
  } catch (e) { console.error('flutterwave_webhook', e.message); }
});
