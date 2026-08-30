import { Queue } from "bullmq";
import { getRedisConnection } from "./connection.js";

// BullMQ rejects ":" in queue names (it uses it internally as a Redis key
// separator), so these are hyphen-separated rather than the more common
// namespace:name convention.
export const QUEUE_NAMES = {
  incomingMessage: "afrotune-incoming-message",
  paymentVerification: "afrotune-payment-verification",
  generation: "afrotune-generation",
} as const;

export interface IncomingMessageJob {
  whatsappPhoneNumber: string;
  messageId: string;
  text: string;
  interactiveReplyId?: string;
}

export interface PaymentVerificationJob {
  provider: "paystack";
  reference: string;
}

export interface GenerationJob {
  songRequestId: string;
  songId: string;
  generationJobId: string;
}

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { age: 60 * 60 * 24 * 7 },
  removeOnFail: { age: 60 * 60 * 24 * 30 },
};

export function getIncomingMessageQueue() {
  return new Queue<IncomingMessageJob>(QUEUE_NAMES.incomingMessage, {
    connection: getRedisConnection(),
    // A conversational turn is not idempotent to replay wholesale - retrying
    // it re-runs the LLM call and can re-send WhatsApp messages the user
    // already received. Capped at 2 (one retry) rather than the default 5 so
    // a real failure surfaces quickly instead of quintupling LLM spend and
    // polluting conversation history. Full idempotent-turn handling (e.g. an
    // outbox pattern) is future hardening, not required to prove the loop.
    defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
  });
}

export function getPaymentVerificationQueue() {
  return new Queue<PaymentVerificationJob>(QUEUE_NAMES.paymentVerification, {
    connection: getRedisConnection(),
    defaultJobOptions,
  });
}

export function getGenerationQueue() {
  return new Queue<GenerationJob>(QUEUE_NAMES.generation, {
    connection: getRedisConnection(),
    defaultJobOptions: { ...defaultJobOptions, attempts: 3 },
  });
}
