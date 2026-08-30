import {
  OpenAILLMProvider,
  ElevenLabsMusicProvider,
  MetaWhatsAppClient,
  TwilioWhatsAppClient,
  ConsoleWhatsAppClient,
  PaystackClient,
} from "@afrotune/providers";
import type { LLMProvider, MusicGenerationProvider, WhatsAppMessagingProvider } from "@afrotune/core";
import type { Env } from "../env.js";

/**
 * Central place picking concrete provider implementations from env config.
 * Swapping LLM_PROVIDER, MUSIC_PROVIDER or WHATSAPP_PROVIDER to a new value
 * means adding a case here and a new implementation in packages/providers -
 * nothing else in the worker (conversation logic, generation pipeline) needs
 * to change.
 */
export function getLLMProvider(env: Env): LLMProvider {
  switch (env.LLM_PROVIDER) {
    case "openai":
      return new OpenAILLMProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${env.LLM_PROVIDER}`);
  }
}

export function getMusicProvider(env: Env): MusicGenerationProvider {
  switch (env.MUSIC_PROVIDER) {
    case "elevenlabs":
      return new ElevenLabsMusicProvider({
        apiKey: env.ELEVENLABS_API_KEY,
        model: env.ELEVENLABS_MUSIC_MODEL,
      });
    default:
      throw new Error(`Unsupported MUSIC_PROVIDER: ${env.MUSIC_PROVIDER}`);
  }
}

export function getWhatsAppProvider(env: Env): WhatsAppMessagingProvider {
  switch (env.WHATSAPP_PROVIDER) {
    case "twilio":
      return new TwilioWhatsAppClient({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        fromWhatsAppAddress: env.TWILIO_WHATSAPP_FROM!,
      });
    case "meta":
      return new MetaWhatsAppClient({
        accessToken: env.WHATSAPP_ACCESS_TOKEN!,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
        apiVersion: env.WHATSAPP_API_VERSION,
      });
    case "console":
      return new ConsoleWhatsAppClient();
    default:
      throw new Error(`Unsupported WHATSAPP_PROVIDER: ${env.WHATSAPP_PROVIDER}`);
  }
}

export function getPaystackClient(env: Env): PaystackClient {
  return new PaystackClient({ secretKey: env.PAYSTACK_SECRET_KEY });
}
