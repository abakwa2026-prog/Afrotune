-- AfroTune Phase 1 schema
-- Design notes:
--  * All server-side access uses the Supabase service role key (apps/api, apps/worker).
--    The web app never talks to Supabase directly with the anon key; it goes through
--    apps/api server-side routes. RLS is therefore left DENY-ALL by default (service
--    role bypasses RLS) rather than hand-rolled into a false sense of browser security.
--  * Money/credits are ledger-sourced. credit_wallets.balance is a cache maintained
--    atomically alongside credit_ledger inserts via the apply_credit_ledger_entry()
--    function below, never written directly by application code.
--  * Every external webhook (Meta, Paystack) is recorded in webhook_events with a
--    unique (source, event_id) constraint so redelivery cannot double-process.

create extension if not exists pgcrypto;

-- ==================================================
-- ENUMS
-- ==================================================

create type user_status as enum ('active', 'blocked');

create type conversation_status as enum ('active', 'completed', 'abandoned');

create type song_request_status as enum (
  'draft',
  'collecting_details',
  'ready_for_confirmation',
  'awaiting_payment',
  'queued',
  'generating',
  'processing',
  'completed',
  'failed',
  'moderation_required',
  'cancelled'
);

create type generation_job_status as enum (
  'queued', 'running', 'succeeded', 'failed', 'cancelled'
);

create type payment_status as enum ('pending', 'success', 'failed', 'abandoned');

create type credit_ledger_type as enum (
  'purchase', 'generation', 'refund', 'referral_reward', 'admin_adjustment'
);

create type referral_status as enum ('pending', 'registered', 'converted');

create type moderation_status as enum ('pending', 'approved', 'rejected');

create type webhook_source as enum ('meta', 'paystack');

-- ==================================================
-- MUSIC / CULTURAL DATA (data-driven, multi-country)
-- ==================================================

create table countries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,              -- ISO 3166-1 alpha-2, e.g. 'NG'
  name text not null,
  currency_code text not null,            -- ISO 4217, e.g. 'NGN'
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table languages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,              -- e.g. 'yo', 'ig', 'ha', 'en', 'pcm'
  name text not null,                     -- e.g. 'Yoruba'
  is_active boolean not null default true
);

create table genres (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references countries(id),
  parent_genre_id uuid references genres(id),   -- for fusions/variations
  name text not null,
  description text,
  cultural_notes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (country_id, name)
);

create table instruments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

create table genre_instruments (
  genre_id uuid not null references genres(id) on delete cascade,
  instrument_id uuid not null references instruments(id) on delete cascade,
  primary key (genre_id, instrument_id)
);

-- ==================================================
-- USERS / IDENTITY
-- ==================================================

