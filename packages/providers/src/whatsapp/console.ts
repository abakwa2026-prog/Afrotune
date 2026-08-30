import type { WhatsAppMessagingProvider } from "@afrotune/core";

/**
 * Prints outbound messages to stdout instead of calling a real WhatsApp
 * transport. Pairs with apps/api's /dev/messages route (WHATSAPP_PROVIDER=console)
 * to exercise the full conversation -> payment -> generation loop with no
 * WhatsApp account (Meta or Twilio) connected at all.
 */
export class ConsoleWhatsAppClient implements WhatsAppMessagingProvider {
  readonly name = "console";

  async sendText(to: string, body: string): Promise<void> {
    this.print(to, body);
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
  ): Promise<void> {
    const options = buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    this.print(to, `${bodyText}\n\n${options}\n\n(Reply with the number or word of your choice.)`);
  }

  async sendCtaUrl(to: string, bodyText: string, buttonText: string, url: string): Promise<void> {
    this.print(to, `${bodyText}\n\n${buttonText}: ${url}`);
  }

  async sendAudioLink(to: string, audioUrl: string): Promise<void> {
    this.print(to, `[audio] ${audioUrl}`);
  }

  async sendDocumentLink(to: string, url: string, filename: string): Promise<void> {
    this.print(to, `[document: ${filename}] ${url}`);
  }

  private print(to: string, body: string): void {
    // eslint-disable-next-line no-console
    console.log(`\n--- AfroTune -> ${to} ---\n${body}\n---------------------------------\n`);
  }
}
