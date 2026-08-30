import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingWhatsAppMessage } from "@afrotune/core";

/**
 * Meta signs every webhook POST body with the app secret via
 * X-Hub-Signature-256. Verifying this stops anyone who guesses the webhook
 * URL from injecting fake messages/events.
 */
export function verifyMetaSignature(params: {
  appSecret: string;
  signatureHeader: string | undefined;
  rawBody: Buffer;
}): boolean {
  if (!params.signatureHeader) return false;
  const expected =
    "sha256=" + createHmac("sha256", params.appSecret).update(params.rawBody).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(params.signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parses a Meta WhatsApp webhook payload into a flat list of inbound
 * messages, ignoring status/delivery callbacks. Meta's `from` is already the
 * canonical bare-digit phone number format used across the app.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractIncomingMessages(payload: any): IncomingWhatsAppMessage[] {
  const messages: IncomingWhatsAppMessage[] = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      for (const msg of value?.messages ?? []) {
        if (msg.type === "text") {
          messages.push({
            from: msg.from,
            messageId: msg.id,
            timestamp: msg.timestamp,
            type: "text",
            text: msg.text?.body,
          });
        } else if (msg.type === "interactive") {
          const replyId =
            msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
          messages.push({
            from: msg.from,
            messageId: msg.id,
            timestamp: msg.timestamp,
            type: "interactive",
            interactiveReplyId: replyId,
            text: msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title,
          });
        } else if (msg.type === "button") {
          messages.push({
            from: msg.from,
            messageId: msg.id,
            timestamp: msg.timestamp,
            type: "button",
            interactiveReplyId: msg.button?.payload,
            text: msg.button?.text,
          });
        } else {
          messages.push({
            from: msg.from,
            messageId: msg.id,
            timestamp: msg.timestamp,
            type: "other",
          });
        }
      }
    }
  }

  return messages;
}