create table users (
  id uuid primary key default gen_random_uuid(),
  whatsapp_phone_number text not null unique,   -- E.164, primary identity
  display_name text,
  country_id uuid references countries(id),
  preferred_language_id uuid references languages(id),
  preferred_genre_id uuid references genres(id),
  status user_status not null default 'active',
  referral_code text not null unique default encode(gen_random_bytes(4), 'hex'),
  referred_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_users_whatsapp_phone on users (whatsapp_phone_number);

-- ==================================================
-- CONVERSATION STATE
-- ==================================================

create table conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status conversation_status not null default 'active',
  current_song_request_id uuid,   -- FK added after song_requests exists
  state jsonb not null default '{}'::jsonb,   -- extracted slots + short message history
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one active session per user at a time.
create unique index idx_conversation_sessions_one_active
  on conversation_sessions (user_id)
  where status = 'active';

-- ==================================================
-- PRICING
-- ==================================================

create table credit_packs (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references countries(id),
  credits integer not null check (credits > 0),
  price_minor_units bigint not null check (price_minor_units >= 0), -- e.g. kobo
  currency_code text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table pricing_rules (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references countries(id),
  credits_per_song integer not null default 1 check (credits_per_song > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ==================================================
-- SONG REQUESTS (the Song Brief) / SONGS
-- ==================================================

create table song_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  conversation_session_id uuid references conversation_sessions(id),
  status song_request_status not null default 'draft',

  country_id uuid references countries(id),
  occasion text,
  recipient_name text,
  relationship text,
  story text,
  genre_id uuid references genres(id),
  secondary_genre_id uuid references genres(id),
  language_ids uuid[] not null default '{}',
  mood text,
  vocal_preference text,                  -- 'male' | 'female' | 'surprise_me'
  target_duration_seconds integer,
  required_phrases jsonb not null default '[]'::jsonb,

  brief jsonb not null default '{}'::jsonb,   -- full structured brief snapshot (superset)
  composition_spec jsonb,                     -- Song Brief + cultural/music intelligence enrichment

  price_minor_units bigint,
  currency_code text,
  credits_required integer not null default 1,

  moderation_status moderation_status not null default 'approved',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table conversation_sessions
  add constraint fk_conversation_current_song_request
  foreign key (current_song_request_id) references song_requests(id);

create index idx_song_requests_user on song_requests (user_id);
create index idx_song_requests_status on song_requests (status);

create table songs (
  id uuid primary key default gen_random_uuid(),
  song_request_id uuid not null unique references song_requests(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,

  title text,
  lyrics text,

  provider text not null,                 -- e.g. 'elevenlabs'
  provider_job_id text,
  provider_metadata jsonb not null default '{}'::jsonb,

  original_audio_path text,               -- Supabase Storage object path
  delivery_audio_path text,               -- FFmpeg-processed delivery copy
  duration_seconds numeric,

  status song_request_status not null default 'queued',
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_songs_user on songs (user_id);

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs(id) on delete cascade,
  status generation_job_status not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  idempotency_key text not null unique,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index idx_generation_jobs_song on generation_jobs (song_id);

-- ==================================================
-- CREDIT WALLET / LEDGER
-- ==================================================

create table credit_wallets (
  user_id uuid primary key references users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount integer not null,                -- positive = credit, negative = debit
  type credit_ledger_type not null,
  reference_type text,                    -- 'payment' | 'song_request' | 'referral' | 'admin'
  reference_id uuid,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_credit_ledger_user on credit_ledger (user_id);

-- Atomically apply a ledger entry and update the wallet cache. Safe to call
-- repeatedly with the same idempotency_key (e.g. retried webhooks / jobs):
-- the second call is a no-op and returns applied = false.
create or replace function apply_credit_ledger_entry(
  p_user_id uuid,
  p_amount integer,
  p_type credit_ledger_type,
  p_reference_type text,
  p_reference_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
) returns table (applied boolean, balance integer) as $$
declare
  v_row_count integer;
  v_inserted boolean;
  v_balance integer;
begin
  insert into credit_wallets (user_id, balance)
    values (p_user_id, 0)
    on conflict (user_id) do nothing;

  insert into credit_ledger (
    user_id, amount, type, reference_type, reference_id, idempotency_key, metadata
  ) values (
    p_user_id, p_amount, p_type, p_reference_type, p_reference_id, p_idempotency_key, p_metadata
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_row_count = row_count;
  v_inserted := (v_row_count > 0);

  if v_inserted then
    update credit_wallets cw
      set balance = cw.balance + p_amount, updated_at = now()
      where cw.user_id = p_user_id
      returning cw.balance into v_balance;
  else
    select cw.balance into v_balance from credit_wallets cw where cw.user_id = p_user_id;
  end if;

  return query select v_inserted, v_balance;
end;
$$ language plpgsql security definer;

-- ==================================================
-- PAYMENTS
-- ==================================================

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'paystack',
  provider_reference text not null unique,
  credit_pack_id uuid references credit_packs(id),
  credits integer not null,
  amount_minor_units bigint not null,
  currency_code text not null,
  status payment_status not null default 'pending',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index idx_payments_user on payments (user_id);

-- ==================================================
-- WEBHOOK DEDUPE
-- ==================================================

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source webhook_source not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, event_id)
);

-- ==================================================
-- RATINGS / SHARING
-- ==================================================

create table ratings (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  feedback text,
  created_at timestamptz not null default now(),
  unique (song_id, user_id)
);

-- ==================================================
-- REFERRALS
-- ==================================================

create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references users(id) on delete cascade,
  referred_user_id uuid references users(id) on delete cascade,
  code text not null,
  status referral_status not null default 'pending',
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

create index idx_referrals_referrer on referrals (referrer_user_id);

-- ==================================================
-- MODERATION
-- ==================================================

create table moderation_queue (
  id uuid primary key default gen_random_uuid(),
  song_request_id uuid not null references song_requests(id) on delete cascade,
  reason text not null,
  status moderation_status not null default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ==================================================
-- updated_at triggers
-- ==================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();
create trigger trg_conversation_sessions_updated_at before update on conversation_sessions
  for each row execute function set_updated_at();
create trigger trg_song_requests_updated_at before update on song_requests
  for each row execute function set_updated_at();
create trigger trg_songs_updated_at before update on songs
  for each row execute function set_updated_at();

-- ==================================================
-- RLS: deny-all by default. All product access goes through
-- server-side code using the service role key, which bypasses RLS.
-- ==================================================

alter table users enable row level security;
alter table conversation_sessions enable row level security;
alter table song_requests enable row level security;
alter table songs enable row level security;
alter table generation_jobs enable row level security;
alter table credit_wallets enable row level security;
alter table credit_ledger enable row level security;
alter table payments enable row level security;
alter table webhook_events enable row level security;
alter table ratings enable row level security;
alter table referrals enable row level security;
alter table moderation_queue enable row level security;
