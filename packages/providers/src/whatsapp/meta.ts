import type { WhatsAppMessagingProvider } from "@afrotune/core";

/**
 * Thin wrapper around the Meta WhatsApp Cloud API (Graph API). Only the
 * message types AfroTune actually uses are implemented.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * `to` is the canonical phone number (bare E.164 digits, no "+") - this is
 * already Meta's native wire format, so no translation is needed here.
 */

export interface MetaWhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string; // e.g. "v20.0"
}

export class MetaWhatsAppClient implements WhatsAppMessagingProvider {
  readonly name = "meta";
  private baseUrl: string;

  constructor(private opts: MetaWhatsAppClientOptions) {
    this.baseUrl = `https://graph.facebook.com/${opts.apiVersion}/${opts.phoneNumberId}`;
  }

  async sendText(to: string, body: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    });
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
  ): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    });
  }

  async sendCtaUrl(to: string, bodyText: string, buttonText: string, url: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: bodyText },
        action: {
          name: "cta_url",
          parameters: { display_text: buttonText.slice(0, 20), url },
        },
      },
    });
  }

  async sendAudioLink(to: string, audioUrl: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { link: audioUrl },
    });
  }

  async sendDocumentLink(to: string, url: string, filename: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link: url, filename },
    });
  }

  async markRead(messageId: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async post(body: any): Promise<void> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new Error(`WhatsApp send failed: ${response.status} ${text}`);
    }
  }
}
