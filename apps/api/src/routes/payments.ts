import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getSupabaseServiceClient,
  findOrCreateUserByPhone,
  getActiveCreditPacks,
  findCountryByCode,
  createPendingPayment,
  getPaymentByReference,
} from "@afrotune/db";
import { PaystackClient } from "@afrotune/providers";
import type { Env } from "../env.js";

const InitializeBody = z.object({
  whatsappPhoneNumber: z.string().min(8),
  creditPackId: z.string().uuid(),
});

export function registerPaymentsRoutes(app: FastifyInstance, env: Env) {
  const db = getSupabaseServiceClient();
  const paystack = new PaystackClient({ secretKey: env.PAYSTACK_SECRET_KEY });

  app.get("/api/credit-packs", async (request) => {
    const query = request.query as { country?: string };
    let countryId: string | undefined;
    if (query.country) {
      const country = await findCountryByCode(db, query.country);
      countryId = country?.id;
    }
    const packs = await getActiveCreditPacks(db, countryId);
    return { packs };
  });

  app.post("/api/payments/initialize", async (request, reply) => {
    const parsed = InitializeBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });

    const { whatsappPhoneNumber, creditPackId } = parsed.data;
    const user = await findOrCreateUserByPhone(db, whatsappPhoneNumber);

    const { data: pack, error } = await db
      .from("credit_packs")
      .select("*")
      .eq("id", creditPackId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!pack) return reply.status(404).send({ error: "credit_pack_not_found" });

    const reference = `afrotune_${randomUUID()}`;

    await createPendingPayment(db, {
      userId: user.id,
      providerReference: reference,
      creditPackId: pack.id,
      credits: pack.credits,
      amountMinorUnits: pack.price_minor_units,
      currencyCode: pack.currency_code,
    });

    // Paystack requires an email; WhatsApp users don't have one, so we use a
    // deterministic placeholder tied to their phone number. Paystack never
    // emails this address for anything user-facing in this flow.
    const result = await paystack.initializeTransaction({
      email: `${whatsappPhoneNumber}@users.afrotune.app`,
      amountMinorUnits: pack.price_minor_units,
      currencyCode: pack.currency_code,
      reference,
      metadata: { userId: user.id, creditPackId: pack.id },
      callbackUrl: `${env.APP_URL}/pay/complete?reference=${reference}`,
    });

    return {
      authorizationUrl: result.authorizationUrl,
      reference: result.reference,
    };
  });

  app.get("/api/payments/:reference/status", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const payment = await getPaymentByReference(db, reference);
    if (!payment) return reply.status(404).send({ error: "not_found" });
    return { status: payment.status, credits: payment.credits };
  });
}
