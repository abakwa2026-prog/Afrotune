import { z } from "zod";

const BooleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const BaseEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),

  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_MUSIC_BUCKET: z.string().default("afrotune-music"),

  WHATSAPP_PROVIDER: z.enum(["meta", "twilio", "console"]).default("meta"),

  // ---- Meta (required only when WHATSAPP_PROVIDER=meta) ----
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v20.0"),

  // ---- Twilio (required only when WHATSAPP_PROVIDER=twilio) ----
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  PAYSTACK_SECRET_KEY: z.string().min(1),

  MUSIC_PROVIDER: z.enum(["elevenlabs"]).default("elevenlabs"),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_MUSIC_MODEL: z.string().default("music-v1"),

  LLM_PROVIDER: z.enum(["openai"]).default("openai"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  REDIS_URL: z.string().min(1),
  APP_URL: z.string().min(1),

  DEFAULT_COUNTRY_CODE: z.string().default("NG"),

  // Development-only credit bypass - see apps/worker/src/lib/generationStarter.ts.
  // Double-gated: also requires NODE_ENV !== "production" at the call site.
  DEV_BYPASS_PAYMENT: BooleanFromString,
});

const EnvSchema = BaseEnvSchema.superRefine((env, ctx) => {
  if (env.WHATSAPP_PROVIDER === "meta") {
    for (const key of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required when WHATSAPP_PROVIDER=meta" });
      }
    }
  }
  if (env.WHATSAPP_PROVIDER === "twilio") {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required when WHATSAPP_PROVIDER=twilio" });
      }
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
