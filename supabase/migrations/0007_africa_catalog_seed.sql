-- Production catalog data for AfroTune's Africa-wide expansion beyond
-- Nigeria. Unlike supabase/seed.sql (Nigeria-only, dev/placeholder data not
-- applied to production), this migration is meant to run against the real
-- project so the guided country/genre/language flow works for these markets.
--
-- Credit pack pricing for the new countries is NOT invented here - see the
-- TODO-flagged, is_active=false placeholder rows near the end of this file.

insert into countries (code, name, currency_code) values
  ('CM', 'Cameroon', 'XAF'),
  ('GH', 'Ghana', 'GHS'),
  ('KE', 'Kenya', 'KES')
on conflict (code) do nothing;

insert into languages (code, name) values
  ('fr', 'French'),
  ('dua', 'Duala'),
  ('bas', 'Bassa'),
  ('tw', 'Twi'),
  ('sw', 'Swahili')
on conflict (code) do nothing;

-- ==================================================
-- GENRES
-- ==================================================

insert into genres (country_id, name, description)
select c.id, g.name, g.description
from countries c
cross join (values
  ('Makossa', 'Cameroonian urban dance genre built on syncopated bass lines and brass, popularized from the 1950s onward.'),
  ('Bikutsi', 'Fast, percussive Cameroonian genre rooted in Beti traditional rhythms, driven by balafon and heavy bass.'),
  ('Assiko', 'Upbeat Cameroonian coastal genre known for its rapid guitar picking and scraper-driven percussion.'),
  ('Bend Skin', 'Cameroonian genre originating among the Bamileke, played on tam-tams and improvised percussion.')
) as g(name, description)
where c.code = 'CM'
on conflict (country_id, name) do nothing;

insert into genres (country_id, name, description)
select c.id, g.name, g.description
from countries c
cross join (values
  ('Highlife', 'Ghanaian genre built on guitar-led melodies and horn sections, a direct ancestor of much of West African popular music.'),
  ('Afrobeats', 'Contemporary Ghanaian popular music blending West African rhythms with hip-hop, R&B and dancehall influences.'),
  ('Hiplife', 'Ghanaian fusion of Highlife melodies with hip-hop-style rap delivery, emerging in the 1990s.')
) as g(name, description)
where c.code = 'GH'
on conflict (country_id, name) do nothing;

insert into genres (country_id, name, description)
select c.id, g.name, g.description
from countries c
cross join (values
  ('Afro Gospel', 'Kenyan contemporary gospel music blending Christian worship themes with Afrobeats/pop production.'),
  ('Benga', 'Kenyan genre built around fast, fingerpicked guitar lines, rooted in Luo traditional string music.'),
  ('Gengetone', 'Kenyan urban genre driven by raw, sample-based beats and Sheng-language rap, emerging from Nairobi.')
) as g(name, description)
where c.code = 'KE'
on conflict (country_id, name) do nothing;

-- ==================================================
-- COUNTRY <-> LANGUAGE RELEVANCE
-- ==================================================

-- Nigeria's existing languages (seed.sql) had no country relationship at
-- all until now - wire that up alongside the new countries.
insert into country_languages (country_id, language_id, is_primary)
select c.id, l.id, cl.is_primary
from countries c
cross join (values
  ('en', true),
  ('pcm', false),
  ('yo', false),
  ('ig', false),
  ('ha', false)
) as cl(lang_code, is_primary)
join languages l on l.code = cl.lang_code
where c.code = 'NG'
on conflict (country_id, language_id) do nothing;

insert into country_languages (country_id, language_id, is_primary)
select c.id, l.id, cl.is_primary
from countries c
cross join (values
  ('fr', true),
  ('en', false),
  ('dua', false),
  ('bas', false)
) as cl(lang_code, is_primary)
join languages l on l.code = cl.lang_code
where c.code = 'CM'
on conflict (country_id, language_id) do nothing;

insert into country_languages (country_id, language_id, is_primary)
select c.id, l.id, cl.is_primary
from countries c
cross join (values
  ('en', true),
  ('tw', false)
) as cl(lang_code, is_primary)
join languages l on l.code = cl.lang_code
where c.code = 'GH'
on conflict (country_id, language_id) do nothing;

insert into country_languages (country_id, language_id, is_primary)
select c.id, l.id, cl.is_primary
from countries c
cross join (values
  ('en', true),
  ('sw', false)
) as cl(lang_code, is_primary)
join languages l on l.code = cl.lang_code
where c.code = 'KE'
on conflict (country_id, language_id) do nothing;

-- ==================================================
-- PRICING (placeholder - do not enable until real numbers are supplied)
-- ==================================================

-- TODO: replace with real pricing before enabling in this market (see supabase/migrations/0007_africa_catalog_seed.sql)
insert into pricing_rules (country_id, credits_per_song, is_active)
select id, 1, false from countries where code in ('CM', 'GH', 'KE')
on conflict do nothing;

-- TODO: replace with real pricing before enabling in this market (see supabase/migrations/0007_africa_catalog_seed.sql)
insert into credit_packs (country_id, credits, price_minor_units, currency_code, is_active, sort_order)
select c.id, 1, 0, c.currency_code, false, 0
from countries c
where c.code in ('CM', 'GH', 'KE')
on conflict do nothing;
