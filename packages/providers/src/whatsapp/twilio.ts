import Twilio from "twilio";
import type { WhatsAppMessagingProvider } from "@afrotune/core";

/**
 * Twilio WhatsApp Sandbox implementation of WhatsAppMessagingProvider - a
 * development-time stand-in for Meta WhatsApp Cloud API while Meta app
 * verification is pending. Docs:
 * https://www.twilio.com/docs/whatsapp/api
 * https://www.twilio.com/docs/whatsapp/sandbox
 *
 * Twilio addresses are "whatsapp:+<E.164>"; the rest of AfroTune stores and
 * passes around the canonical bare-digit phone number (see
 * packages/core/src/whatsappProvider.ts), so this class is the only place
 * that adds/removes the "whatsapp:+" wrapper.
 *
 * The Sandbox has no equivalent of Meta's tappable interactive buttons
 * without pre-approved Content Templates, so sendButtons/sendCtaUrl degrade
 * to plain text - the conversation still completes because the LLM already
 * interprets free-text replies like "yes" or "1".
 */

export interface TwilioWhatsAppClientOptions {
  accountSid: string;
  authToken: string;
  /** Already in "whatsapp:+1..." form, e.g. the Sandbox number. */
  fromWhatsAppAddress: string;
}

export class TwilioWhatsAppClient implements WhatsAppMessagingProvider {
  readonly name = "twilio";
  private client: ReturnType<typeof Twilio>;
  private from: string;

  constructor(opts: TwilioWhatsAppClientOptions) {
    this.client = Twilio(opts.accountSid, opts.authToken);
    this.from = opts.fromWhatsAppAddress;
  }

  async sendText(to: string, body: string): Promise<void> {
    await this.client.messages.create({ from: this.from, to: toTwilioAddress(to), body });
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
  ): Promise<void> {
    const options = buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    await this.sendText(to, `${bodyText}\n\n${options}\n\nReply with the number or word of your choice.`);
  }

  async sendList(
    to: string,
    bodyText: string,
    _buttonLabel: string,
    sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[],
  ): Promise<void> {
    const rows = sections.flatMap((s) => s.rows);
    const options = rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n");
    await this.sendText(to, `${bodyText}\n\n${options}\n\nReply with the number or word of your choice.`);
  }

  async sendCtaUrl(to: string, bodyText: string, buttonText: string, url: string): Promise<void> {
    await this.sendText(to, `${bodyText}\n\n${buttonText}: ${url}`);
  }

  async sendAudioLink(to: string, audioUrl: string): Promise<void> {
    await this.client.messages.create({
      from: this.from,
      to: toTwilioAddress(to),
      mediaUrl: [audioUrl],
    });
  }

  async sendDocumentLink(to: string, url: string, filename: string): Promise<void> {
    await this.client.messages.create({
      from: this.from,
      to: toTwilioAddress(to),
      body: filename,
      mediaUrl: [url],
    });
  }
}

function toTwilioAddress(canonicalPhone: string): string {
  return `whatsapp:+${canonicalPhone.replace(/^\+/, "")}`;
}
