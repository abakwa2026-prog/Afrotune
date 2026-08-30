import "./loadRootEnv.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";
import { loadEnv } from "./env.js";
import { registerWhatsAppWebhook } from "./routes/whatsappWebhook.js";
import { registerTwilioWebhook } from "./routes/twilioWebhook.js";
import { registerDevMessagesRoute } from "./routes/devMessages.js";
import { registerPaystackWebhook } from "./routes/paystackWebhook.js";
import { registerSongsRoutes } from "./routes/songs.js";
import { registerPaymentsRoutes } from "./routes/payments.js";
import { registerHealthRoutes } from "./routes/health.js";

const env = loadEnv();

const app = Fastify({ logger: true });

// Webhook routes need the raw request body (for HMAC signature verification)
// before JSON parsing, so we capture it and still hand back parsed JSON.
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try {
      const json = body.length ? JSON.parse(body.toString("utf8")) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

// Twilio posts application/x-www-form-urlencoded, not JSON. Its signature
// verification is computed over the parsed params (not raw bytes), so the
// default formbody parser is sufficient - no raw-body capture needed here.
await app.register(formbody);

await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

registerHealthRoutes(app);

// Exactly one WhatsApp transport is active at a time, selected by
// WHATSAPP_PROVIDER - see packages/core/src/whatsappProvider.ts for why this
// is safe to switch purely through configuration.
if (env.WHATSAPP_PROVIDER === "twilio") {
  registerTwilioWebhook(app, env);
} else if (env.WHATSAPP_PROVIDER === "console") {
  registerDevMessagesRoute(app, env);
} else {
  registerWhatsAppWebhook(app, env);
}

registerPaystackWebhook(app, env);
registerSongsRoutes(app, env);
registerPaymentsRoutes(app, env);

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`AfroTune API listening on :${env.PORT} (whatsapp provider: ${env.WHATSAPP_PROVIDER})`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
