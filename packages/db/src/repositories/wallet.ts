import type { SupabaseClient } from "@supabase/supabase-js";

export type LedgerType = "purchase" | "generation" | "refund" | "referral_reward" | "admin_adjustment";

/**
 * The only sanctioned way to change a wallet balance. Atomic (DB function),
 * idempotent (unique idempotency_key). Safe to call more than once for the
 * same logical event - e.g. a retried Paystack webhook or a retried
 * generation-failure refund will not double-apply.
 */
export async function applyCreditLedgerEntry(
  db: SupabaseClient,
  params: {
    userId: string;
    amount: number; // positive = credit, negative = debit
    type: LedgerType;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ applied: boolean; balance: number }> {
  const { data, error } = await db.rpc("apply_credit_ledger_entry", {
    p_user_id: params.userId,
    p_amount: params.amount,
    p_type: params.type,
    p_reference_type: params.referenceType ?? null,
    p_reference_id: params.referenceId ?? null,
    p_idempotency_key: params.idempotencyKey,
    p_metadata: params.metadata ?? {},
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { applied: row.applied, balance: row.balance };
}

export async function getWalletBalance(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db
    .from("credit_wallets")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.balance ?? 0;
}

/**
 * Debit credits for a song generation. Uses a negative ledger amount guarded
 * by the credit_wallets.balance >= 0 check constraint, so a race between two
 * concurrent generations for the same under-funded user fails loudly instead
 * of going negative.
 */
export async function debitForGeneration(
  db: SupabaseClient,
  params: { userId: string; songRequestId: string; credits: number; idempotencyKey: string },
): Promise<{ applied: boolean; balance: number }> {
  return applyCreditLedgerEntry(db, {
    userId: params.userId,
    amount: -Math.abs(params.credits),
    type: "generation",
    referenceType: "song_request",
    referenceId: params.songRequestId,
    idempotencyKey: params.idempotencyKey,
  });
}

export async function refundForFailedGeneration(
  db: SupabaseClient,
  params: { userId: string; songRequestId: string; credits: number; idempotencyKey: string },
): Promise<{ applied: boolean; balance: number }> {
  return applyCreditLedgerEntry(db, {
    userId: params.userId,
    amount: Math.abs(params.credits),
    type: "refund",
    referenceType: "song_request",
    referenceId: params.songRequestId,
    idempotencyKey: params.idempotencyKey,
  });
}
