import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WebSocket as NodeWebSocket } from "ws";

// @supabase/supabase-js's realtime client requires a native `WebSocket` global,
// which Node only provides unflagged from v22+. Polyfill it here so this works
// regardless of the Node version the deploy platform actually picks - we don't
// use realtime subscriptions, but the client is constructed eagerly either way.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;
}

let serviceClient: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key. Must never be
 * imported from apps/web browser code - only from apps/api and apps/worker
 * server-side code.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only).",
    );
  }

  serviceClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
