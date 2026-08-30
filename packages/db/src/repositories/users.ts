import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserRow {
  id: string;
  whatsapp_phone_number: string;
  display_name: string | null;
  country_id: string | null;
  preferred_language_id: string | null;
  preferred_genre_id: string | null;
  status: "active" | "blocked";
  referral_code: string;
  referred_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** WhatsApp phone number is the primary identity - find or create on first contact. */
export async function findOrCreateUserByPhone(
  db: SupabaseClient,
  phoneNumber: string,
  opts?: { displayName?: string; referredByCode?: string },
): Promise<UserRow> {
  const { data: existing, error: findError } = await db
    .from("users")
    .select("*")
    .eq("whatsapp_phone_number", phoneNumber)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing as UserRow;

  let referredByUserId: string | null = null;
  if (opts?.referredByCode) {
    const { data: referrer } = await db
      .from("users")
      .select("id")
      .eq("referral_code", opts.referredByCode)
      .maybeSingle();
    referredByUserId = referrer?.id ?? null;
  }

  const { data: created, error: insertError } = await db
    .from("users")
    .insert({
      whatsapp_phone_number: phoneNumber,
      display_name: opts?.displayName,
      referred_by_user_id: referredByUserId,
    })
    .select("*")
    .single();

  if (insertError) throw insertError;

  if (referredByUserId) {
    await db.from("referrals").insert({
      referrer_user_id: referredByUserId,
      referred_user_id: created.id,
      code: opts!.referredByCode!,
      status: "registered",
    });
  }

  return created as UserRow;
}

export async function getUserById(db: SupabaseClient, userId: string): Promise<UserRow | null> {
  const { data, error } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as UserRow) ?? null;
}

export async function updateUserPreferences(
  db: SupabaseClient,
  userId: string,
  patch: Partial<Pick<UserRow, "display_name" | "country_id" | "preferred_language_id" | "preferred_genre_id">>,
): Promise<void> {
  const { error } = await db.from("users").update(patch).eq("id", userId);
  if (error) throw error;
}
