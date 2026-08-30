import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Records an inbound webhook delivery. Returns false if this (source, eventId)
 * pair was already recorded, meaning the caller should ack and skip
 * reprocessing - Meta and Paystack both redeliver webhooks.
 */
export async function recordWebhookEventIfNew(
  db: SupabaseClient,
  params: { source: "meta" | "twilio" | "paystack"; eventId: string; payload: unknown },
): Promise<boolean> {
  const { error } = await db.from("webhook_events").insert({
    source: params.source,
    event_id: params.eventId,
    payload: params.payload,
  });

  if (error) {
    // Unique violation on (source, event_id) = duplicate delivery.
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

export async function markWebhookEventProcessed(
  db: SupabaseClient,
  params: { source: "meta" | "twilio" | "paystack"; eventId: string },
): Promise<void> {
  const { error } = await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("source", params.source)
    .eq("event_id", params.eventId);
  if (error) throw error;
}
