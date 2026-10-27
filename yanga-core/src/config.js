const env = process.env;

function req(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = Object.freeze({
  port: Number(env.PORT || 3000),
  masterKey: Buffer.from(req('MASTER_KEY_HEX'), 'hex'),
  jobConcurrency: Math.max(1, Number(env.JOB_CONCURRENCY || 2)),
  db: { host: env.DB_HOST || 'localhost', user: req('DB_USER'), password: req('DB_PASS'), database: req('DB_NAME') },
  llm: {
    internalProvider: env.INTERNAL_PROVIDER || 'deepseek',
    internalModel: env.INTERNAL_MODEL || 'deepseek-chat',
    deepseekKey: env.DEEPSEEK_API_KEY || '',
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterModel: env.OPENROUTER_MODEL || 'deepseek/deepseek-chat',
    maxOutputTokens: Number(env.MAX_OUTPUT_TOKENS || 8000),
    byokFeeMicro: BigInt(env.BYOK_PLATFORM_FEE_MICRO || 0),
  },
  github: { token: req('GITHUB_TOKEN'), org: req('GITHUB_ORG') },
  provisioner: {
    kind: env.PROVISIONER || 'cpanel',
    cpanel: { host: env.CPANEL_HOST, user: env.CPANEL_USER, token: env.CPANEL_API_TOKEN },
    direct: { user: env.DIRECT_DB_ADMIN_USER, password: env.DIRECT_DB_ADMIN_PASS },
  },
  pay: {
    paystackSecret: env.PAYSTACK_SECRET_KEY || '',
    flwSecret: env.FLW_SECRET_KEY || '',
    flwHash: env.FLW_WEBHOOK_HASH || '',
    fx: { NGN: BigInt(env.FX_MICRO_PER_NGN || 0), XAF: BigInt(env.FX_MICRO_PER_XAF || 0) },
  },
});

if (config.masterKey.length !== 32) throw new Error('MASTER_KEY_HEX must be 32 bytes (64 hex chars)');
