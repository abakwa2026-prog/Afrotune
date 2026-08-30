import type { SupabaseClient } from "@supabase/supabase-js";

export interface PaymentRow {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  credit_pack_id: string | null;
  credits: number;
  amount_minor_units: number;
  currency_code: string;
  status: "pending" | "success" | "failed" | "abandoned";
  created_at: string;
  verified_at: string | null;
}

/** Called when initializing a Paystack transaction, before the user pays. */
export async function createPendingPayment(
  db: SupabaseClient,
  params: {
    userId: string;
    providerReference: string;
    creditPackId: string;
    credits: number;
    amountMinorUnits: number;
    currencyCode: string;
  },
): Promise<PaymentRow> {
  const { data, error } = await db
    .from("payments")
    .insert({
      user_id: params.userId,
      provider: "paystack",
      provider_reference: params.providerReference,
      credit_pack_id: params.creditPackId,
      credits: params.credits,
      amount_minor_units: params.amountMinorUnits,
      currency_code: params.currencyCode,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PaymentRow;
}

export async function getPaymentByReference(
  db: SupabaseClient,
  providerReference: string,
): Promise<PaymentRow | null> {
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("provider_reference", providerReference)
    .maybeSingle();
  if (error) throw error;
  return (data as PaymentRow) ?? null;
}

/** Only call after Paystack server-side verification succeeds. */
export async function markPaymentVerified(
  db: SupabaseClient,
  providerReference: string,
  rawPayload: unknown,
): Promise<void> {
  const { error } = await db
    .from("payments")
    .update({ status: "success", raw_payload: rawPayload, verified_at: new Date().toISOString() })
    .eq("provider_reference", providerReference);
  if (error) throw error;
}

export async function markPaymentFailed(
  db: SupabaseClient,
  providerReference: string,
  rawPayload: unknown,
): Promise<void> {
  const { error } = await db
    .from("payments")
    .update({ status: "failed", raw_payload: rawPayload })
    .eq("provider_reference", providerReference);
  if (error) throw error;
}
