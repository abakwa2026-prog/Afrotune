import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyMetaSignature, extractIncomingMessages } from "@afrotune/providers";
import { getSupabaseServiceClient, recordWebhookEventIfNew } from "@afrotune/db";
import { getIncomingMessageQueue } from "@afrotune/queue";
import type { Env } from "../env.js";

/**
 * The single most important latency constraint in the product: this handler
 * must never block on the LLM, the music provider, or FFmpeg. It verifies
 * the request, deduplicates it, enqueues the real work, and returns.
 */
export function registerWhatsAppWebhook(app: FastifyInstance, env: Env) {
  const db = getSupabaseServiceClient();
  const queue = getIncomingMessageQueue();

  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send("Verification failed");
  });

  app.post("/webhooks/whatsapp", async (request: FastifyRequest, reply) => {
    const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
    const signature = request.headers["x-hub-signature-256"] as string | undefined;

    const valid = verifyMetaSignature({
      appSecret: env.META_APP_SECRET!,
      signatureHeader: signature,
      rawBody,
    });

    if (!valid) {
      request.log.warn("Rejected WhatsApp webhook with invalid signature");
      return reply.status(403).send();
    }

    // Ack immediately after verification; do the enqueue work but don't let
    // a slow Redis/DB hiccup turn into a Meta-visible timeout - we still
    // await it because it's fast (single insert + single queue push), but
    // nothing downstream (LLM, generation) ever happens inline here.
    const messages = extractIncomingMessages(request.body);
    request.log.info(
      { messageCount: messages.length },
      "[whatsapp:webhook] inbound webhook received",
    );

    for (const message of messages) {
      request.log.info(
        { from: message.from, messageId: message.messageId, type: message.type },
        "[whatsapp:webhook] inbound message extracted",
      );

      const isNew = await recordWebhookEventIfNew(db, {
        source: "meta",
        eventId: message.messageId,
        payload: message,
      });
      if (!isNew) {
        request.log.info(
          { messageId: message.messageId },
          "[whatsapp:webhook] duplicate delivery, skipping",
        );
        continue; // Meta redelivery - already queued once.
      }

      if (message.type === "text" || message.type === "interactive" || message.type === "button") {
        await queue.add("incoming-message", {
          whatsappPhoneNumber: message.from,
          messageId: message.messageId,
          text: message.text ?? "",
          interactiveReplyId: message.interactiveReplyId,
        });
        request.log.info(
          { from: message.from, messageId: message.messageId },
          "[whatsapp:webhook] enqueued for processing",
        );
      } else {
        request.log.info(
          { messageId: message.messageId, type: message.type },
          "[whatsapp:webhook] non-text message type, not enqueued",
        );
      }
    }

    return reply.status(200).send();
  });
}
