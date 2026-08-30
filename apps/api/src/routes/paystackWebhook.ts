import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyPaystackSignature } from "@afrotune/providers";
import { getSupabaseServiceClient, recordWebhookEventIfNew } from "@afrotune/db";
import { getPaymentVerificationQueue } from "@afrotune/queue";
import type { Env } from "../env.js";

export function registerPaystackWebhook(app: FastifyInstance, env: Env) {
  const db = getSupabaseServiceClient();
  const queue = getPaymentVerificationQueue();

  app.post("/webhooks/paystack", async (request: FastifyRequest, reply) => {
    const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
    const signature = request.headers["x-paystack-signature"] as string | undefined;

    const valid = verifyPaystackSignature({
      secretKey: env.PAYSTACK_SECRET_KEY,
      signatureHeader: signature,
      rawBody,
    });

    if (!valid) {
      request.log.warn("Rejected Paystack webhook with invalid signature");
      return reply.status(403).send();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = request.body as any;
    const event = body?.event as string | undefined;
    const reference = body?.data?.reference as string | undefined;

    if (!event || !reference) {
      return reply.status(200).send(); // acknowledge, nothing actionable
    }

    const eventId = `${event}:${reference}`;
    const isNew = await recordWebhookEventIfNew(db, { source: "paystack", eventId, payload: body });

    // Always ack 200 quickly. Verification of the actual payment status
    // happens server-side against Paystack's API in the worker, never
    // trusting this payload directly - webhooks only tell us to go check.
    if (isNew && event === "charge.success") {
      await queue.add("payment-verification", { provider: "paystack", reference });
    }

    return reply.status(200).send();
  });
}
