import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyTwilioSignature, extractIncomingMessageFromTwilio } from "@afrotune/providers";
import { getSupabaseServiceClient, recordWebhookEventIfNew } from "@afrotune/db";
import { getIncomingMessageQueue } from "@afrotune/queue";
import type { Env } from "../env.js";

/**
 * Twilio WhatsApp Sandbox webhook. Mirrors registerWhatsAppWebhook's
 * contract (verify -> dedupe -> enqueue -> ack fast) but Twilio's request
 * shape and signing mechanism are genuinely different from Meta's, so this
 * is a separate parser/verifier rather than a branch inside the Meta route.
 * Both funnel into the same @afrotune/queue incoming-message job, so
 * everything downstream (conversation, Song Brief, generation) is identical
 * regardless of which one is active.
 */
export function registerTwilioWebhook(app: FastifyInstance, env: Env) {
  const db = getSupabaseServiceClient();
  const queue = getIncomingMessageQueue();

  app.post("/webhooks/whatsapp/twilio", async (request: FastifyRequest, reply) => {
    const formParams = request.body as Record<string, string>;
    const signature = request.headers["x-twilio-signature"] as string | undefined;

    const valid = verifyTwilioSignature({
      authToken: env.TWILIO_AUTH_TOKEN!,
      signatureHeader: signature,
      url: env.TWILIO_WEBHOOK_URL!,
      formParams,
    });

    if (!valid) {
      request.log.warn("Rejected Twilio webhook with invalid signature");
      return reply.status(403).send();
    }

    const message = extractIncomingMessageFromTwilio(formParams);
    if (!message) return reply.status(200).send();

    const isNew = await recordWebhookEventIfNew(db, {
      source: "twilio",
      eventId: message.messageId,
      payload: formParams,
    });

    if (isNew) {
      await queue.add("incoming-message", {
        whatsappPhoneNumber: message.from,
        messageId: message.messageId,
        text: message.text ?? "",
        interactiveReplyId: message.interactiveReplyId,
      });
    }

    // Empty 200 is sufficient - Twilio only requires 2xx to consider the
    // webhook delivered; it doesn't need a TwiML reply since AfroTune sends
    // its responses asynchronously via the REST API from apps/worker.
    return reply.status(200).send();
  });
}
