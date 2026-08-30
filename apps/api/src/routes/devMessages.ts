import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { getIncomingMessageQueue } from "@afrotune/queue";
import type { Env } from "../env.js";

/**
 * Local stand-in for the WhatsApp webhook so the conversation -> payment ->
 * generation loop can be exercised with no WhatsApp account (Meta or Twilio)
 * connected. Only registered when WHATSAPP_PROVIDER=console (see index.ts).
 *
 * Unlike the real webhooks, this skips webhook_events dedup: there is no
 * redelivery risk from a single manually-triggered local call, and adding a
 * 'dev' value to the webhook_source enum for a throwaway test route isn't
 * worth a migration.
 */
export function registerDevMessagesRoute(app: FastifyInstance, _env: Env) {
  const queue = getIncomingMessageQueue();

  app.post("/dev/messages", async (request, reply) => {
    const { phone, text } = (request.body ?? {}) as { phone?: string; text?: string };
    if (!phone || !text) {
      return reply.status(400).send({ error: "phone and text are required" });
    }

    const messageId = randomUUID();
    await queue.add("incoming-message", { whatsappPhoneNumber: phone, messageId, text });

    return reply.status(200).send({ ok: true, messageId });
  });
}
