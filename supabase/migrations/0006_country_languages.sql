-- Many-to-many relationship between countries and languages. A language can
-- be relevant to more than one country (e.g. English/French recur across
-- several African markets), so this is a join table rather than a country_id
-- FK on `languages` - mirrors the existing `genre_instruments` join table.

create table country_languages (
  country_id uuid not null references countries(id) on delete cascade,
  language_id uuid not null references languages(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (country_id, language_id)
);
