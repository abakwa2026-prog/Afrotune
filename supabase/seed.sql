-- Starter data-driven seed for the Nigeria validation market.
--
-- IMPORTANT: The product spec says a live Supabase project already contains
-- validated Nigerian country/genre/language/instrument data and that this
-- existing data should be the source of truth, not invented content. This
-- file was written WITHOUT access to that live project. Treat it as a
-- placeholder that lets the app run end-to-end locally, and replace it with
-- an export from the real project before going live. Cultural notes here are
-- intentionally kept structural/minimal rather than asserted as fact.

insert into countries (code, name, currency_code) values
  ('NG', 'Nigeria', 'NGN')
on conflict (code) do nothing;

insert into languages (code, name) values
  ('en', 'English'),
  ('yo', 'Yoruba'),
  ('ig', 'Igbo'),
  ('ha', 'Hausa'),
  ('pcm', 'Nigerian Pidgin')
on conflict (code) do nothing;

insert into genres (country_id, name, description)
select c.id, g.name, g.description
from countries c
cross join (values
  ('Afrobeats', 'Contemporary Nigerian popular music blending West African rhythms with hip-hop, R&B and dancehall influences.'),
  ('Highlife', 'Older Ghanaian/Nigerian genre built on guitar-led melodies and horn sections.'),
  ('Fuji', 'Yoruba percussion-driven genre rooted in Ajisari/Were music traditions.'),
  ('Juju', 'Yoruba genre built around talking drums and guitar, popularized mid-20th century.'),
  ('Apala', 'Yoruba percussion genre traditionally performed by Muslim Yoruba musicians.')
) as g(name, description)
where c.code = 'NG'
on conflict (country_id, name) do nothing;

insert into instruments (name, description) values
  ('Talking drum', 'Hourglass-shaped pitch-bending drum central to Yoruba music.'),
  ('Sekere', 'Beaded gourd shaker.'),
  ('Agidigbo', 'Box-resonated lamellophone used in Juju and Fuji.'),
  ('Highlife guitar', 'Melodic lead guitar style characteristic of Highlife.'),
  ('Horn section', 'Brass section used in Highlife and Afrobeat arrangements.')
on conflict (name) do nothing;

-- Credit packs (NGN, minor units = kobo). Update via product config, not code.
insert into credit_packs (country_id, credits, price_minor_units, currency_code, sort_order)
select c.id, pack.credits, pack.price_minor_units, 'NGN', pack.sort_order
from countries c
cross join (values
  (1, 250000, 1),   -- NGN 2,500
  (5, 1100000, 2),  -- NGN 11,000 (discounted per-song)
  (10, 2000000, 3), -- NGN 20,000
  (20, 3600000, 4)  -- NGN 36,000
) as pack(credits, price_minor_units, sort_order)
where c.code = 'NG';

insert into pricing_rules (country_id, credits_per_song)
select id, 1 from countries where code = 'NG';
