import { z } from "zod";

const BaseEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),

  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_MUSIC_BUCKET: z.string().default("afrotune-music"),

  WHATSAPP_PROVIDER: z.enum(["meta", "twilio", "console"]).default("meta"),

  // ---- Meta (required only when WHATSAPP_PROVIDER=meta) ----
  META_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  // ---- Twilio (required only when WHATSAPP_PROVIDER=twilio) ----
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // The exact public URL Twilio is configured to POST to for this route -
  // required to verify X-Twilio-Signature (see packages/providers/src/whatsapp/twilioWebhook.ts).
  TWILIO_WEBHOOK_URL: z.string().optional(),

  PAYSTACK_SECRET_KEY: z.string().min(1),

  REDIS_URL: z.string().min(1),

  APP_URL: z.string().min(1),
});

const EnvSchema = BaseEnvSchema.superRefine((env, ctx) => {
  if (env.WHATSAPP_PROVIDER === "meta") {
    for (const key of ["META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required when WHATSAPP_PROVIDER=meta" });
      }
    }
  }
  if (env.WHATSAPP_PROVIDER === "twilio") {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WEBHOOK_URL"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required when WHATSAPP_PROVIDER=twilio" });
      }
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Fails fast at boot if required configuration is missing, rather than at first use. */
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
