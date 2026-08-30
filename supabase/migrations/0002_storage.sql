-- Storage bucket for song audio. Private by default: the API issues short-lived
-- signed URLs for delivery rather than making the bucket public, since a phone
-- number tied to a real customer song should not be arbitrarily browsable.

-- on conflict DO UPDATE (not "do nothing") so that re-running this migration
-- against a project where the bucket was already created public (e.g. via
-- the dashboard, before this migration existed) still converges it private.
insert into storage.buckets (id, name, public)
values ('afrotune-music', 'afrotune-music', false)
on conflict (id) do update set public = false;

-- No storage.objects policies are added for anon/authenticated roles: all
-- reads/writes go through the service role key server-side (apps/api,
-- apps/worker), which bypasses storage RLS. Signed URLs are minted on demand
-- for delivery to WhatsApp / the song page.
