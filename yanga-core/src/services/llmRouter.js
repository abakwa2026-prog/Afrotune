// BYOK vs INTERNAL routing over OpenAI-compatible Chat Completions APIs.
import { pool } from '../db.js';
import { config } from '../config.js';
import { open } from '../lib/crypto.js';

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

const rateCache = new Map(); // key -> {rate, at}
async function getRate(provider, model) {
  const k = `${provider}:${model}`; const hit = rateCache.get(k);
  if (hit && Date.now() - hit.at < 300_000) return hit.rate;
  const [rows] = await pool.query(
    'SELECT * FROM model_rates WHERE provider=? AND model=? AND effective_from <= NOW(3) ORDER BY effective_from DESC LIMIT 1',
    [provider, model]);
  const r = rows[0];
  if (!r) throw Object.assign(new Error('no_rate'), { code: 'NO_RATE' });
  const rate = { id: r.id, inp: BigInt(r.input_micro_per_mtok), cin: BigInt(r.cached_input_micro_per_mtok),
                 out: BigInt(r.output_micro_per_mtok), markupBps: BigInt(r.markup_bps) };
  if (rate.inp === 0n || rate.out === 0n) throw Object.assign(new Error('rate_not_configured'), { code: 'RATE_NOT_CONFIGURED' });
  rateCache.set(k, { rate, at: Date.now() });
  return rate;
}

const ceilDiv = (a, b) => (a + b - 1n) / b;
function priceUsage(rate, u) {
  const uncached = BigInt(Math.max(0, u.prompt - u.cached));
  const cost = ceilDiv(uncached * rate.inp + BigInt(u.cached) * rate.cin + BigInt(u.completion) * rate.out, 1_000_000n);
  const charged = ceilDiv(cost * (10_000n + rate.markupBps), 10_000n);
  return { cost, charged };
}

/** Resolve which provider/model/key a job will use. Decrypts BYOK key in memory only. */
export async function resolveRoute(user, preferredProvider) {
  if (user.billing_mode === 'BYOK') {
    const [rows] = await pool.query(
      "SELECT provider, key_ciphertext, key_iv, key_tag FROM byok_keys WHERE user_id=? AND status='active' ORDER BY provider = ? DESC LIMIT 1",
      [user.id, preferredProvider || 'deepseek']);
    if (!rows.length) throw Object.assign(new Error('no_byok_key'), { code: 'NO_BYOK_KEY' });
    const k = rows[0];
    const apiKey = open({ ct: k.key_ciphertext, iv: k.key_iv, tag: k.key_tag }, `byok:${user.id}:${k.provider}`);
    return { route: 'BYOK', provider: k.provider, model: k.provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat', apiKey, rate: null };
  }
  const provider = config.llm.internalProvider;
  const model = provider === 'openrouter' ? config.llm.openrouterModel : config.llm.internalModel;
  const apiKey = provider === 'openrouter' ? config.llm.openrouterKey : config.llm.deepseekKey;
  return { route: 'INTERNAL', provider, model, apiKey, rate: await getRate(provider, model) };
}

/** Worst-case cost for the credit hold (assumes zero cache hits, full max output). */
export function estimateHold(r, messages) {
  if (r.route === 'BYOK') return 0n;
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const promptTok = Math.ceil(chars / 3) + 50; // conservative: ~3 chars/token
  return priceUsage(r.rate, { prompt: promptTok, cached: 0, completion: config.llm.maxOutputTokens }).charged;
}

/** One chat completion call with JSON output, timeout and usage normalization. */
export async function complete(r, messages, { timeoutMs = 180_000 } = {}) {
  const body = {
    model: r.model,
    messages,
    temperature: 0.2,
    max_tokens: config.llm.maxOutputTokens,
    response_format: { type: 'json_object' },
  };
  if (r.provider === 'openrouter') {
    body.usage = { include: true };
    body.provider = { order: ['DeepSeek'], allow_fallbacks: true }; // keep prefix-cache locality
  }
  const t0 = Date.now();
  const res = await fetch(ENDPOINTS[r.provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    // Never echo provider bodies to users: they can contain key fragments.
    const code = res.status === 401 ? 'PROVIDER_AUTH' : res.status === 429 ? 'PROVIDER_RATE_LIMIT' : `PROVIDER_${res.status}`;
    throw Object.assign(new Error(code), { code, latencyMs });
  }
  const data = await res.json();
  const u = data.usage || {};
  const usage = {
    prompt: u.prompt_tokens || 0,
    cached: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0, // DeepSeek ?? OpenAI/OpenRouter
    completion: u.completion_tokens || 0,
  };
  const { cost, charged } = r.route === 'INTERNAL' ? priceUsage(r.rate, usage) : { cost: 0n, charged: 0n };
  return { text: data.choices?.[0]?.message?.content ?? '', finish: data.choices?.[0]?.finish_reason, usage, cost, charged, latencyMs };
}
