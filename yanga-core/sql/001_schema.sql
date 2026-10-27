-- =====================================================================
-- Yanga.ai Core Ledger Schema  (MySQL 8.0.16+ / MariaDB 10.5+)
-- Money is stored as BIGINT "micro-credits" (1 credit = 1 USD = 1,000,000 µcr).
-- Never use FLOAT/DECIMAL arithmetic in app code for balances.
-- =====================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id     CHAR(26)     NOT NULL,                    -- ULID, safe to expose
  email         VARCHAR(190) NOT NULL,
  phone_e164    VARCHAR(16)  NULL,
  country_iso2  CHAR(2)      NOT NULL DEFAULT 'CM',
  locale        VARCHAR(8)   NOT NULL DEFAULT 'en',       -- en | fr | ...
  billing_mode  ENUM('BYOK','INTERNAL') NOT NULL DEFAULT 'INTERNAL',
  status        ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_public (public_id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API tokens: only the SHA-256 hash is stored.
CREATE TABLE api_tokens (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   BINARY(32) NOT NULL,
  label        VARCHAR(60) NULL,
  last_used_at DATETIME(3) NULL,
  revoked_at   DATETIME(3) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_token_hash (token_hash),
  CONSTRAINT fk_tok_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- BYOK keys: AES-256-GCM encrypted at rest; plaintext never stored/logged.
-- ---------------------------------------------------------------------
CREATE TABLE byok_keys (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  provider       ENUM('openai','deepseek') NOT NULL,
  key_ciphertext VARBINARY(512) NOT NULL,
  key_iv         BINARY(12)     NOT NULL,
  key_tag        BINARY(16)     NOT NULL,
  key_version    TINYINT UNSIGNED NOT NULL DEFAULT 1,    -- master-key rotation
  key_last4      CHAR(4)        NOT NULL,
  status         ENUM('active','invalid','revoked') NOT NULL DEFAULT 'active',
  last_used_at   DATETIME(3) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_byok_user_provider (user_id, provider),
  CONSTRAINT fk_byok_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Wallet = cached projection of the ledger (fast reads, row-locked writes).
-- available = balance_micro - held_micro
-- ---------------------------------------------------------------------
CREATE TABLE wallets (
  user_id        BIGINT UNSIGNED PRIMARY KEY,
  balance_micro  BIGINT NOT NULL DEFAULT 0,
  held_micro     BIGINT NOT NULL DEFAULT 0,
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_wallet_nonneg CHECK (balance_micro >= 0 AND held_micro >= 0 AND held_micro <= balance_micro),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Append-only ledger. Source of truth. Wallet must always reconcile to it:
--   balance = SUM(amount_micro WHERE entry_type IN (TOPUP,DEBIT,REFUND,BONUS,ADJUST))
-- HOLD/RELEASE only move held_micro (amount stored as positive for audit).
-- ---------------------------------------------------------------------
CREATE TABLE credit_ledger (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  entry_type       ENUM('TOPUP','HOLD','RELEASE','DEBIT','REFUND','BONUS','ADJUST') NOT NULL,
  amount_micro     BIGINT NOT NULL,             -- signed: TOPUP +, DEBIT -, HOLD/RELEASE +
  balance_after    BIGINT NOT NULL,
  held_after       BIGINT NOT NULL,
  ref_type         ENUM('job','payment','admin','promo') NOT NULL,
  ref_id           BIGINT UNSIGNED NOT NULL,
  idempotency_key  VARCHAR(80) NOT NULL,        -- e.g. job:123:settle, paystack:REF
  note             VARCHAR(255) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ledger_idem (idempotency_key),
  KEY ix_ledger_user_time (user_id, created_at),
  KEY ix_ledger_ref (ref_type, ref_id),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

DELIMITER //
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON credit_ledger
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'credit_ledger is append-only';
//
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON credit_ledger
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'credit_ledger is append-only';
//
DELIMITER ;

-- ---------------------------------------------------------------------
-- Model pricing (micro-USD per 1M tokens). Versioned: never edit a row,
-- insert a new one with a later effective_from. Rates are looked up at call time.
-- ---------------------------------------------------------------------
CREATE TABLE model_rates (
  id                         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider                   ENUM('openai','deepseek','openrouter') NOT NULL,
  model                      VARCHAR(80) NOT NULL,
  input_micro_per_mtok       BIGINT NOT NULL,
  cached_input_micro_per_mtok BIGINT NOT NULL,
  output_micro_per_mtok      BIGINT NOT NULL,
  markup_bps                 INT NOT NULL DEFAULT 0,      -- 15000 = +150%
  effective_from             DATETIME(3) NOT NULL,
  KEY ix_rates_lookup (provider, model, effective_from)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Generation jobs (one per prompt) — the unit of billing & provisioning.
-- ---------------------------------------------------------------------
CREATE TABLE generation_jobs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id       CHAR(26) NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  billing_route   ENUM('BYOK','INTERNAL') NOT NULL,
  status          ENUM('queued','generating','committing','provisioning','done','failed') NOT NULL DEFAULT 'queued',
  app_slug        VARCHAR(40)  NOT NULL,
  prompt_sha256   BINARY(32)   NOT NULL,      -- dedupe/abuse detection without storing full prompt twice
  prompt_text     TEXT         NOT NULL,      -- sanitized
  hold_micro      BIGINT NOT NULL DEFAULT 0,
  charged_micro   BIGINT NOT NULL DEFAULT 0,
  error_code      VARCHAR(40)  NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_job_public (public_id),
  KEY ix_job_user (user_id, created_at),
  KEY ix_job_status (status, updated_at),
  CONSTRAINT fk_job_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Every LLM call, both routes. BYOK rows have cost_micro = 0 for us,
-- but tokens are still recorded (usage analytics + upsell signals).
CREATE TABLE llm_calls (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id            BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  billing_route     ENUM('BYOK','INTERNAL') NOT NULL,
  provider          ENUM('openai','deepseek','openrouter') NOT NULL,
  model             VARCHAR(80) NOT NULL,
  rate_id           INT UNSIGNED NULL,
  prompt_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  cached_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cost_micro        BIGINT NOT NULL DEFAULT 0,      -- what WE pay the provider
  charged_micro     BIGINT NOT NULL DEFAULT 0,      -- what the USER pays us
  latency_ms        INT UNSIGNED NOT NULL DEFAULT 0,
  status            ENUM('ok','error') NOT NULL,
  error_code        VARCHAR(40) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_llm_job (job_id),
  KEY ix_llm_user_time (user_id, created_at),
  CONSTRAINT fk_llm_job FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Payments (Paystack / Flutterwave). Unique gateway ref = webhook idempotency.
-- ---------------------------------------------------------------------
CREATE TABLE payments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  gateway         ENUM('paystack','flutterwave') NOT NULL,
  gateway_ref     VARCHAR(100) NOT NULL,
  currency        CHAR(3) NOT NULL,                 -- NGN, XAF, GHS, KES, USD
  amount_minor    BIGINT NOT NULL,                  -- kobo / centimes as reported
  fx_micro_per_unit BIGINT NOT NULL,                -- µcr per 1 major unit at credit time
  credited_micro  BIGINT NOT NULL DEFAULT 0,
  status          ENUM('pending','success','failed','reversed') NOT NULL DEFAULT 'pending',
  verified_at     DATETIME(3) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pay_ref (gateway, gateway_ref),
  CONSTRAINT fk_pay_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Provisioned resources (repo, database, subdomain) for cleanup & billing.
-- Secrets (DB passwords) stored encrypted, never committed to Git.
-- ---------------------------------------------------------------------
CREATE TABLE provisioned_resources (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id        BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  kind          ENUM('github_repo','mysql_db','subdomain') NOT NULL,
  identifier    VARCHAR(190) NOT NULL,
  secret_ct     VARBINARY(512) NULL,
  secret_iv     BINARY(12) NULL,
  secret_tag    BINARY(16) NULL,
  status        ENUM('active','failed','deleted') NOT NULL DEFAULT 'active',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_res (kind, identifier),
  KEY ix_res_user (user_id),
  CONSTRAINT fk_res_job FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Reconciliation check (run nightly; must return zero rows)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_wallet_drift AS
SELECT w.user_id, w.balance_micro, COALESCE(SUM(
         CASE WHEN l.entry_type IN ('TOPUP','DEBIT','REFUND','BONUS','ADJUST') THEN l.amount_micro ELSE 0 END),0) AS ledger_balance
FROM wallets w LEFT JOIN credit_ledger l ON l.user_id = w.user_id
GROUP BY w.user_id, w.balance_micro
HAVING w.balance_micro <> ledger_balance;

-- ---------------------------------------------------------------------
-- Seed rates: PLACEHOLDERS. Verify against each provider's live pricing
-- page before launch and insert real values with a new effective_from.
-- ---------------------------------------------------------------------
INSERT INTO model_rates (provider, model, input_micro_per_mtok, cached_input_micro_per_mtok, output_micro_per_mtok, markup_bps, effective_from) VALUES
 ('deepseek',   'deepseek-chat',        0, 0, 0, 15000, '2026-01-01'),
 ('openrouter', 'deepseek/deepseek-chat', 0, 0, 0, 15000, '2026-01-01'),
 ('openai',     'gpt-4o-mini',          0, 0, 0,     0, '2026-01-01');
-- NOTE: the app REFUSES internal-credit calls while a rate is 0 (fail-safe),
-- so you cannot accidentally give away tokens. BYOK calls ignore rates.
