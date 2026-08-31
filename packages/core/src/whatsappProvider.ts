/**
 * Provider-agnostic contract for the WhatsApp messaging transport. Meta
 * WhatsApp Cloud API is the intended production implementation; Twilio
 * WhatsApp Sandbox is a development-time alternative while Meta app
 * verification is pending (see packages/providers/src/whatsapp/*). Every
 * caller in apps/api and apps/worker programs against this interface, never
 * against a concrete client - swapping WHATSAPP_PROVIDER changes which
 * implementation gets constructed (apps/worker/src/lib/providers.ts), not
 * conversation/payment/generation/delivery logic.
 *
 * `to` is always the canonical phone number - E.164 digits only, no leading
 * "+" and no provider-specific prefix (e.g. "2348012345678"). Each
 * implementation is responsible for translating to/from its own wire format
 * (Meta already uses this format natively; Twilio's "whatsapp:+..." prefix
 * is added/stripped at the provider boundary) so the same value can be
 * stored as `users.whatsapp_phone_number` regardless of which transport a
 * given message arrived through.
 */
export interface WhatsAppMessagingProvider {
  readonly name: string;

  sendText(to: string, body: string): Promise<void>;

  /**
   * Meta renders real tappable buttons. Providers that can't (e.g. Twilio
   * Sandbox without pre-approved Content Templates) should degrade
   * gracefully to a numbered plain-text list - the LLM already interprets
   * free-text replies like "yes" or "1", so the conversation still works
   * end to end, just without the tap affordance.
   */
  sendButtons(to: string, bodyText: string, buttons: { id: string; title: string }[]): Promise<void>;

  /**
   * Meta's interactive "list" message - for more than 3 options (Meta caps
   * real button messages at 3; a list message supports up to 10 rows across
   * sections instead, e.g. picking a country or genre). `buttonLabel` is the
   * text on the button that opens the list (Meta limit: 20 chars); row
   * `title` is capped at 24 chars, row `description` at 72. Providers
   * without a native list widget (e.g. Twilio Sandbox, the console dev
   * provider) should degrade the same way `sendButtons` does: flatten every
   * row into one numbered plain-text list.
   */
  sendList(
    to: string,
    bodyText: string,
    buttonLabel: string,
    sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[],
  ): Promise<void>;

  /** A short message plus a link. Providers without a native CTA widget just send the URL inline. */
  sendCtaUrl(to: string, bodyText: string, buttonText: string, url: string): Promise<void>;

  sendAudioLink(to: string, audioUrl: string): Promise<void>;

  sendDocumentLink(to: string, url: string, filename: string): Promise<void>;
}

export interface IncomingWhatsAppMessage {
  /** Canonical phone number - see WhatsAppMessagingProvider doc comment. */
  from: string;
  messageId: string;
  timestamp: string;
  type: "text" | "interactive" | "button" | "other";
  text?: string;
  interactiveReplyId?: string;
}
