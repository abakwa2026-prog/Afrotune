# yanga-core — Generation API + Credit Ledger

Node 18+ / Express / MySQL. Built for a shared-hosting box behind Cloudflare.

## Request flow

```
POST /v1/generate  (Bearer token)
  │ zod validate → sanitize prompt → insert job
  │ resolveRoute(): BYOK → decrypt user key (memory only) | INTERNAL → DeepSeek direct (OpenRouter fallback)
  │ estimateHold(): worst-case cost (0 cache hits, max output) → HOLD in ledger  ← 402 if short
  └─ 202 {job_id}  ── queue (bounded, JOB_CONCURRENCY) ──┐
                                                         ▼
  generating   LLM call (JSON mode, static system prompt = prefix-cache hit)
               → llm_calls row (tokens, our cost, user charge)
  validate     JSON parse → manifest rules (paths, size, no .github/.env/scripts, PWA files required)
               → SQL allowlist (CREATE TABLE/INDEX, ALTER, INSERT only)
  committing   GitHub: create private repo + ONE commit for all files (6 API calls)
  provisioning cPanel UAPI (or direct) → app_xxxx DB + scoped user → schema applied AS that user
  settle       RELEASE hold + DEBIT actual (capped at hold) in one transaction
GET /v1/jobs/:id   → status, repo, database
PUT /v1/keys/:provider → verify key with provider, store AES-256-GCM encrypted
GET /v1/wallet
POST /webhooks/paystack | /webhooks/flutterwave → signature → re-verify via API → idempotent TOPUP
```

## Ledger rules
- Money = BIGINT micro-credits (1 credit = 1 USD = 1,000,000). No floats.
- `credit_ledger` is append-only (DB triggers block UPDATE/DELETE). `wallets` is a locked projection.
- Every entry has an idempotency key (`job:{id}:hold|release|debit`, `paystack:{ref}`) → retries and duplicate webhooks are harmless.
- `v_wallet_drift` must return 0 rows; run nightly.
- Internal calls are refused while a model rate is 0 — fill `model_rates` from live provider pricing before launch.
- Tokens consumed are charged even if the output is later rejected; infra failures after generation are not refunded automatically (adjust policy if you prefer).

## Setup
1. `mysql < sql/001_schema.sql` (MySQL 8.0.16+ / MariaDB 10.5+; needs TRIGGER privilege — on cPanel, if denied, drop the two triggers and enforce append-only in code).
2. Copy `.env.example` → `.env`, `openssl rand -hex 32` for `MASTER_KEY_HEX`. Back it up offline: losing it = all BYOK keys and app DB passwords unrecoverable.
3. `npm install && npm start` (cPanel: "Setup Node.js App", startup file `src/server.js`).
4. GitHub: prefer a **GitHub App** installation token over a PAT (higher rate limits, scoped to the org, rotatable).

## Not in this module (by design)
Voice (ElevenLabs), USSD/SMS (Africa's Talking), deploy of the generated app to a subdomain. Each should be a separate worker consuming `generation_jobs` events, not more code in the request path.
