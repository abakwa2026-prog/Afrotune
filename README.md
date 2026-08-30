# AfroTune

WhatsApp-first AI music creation platform. See `prompt.txt` for the full product spec this
implementation follows, and `SETUP_GUIDE.md` for how to get it running end to end.

## Architecture

```
apps/
  api/       Fastify server. Owns: WhatsApp webhook (verify + fast-ack + enqueue),
             Paystack webhook (verify + fast-ack + enqueue), and the small REST API
             apps/web talks to (songs, credit packs, payment initialization).
             Never does LLM calls, music generation, or FFmpeg work inline.

  worker/    BullMQ workers. Owns: the conversation state machine (LLM-driven Song
             Brief building), payment verification against Paystack, and the full
             generation pipeline (compose -> provider call -> download -> FFmpeg ->
             storage -> DB -> WhatsApp notification).

  web/       Next.js. Owns: the shareable song page, the credit purchase page, and a
             founder-only admin dashboard. Thin - all product logic lives in apps/api
             and apps/worker; web mostly renders and proxies.

packages/
  core/      Provider-agnostic types: SongBrief, CompositionSpec, MusicGenerationProvider
             and LLMProvider interfaces. No I/O. This is the contract everything else
             is written against, so a new music or LLM provider is a new class here,
             not a rewrite of conversation/payment/delivery code.

  db/        Supabase client + repository functions (one file per table group). All
             money/credit logic funnels through apply_credit_ledger_entry(), an atomic,
             idempotent Postgres function - see supabase/migrations/0001_init.sql.

  providers/ Concrete provider implementations: OpenAI (LLM), ElevenLabs (music),
             Meta WhatsApp Cloud API client + webhook verification, Paystack client +
             webhook verification, FFmpeg audio processing.

  queue/     BullMQ queue definitions and job payload types, shared by apps/api
             (producer) and apps/worker (consumer).

supabase/
  migrations/  SQL schema (run against your Supabase project).
  seed.sql     Starter Nigeria data (countries/genres/languages/credit packs) -
               placeholder until you export the real validated data.
```

## Why it's shaped this way

- **The webhook never blocks.** `apps/api` verifies, dedupes (`webhook_events`), enqueues, and
  returns. All LLM/provider/FFmpeg work happens in `apps/worker`.
- **Money is ledger-sourced, not a mutable column.** `credit_wallets.balance` is a cache
  maintained only by `apply_credit_ledger_entry()`, which is atomic and idempotent via a unique
  `idempotency_key` - safe against Meta/Paystack webhook redelivery.
- **The LLM never decides money or state.** It only extracts slots and drafts replies
  (`packages/core/src/llmProvider.ts`). Credits, pricing, and generation status are always read
  from the database in `apps/worker`.
- **Provider independence is a real interface, not a promise.** `MusicGenerationProvider` and
  `LLMProvider` in `packages/core` are what conversation/payment/delivery code depends on.
  ElevenLabs and OpenAI are just the first implementations.

## Local development

See `SETUP_GUIDE.md`. Short version once `.env` is filled in:

```bash
npm install
docker compose up -d redis        # or point REDIS_URL at any Redis you already have
npm run dev:api                   # terminal 1
npm run dev:worker                # terminal 2
npm run dev:web                   # terminal 3
```
