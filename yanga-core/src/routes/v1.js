import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ulid } from 'ulid';
import { pool } from '../db.js';
import { auth } from '../middleware/auth.js';
import { sanitizePrompt, toSlug } from '../lib/sanitize.js';
import { seal, sha256 } from '../lib/crypto.js';
import { admitJob, runJob, enqueue, queueDepth } from '../services/pipeline.js';

export const v1 = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const perUser = rateLimit({ windowMs: 60_000, limit: 5, keyGenerator: (req) => req.user.public_id, standardHeaders: 'draft-7', legacyHeaders: false });

// ---- POST /v1/generate -----------------------------------------------------
const GenerateBody = z.object({
  prompt: z.string().min(20).max(6000),
  app_name: z.string().max(60).optional(),
  provider: z.enum(['openai', 'deepseek']).optional(), // BYOK preference only
}).strict();

v1.post('/generate', auth, perUser, wrap(async (req, res) => {
  const body = GenerateBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body', issues: body.error.issues.map((i) => i.path.join('.')) });
  if (queueDepth() > 50) return res.status(503).set('Retry-After', '30').json({ error: 'busy' });

  const prompt = sanitizePrompt(body.data.prompt);
  if (prompt.length < 20) return res.status(400).json({ error: 'prompt_too_short' });

  const job = { public_id: ulid(), prompt, app_slug: toSlug(body.data.app_name || prompt.split(/\s+/).slice(0, 4).join(' ')) };
  const [ins] = await pool.query(
    'INSERT INTO generation_jobs (public_id,user_id,billing_route,app_slug,prompt_sha256,prompt_text) VALUES (?,?,?,?,?,?)',
    [job.public_id, req.user.id, req.user.billing_mode, job.app_slug, sha256(prompt), prompt]);
  job.id = ins.insertId;

  let admitted;
  try {
    admitted = await admitJob(req.user, job, body.data.provider);
  } catch (e) {
    await pool.query("UPDATE generation_jobs SET status='failed', error_code=? WHERE id=?", [e.code || 'ADMIT_FAILED', job.id]);
    const map = { INSUFFICIENT_CREDITS: 402, NO_BYOK_KEY: 402, RATE_NOT_CONFIGURED: 503, NO_RATE: 503 };
    if (map[e.code]) return res.status(map[e.code]).json({ error: e.code.toLowerCase(), job_id: job.public_id });
    throw e;
  }
  enqueue(() => runJob(req.user, job, admitted));
  res.status(202).json({ job_id: job.public_id, status: 'queued', poll: `/v1/jobs/${job.public_id}` });
}));

// ---- GET /v1/jobs/:id --------------------------------------------------------
v1.get('/jobs/:id', auth, wrap(async (req, res) => {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(req.params.id)) return res.status(404).end();
  const [rows] = await pool.query(
    `SELECT j.id, j.public_id, j.status, j.billing_route, j.charged_micro, j.error_code, j.created_at, j.updated_at
       FROM generation_jobs j WHERE j.public_id=? AND j.user_id=?`, [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const [res2] = await pool.query("SELECT kind, identifier FROM provisioned_resources WHERE job_id=? AND status='active'", [rows[0].id]);
  const { id, ...job } = rows[0];
  res.json({
    ...job,
    repo: res2.find((r) => r.kind === 'github_repo')?.identifier ?? null,
    database: res2.find((r) => r.kind === 'mysql_db')?.identifier.split('|')[0] ?? null,
  });
}));

// ---- PUT /v1/keys/:provider  (BYOK) -----------------------------------------
const KEY_RE = { openai: /^sk-[A-Za-z0-9_-]{20,200}$/, deepseek: /^sk-[A-Za-z0-9]{20,100}$/ };
const VERIFY = { openai: 'https://api.openai.com/v1/models', deepseek: 'https://api.deepseek.com/models' };

v1.put('/keys/:provider', auth, perUser, wrap(async (req, res) => {
  const provider = req.params.provider;
  const key = String(req.body?.api_key || '').trim();
  if (!KEY_RE[provider]?.test(key)) return res.status(400).json({ error: 'invalid_key_format' });
  const probe = await fetch(VERIFY[provider], { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!probe?.ok) return res.status(400).json({ error: 'key_rejected_by_provider' });

  const s = seal(key, `byok:${req.user.id}:${provider}`);
  await pool.query(
    `INSERT INTO byok_keys (user_id,provider,key_ciphertext,key_iv,key_tag,key_last4,status) VALUES (?,?,?,?,?,?,'active')
     ON DUPLICATE KEY UPDATE key_ciphertext=VALUES(key_ciphertext), key_iv=VALUES(key_iv), key_tag=VALUES(key_tag), key_last4=VALUES(key_last4), status='active'`,
    [req.user.id, provider, s.ct, s.iv, s.tag, key.slice(-4)]);
  res.json({ provider, last4: key.slice(-4), status: 'active' });
}));

// ---- GET /v1/wallet -----------------------------------------------------------
v1.get('/wallet', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT balance_micro, held_micro FROM wallets WHERE user_id=?', [req.user.id]);
  const b = BigInt(rows[0]?.balance_micro ?? 0), h = BigInt(rows[0]?.held_micro ?? 0);
  res.json({ billing_mode: req.user.billing_mode, balance_micro: b.toString(), available_micro: (b - h).toString() });
}));
