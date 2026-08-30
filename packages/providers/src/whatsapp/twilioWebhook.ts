import Twilio from "twilio";
import type { IncomingWhatsAppMessage } from "@afrotune/core";

/**
 * Twilio signs webhook requests via the X-Twilio-Signature header, computed
 * over the exact webhook URL plus the sorted POST form parameters (not the
 * raw body bytes - a different mechanism from Meta/Paystack's HMAC-over-body
 * approach). `url` must be byte-for-byte the URL configured in the Twilio
 * console (TWILIO_WEBHOOK_URL), since that's what Twilio signed against.
 * Delegated to the official Twilio SDK helper rather than reimplemented, so
 * it always matches Twilio's actual algorithm.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(params: {
  authToken: string;
  signatureHeader: string | undefined;
  url: string;
  formParams: Record<string, string>;
}): boolean {
  if (!params.signatureHeader) return false;
  return Twilio.validateRequest(params.authToken, params.signatureHeader, params.url, params.formParams);
}

/**
 * Twilio's WhatsApp webhook posts application/x-www-form-urlencoded fields
 * (From, Body, MessageSid, ...), not Meta's nested JSON shape. The Sandbox
 * has no equivalent of Meta's interactive button replies, so every inbound
 * message is treated as freeform text - the LLM/keyword layer already
 * handles natural-language confirmations ("yes"), so this is not a feature
 * gap for the conversation loop.
 */
export function extractIncomingMessageFromTwilio(
  formParams: Record<string, string>,
): IncomingWhatsAppMessage | null {
  const from = formParams.From;
  const messageId = formParams.MessageSid;
  if (!from || !messageId) return null;

  return {
    from: normalizeTwilioAddress(from),
    messageId,
    timestamp: String(Date.now()),
    type: "text",
    text: formParams.Body ?? "",
  };
}

/** "whatsapp:+2348012345678" -> "2348012345678" (canonical form used across the app). */
function normalizeTwilioAddress(address: string): string {
  return address.replace(/^whatsapp:/, "").replace(/^\+/, "");
}
