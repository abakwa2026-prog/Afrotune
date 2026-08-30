import type { Job } from "bullmq";
import {
  getSupabaseServiceClient,
  getPaymentByReference,
  markPaymentVerified,
  markPaymentFailed,
  applyCreditLedgerEntry,
  getUserById,
  findLatestAwaitingPaymentSongRequest,
} from "@afrotune/db";
import type { PaymentVerificationJob } from "@afrotune/queue";
import { getPaystackClient, getWhatsAppProvider } from "../lib/providers.js";
import { tryStartGeneration } from "../lib/generationStarter.js";
import { loadEnv } from "../env.js";

export async function processPaymentVerification(job: Job<PaymentVerificationJob>): Promise<void> {
  const env = loadEnv();
  const db = getSupabaseServiceClient();
  const paystack = getPaystackClient(env);
  const whatsapp = getWhatsAppProvider(env);
  const { reference } = job.data;

  const payment = await getPaymentByReference(db, reference);
  if (!payment) {
    // The webhook can race the row being written in the rare case a payment
    // is initiated and Paystack fires the event unusually fast. BullMQ will
    // retry this job with backoff, which gives the initializing request time
    // to land.
    throw new Error(`No payment record for reference ${reference} yet`);
  }

  // Already processed (webhook redelivery, or two verification jobs raced) - no-op.
  if (payment.status === "success") return;

  const verification = await paystack.verifyTransaction(reference);

  const user = await getUserById(db, payment.user_id);
  if (!user) throw new Error(`User ${payment.user_id} not found for payment ${reference}`);

  if (!verification.success) {
    await markPaymentFailed(db, reference, verification.raw);
    await whatsapp.sendText(
      user.whatsapp_phone_number,
      "Your payment did not go through. No credits were charged - feel free to try again.",
    );
    return;
  }

  await markPaymentVerified(db, reference, verification.raw);

  const { balance } = await applyCreditLedgerEntry(db, {
    userId: payment.user_id,
    amount: payment.credits,
    type: "purchase",
    referenceType: "payment",
    referenceId: payment.id,
    idempotencyKey: `purchase:${reference}`,
  });

  await whatsapp.sendText(
    user.whatsapp_phone_number,
    `Payment received! You now have ${balance} credit${balance === 1 ? "" : "s"}. 🎉`,
  );

  const pendingSongRequest = await findLatestAwaitingPaymentSongRequest(db, payment.user_id);
  if (pendingSongRequest) {
    const outcome = await tryStartGeneration(db, pendingSongRequest, env);
    if (outcome === "started") {
      await whatsapp.sendText(
        user.whatsapp_phone_number,
        "Creating your song now - I'll message you the moment it's ready. 🎶",
      );
    }
  }
}
