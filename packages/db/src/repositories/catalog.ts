import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenreContext } from "@afrotune/core";

export interface GenreRow {
  id: string;
  country_id: string | null;
  parent_genre_id: string | null;
  name: string;
  description: string | null;
  cultural_notes: Record<string, unknown>;
}

export async function findGenreByName(
  db: SupabaseClient,
  name: string,
  countryId?: string,
): Promise<GenreRow | null> {
  let query = db.from("genres").select("*").ilike("name", name).eq("is_active", true);
  if (countryId) query = query.eq("country_id", countryId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as GenreRow) ?? null;
}

export async function getGenreContext(db: SupabaseClient, genreId: string): Promise<GenreContext> {
  const { data: genre, error } = await db.from("genres").select("*").eq("id", genreId).single();
  if (error) throw error;

  const { data: instrumentRows, error: instrumentError } = await db
    .from("genre_instruments")
    .select("instruments(name)")
    .eq("genre_id", genreId);
  if (instrumentError) throw instrumentError;

  let parentGenreName: string | undefined;
  if (genre.parent_genre_id) {
    const { data: parent } = await db
      .from("genres")
      .select("name")
      .eq("id", genre.parent_genre_id)
      .maybeSingle();
    parentGenreName = parent?.name;
  }

  return {
    name: genre.name,
    description: genre.description ?? undefined,
    culturalNotes: genre.cultural_notes ?? {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instruments: (instrumentRows ?? []).map((r: any) => r.instruments?.name).filter(Boolean),
    parentGenreName,
  };
}

export async function findCountryByCode(db: SupabaseClient, code: string) {
  const { data, error } = await db
    .from("countries")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findLanguagesByCodes(db: SupabaseClient, codes: string[]) {
  if (codes.length === 0) return [];
  const { data, error } = await db.from("languages").select("*").in("code", codes);
  if (error) throw error;
  return data ?? [];
}

export async function getActiveCreditPacks(db: SupabaseClient, countryId?: string) {
  let query = db.from("credit_packs").select("*").eq("is_active", true).order("sort_order");
  if (countryId) query = query.eq("country_id", countryId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getPricingRuleForCountry(db: SupabaseClient, countryId?: string) {
  let query = db.from("pricing_rules").select("*").eq("is_active", true);
  query = countryId ? query.eq("country_id", countryId) : query.is("country_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? { credits_per_song: 1 };
}
