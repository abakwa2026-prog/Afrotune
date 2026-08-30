# AfroTune - Setup Guide

This walks through getting the full loop working: WhatsApp message → conversation →
Song Brief → payment/credits → generation → delivery. Follow it in order - each
section produces values you paste into `.env`.

Copy `.env.example` to `.env` at the repo root before you start, and fill it in as you
go through this guide. Also copy `apps/web/.env.local.example` to `apps/web/.env.local`
(Next.js only reads its own directory's env files).

---

## 0. Prerequisites

- Node.js 20+ and npm
- Docker (for a local Redis), or any Redis instance you already have
- A tunnel tool to expose your local API to the internet for webhook testing -
  [ngrok](https://ngrok.com) is the simplest (`ngrok http 8080`)
- All third-party accounts (Meta, Supabase, Paystack, ElevenLabs, OpenAI) should be created
  under **AfroTune's own company email/account**, not a personal one - see
  "Technical ownership" in `prompt.txt`.

```bash
npm install
```

---

## 1. Supabase (database + storage)

1. Create a project at [supabase.com](https://supabase.com) under the company account.
2. In the SQL Editor, run the migrations in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_storage.sql`
3. Run `supabase/seed.sql` to load starter Nigeria data.

   > **Important:** this repo did not have access to the live Supabase project the product spec
   > describes as already containing validated Nigerian country/genre/language data. `seed.sql`
   > is a placeholder so the app runs end-to-end. Before real customers see it, replace the seed
   > data with an export from the actual validated dataset (or point this schema at the existing
   > project and reconcile any differences - the migration is written to be additive/idempotent
   > where possible via `on conflict do nothing`).

4. From **Project Settings → API**, copy into `.env`:
   - `SUPABASE_URL` → Project URL
   - `SUPABASE_ANON_KEY` → `anon` `public` key
   - `SUPABASE_SERVICE_ROLE_KEY` → `service_role` key (**server-side only, never commit it**)
5. `SUPABASE_MUSIC_BUCKET` is already created by the storage migration as `afrotune-music` -
   leave the default unless you renamed it.

---

## 2. Meta WhatsApp Cloud API

1. Create an app at [developers.facebook.com](https://developers.facebook.com) (type: Business),
   under the company's Meta Business account.
2. Add the **WhatsApp** product to the app.
3. Under WhatsApp → API Setup, note:
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - A temporary access token is shown for quick testing; for anything beyond a day, generate a
     **permanent token** via a System User (Business Settings → System Users → Generate Token,
     with `whatsapp_business_messaging` + `whatsapp_business_management` permissions) → this is
     your `WHATSAPP_ACCESS_TOKEN`.
4. Under App Settings → Basic, copy `META_APP_ID` and `META_APP_SECRET`.
5. Choose any string for `WHATSAPP_VERIFY_TOKEN` - you'll enter the same value in Meta's webhook
   config in step 4 below.
6. `WHATSAPP_API_VERSION` - use the current stable version shown in the Graph API docs (e.g.
   `v20.0`); update this periodically as Meta deprecates old versions.

You'll come back to **Configuration → Webhook** in Meta's dashboard once your API is running
(step 6 below) to point it at your server and subscribe to the `messages` field.

---

## 3. Paystack

1. Create an account at [paystack.com](https://paystack.com) under the company account.
2. From Settings → API Keys & Webhooks, copy the **test** keys first:
   - `PAYSTACK_PUBLIC_KEY`
   - `PAYSTACK_SECRET_KEY`
3. In the same page, set the **Webhook URL** to `https://<your-api-domain>/webhooks/paystack`
   once you have a public URL (step 6). Paystack signs every webhook with your secret key
   (HMAC-SHA512) - `apps/api` verifies this automatically, no separate webhook secret exists.
4. Switch to live keys only when you're ready for real payments.

---

## 4. ElevenLabs (music generation)

1. Get an API key from [elevenlabs.io](https://elevenlabs.io) under the company account →
   `ELEVENLABS_API_KEY`.
2. `ELEVENLABS_MUSIC_MODEL` - use the model id shown in ElevenLabs' current Music API docs.

   > **Verified against the live API (2026-08):** `packages/providers/src/music/elevenlabs.ts` calls
   > `POST {base}/music/detailed`, which is synchronous - it returns the finished track in one
   > call (not a job id to poll) as a `multipart/mixed` response: a JSON part with the composition
   > plan/lyrics and an `audio/*` part with the track. `model_id` must be `music_v1` (underscore).
   > If ElevenLabs changes this contract again, only that one file needs to change.
3. Per the product spec, actually test output quality (not just that it returns audio) for:
   Afrobeats, Highlife, Fuji, Juju, Apala; English, Nigerian Pidgin, Yoruba, Igbo, Hausa, and
   mixed-language songs; male/female vocals. Track subjective quality somewhere (even a
   spreadsheet) before treating any genre/language combination as customer-ready.

---

## 5. OpenAI (conversational understanding)

1. Get an API key from [platform.openai.com](https://platform.openai.com) → `OPENAI_API_KEY`.
2. `OPENAI_MODEL` - `gpt-4o-mini` is a reasonable default for cost/quality; upgrade if extraction
   quality on real conversations needs it.

`LLM_PROVIDER=openai` selects `packages/providers/src/llm/openai.ts`. To use a different
provider later, add a new class implementing `LLMProvider` (`packages/core/src/llmProvider.ts`)
and a `case` in `apps/worker/src/lib/providers.ts` - nothing else changes.

---

## 6. Redis (queue)

Local dev:

```bash
docker compose up -d redis
```

`REDIS_URL=redis://localhost:6379` (already the `.env.example` default). In production, use a
managed Redis (Railway/Render/Upstash all work) and set `REDIS_URL` to its connection string.

---

## 7. Fill in the rest of `.env`

- `APP_URL` - the public URL of `apps/web` (e.g. `https://afrotune.app` or, for local testing,
  your ngrok URL if you tunnel the web app too).
- `API_URL` - the public URL of `apps/api` (used by `apps/web` server-side).
- `APP_SECRET` - generate one: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
  Used to gate `/admin` in `apps/web`.
- `DEFAULT_COUNTRY_CODE=NG` for the Phase 1 validation market.

Copy the matching values into `apps/web/.env.local` (`API_URL`, `APP_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`).

---

## 8. Run it locally

```bash
npm run dev:api      # terminal 1 - http://localhost:8080
npm run dev:worker   # terminal 2 - no HTTP port, processes queues
npm run dev:web      # terminal 3 - http://localhost:3000
```

Expose the API publicly for webhook testing:

```bash
ngrok http 8080
```

Take the `https://xxxx.ngrok-free.app` URL ngrok gives you and:

- In Meta's dashboard (WhatsApp → Configuration → Webhook): set the callback URL to
  `https://xxxx.ngrok-free.app/webhooks/whatsapp` and the verify token to your
  `WHATSAPP_VERIFY_TOKEN`. Click **Verify and save**, then subscribe to the `messages` webhook
  field.
- In Paystack's dashboard: set the webhook URL to
  `https://xxxx.ngrok-free.app/webhooks/paystack`.

---

## 9. End-to-end test

1. From the WhatsApp test number Meta gave you (or your connected business number), message your
   AfroTune WhatsApp number:
   > "Make a birthday song for my wife Ada. We've been married for seven years. She loves
   > Afrobeats. Make it romantic but still danceable, and put some Yoruba inside."
2. Watch the `apps/worker` logs - you should see the incoming-message job processed, an LLM call,
   and a reply sent back on WhatsApp (likely a clarifying question, e.g. mood/language detail if
   anything is still missing).
3. Answer until AfroTune shows a summary and asks to confirm; reply "yes" (or tap the button).
4. If your test wallet has 0 credits, you'll get a "Buy credits" link. Complete checkout with a
   [Paystack test card](https://paystack.com/docs/payments/test-payments/). Watch the
   `apps/worker` logs for the payment-verification job, then a "Payment received" WhatsApp
   message, followed by generation starting automatically.
5. Watch the generation job run (LLM composition spec → ElevenLabs call → poll → FFmpeg → upload).
   On success you'll get the finished song, lyrics, and a link to `/song/<id>` on WhatsApp.
6. Open the song link, confirm playback/lyrics/download work, and submit a rating (also works by
   replying `1`-`5` directly on WhatsApp).
7. Open `http://localhost:3000/admin`, log in with `APP_SECRET`, and confirm the user, payment,
   song and rating all show up.

If generation fails (bad ElevenLabs response, network error, etc.), confirm you get a WhatsApp
message explaining it and that the debited credit is refunded - check `/admin` and the
`credit_ledger` table to see the `generation` debit and `refund` credit both recorded.

---

## 10. Deploying (Railway)

This repo is an npm-workspaces monorepo, so it deploys as **three Railway services from the
same GitHub repo** plus a managed Redis - there's no per-service subfolder deploy, since
`apps/api`/`apps/worker`/`apps/web` all resolve `@afrotune/*` packages through the root
`node_modules`. Each service's build/start command is pinned by a config file at the repo root
(`railway.api.json`, `railway.worker.json`, `railway.web.json`) so builds are reproducible
instead of relying on Railway's auto-detection.

1. **Push to GitHub**, then in Railway: **New Project → Deploy from GitHub repo**, picking this
   repo. Railway creates one service; add two more with **+ New → GitHub Repo** pointing at the
   *same* repo (Empty root directory - do not set a per-service Root Directory, since that would
   break workspace resolution).
2. For **each** of the 3 services, in **Settings → Config-as-code**, set the Config File Path to
   the matching file: `railway.api.json`, `railway.worker.json`, or `railway.web.json`. Rename
   the services accordingly (`api`, `worker`, `web`) so the next steps are unambiguous.
3. **Add Redis**: **+ New → Database → Add Redis** in the same project. On the `api` and
   `worker` services, set `REDIS_URL` to the reference variable `${{Redis.REDIS_URL}}` (Railway
   autocompletes this once Redis exists in the project).
4. **Networking**: generate a public domain (**Settings → Networking → Generate Domain**) for
   `api` and `web`. Leave `worker` with no domain - it has no HTTP server, it only consumes the
   BullMQ queue.
5. **Environment variables** - set on each service (see `.env.example` for what each one does):
   - `api` and `worker` both need: `NODE_ENV=production`, `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `REDIS_URL` (step 3), `APP_URL` (the
     `web` service's public domain, step 4), `MUSIC_PROVIDER`, `ELEVENLABS_API_KEY`,
     `ELEVENLABS_MUSIC_MODEL`, `LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`,
     `DEFAULT_COUNTRY_CODE`, `DEV_BYPASS_PAYMENT=false`, plus the WhatsApp provider block below.
   - `api` additionally needs `PORT` is **not** set manually - Railway injects it and
     `apps/api/src/env.ts` already reads `process.env.PORT`.
   - `web` needs: `NODE_ENV=production`, `API_URL` (the `api` service's public domain, step 4),
     `APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - WhatsApp provider block (see `CONNECT_WHATSAPP.md` for how to obtain these) - on `api` and
     `worker`: `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
     `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
     `WHATSAPP_API_VERSION`. Never set `WHATSAPP_PROVIDER=console` on a deployed service - that
     mode only echoes messages back into logs.
6. Deploy. Once `api` is live, re-point the Meta webhook (and Paystack's webhook, and
   `TWILIO_WEBHOOK_URL` if using Twilio) from your ngrok URL to `https://<api-domain>/webhooks/whatsapp`
   (steps 2-3 above in this guide / `CONNECT_WHATSAPP.md`).
7. Rotate `WHATSAPP_ACCESS_TOKEN`, `PAYSTACK_SECRET_KEY` (switch to `sk_live_...`), and
   `APP_SECRET` to real production values - never reuse the test/dev secrets from your local
   `.env`.

`ffmpeg-static`/`ffprobe-static` (used by `apps/worker` for audio post-processing) bundle their
own binaries, so no extra system packages need to be installed on Railway.

---

## Troubleshooting

- **Meta webhook verification fails**: confirm `WHATSAPP_VERIFY_TOKEN` matches exactly on both
  sides, and that `apps/api` is actually reachable at the URL you gave Meta (check ngrok's
  request inspector at `http://localhost:4040`).
- **Paystack webhook 403s**: the raw request body must reach `apps/api` unmodified for signature
  verification - if you put a proxy in front of it, make sure it doesn't rewrite the body.
- **Worker never picks up jobs**: confirm `REDIS_URL` is identical between `apps/api` and
  `apps/worker`, and that both point at the same Redis instance/db number.
- **"Cannot find module '@afrotune/...'"**: run `npm install` from the repo root (not inside an
  individual `apps/*` or `packages/*` folder) so npm workspace symlinks are set up.
