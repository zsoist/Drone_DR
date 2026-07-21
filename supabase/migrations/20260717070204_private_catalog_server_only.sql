-- AeroBrain is a single-operator private application. Supabase is a server-side
-- metadata index, never a browser-facing public catalog. The secret key remains
-- on the Mac and maps to service_role; anon/authenticated receive no object access.

begin;

-- Close the schema itself and every existing Data API object. PostGIS was
-- installed in public on this project, so revoking only AeroBrain's three RPCs
-- would leave a large inherited function surface callable through PostgREST.
revoke create on schema public from public, anon, authenticated;
revoke usage on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'flights', 'tracks', 'ai_analysis', 'models', 'properties'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists pub_read on public.%I', table_name);
    execute format(
      'revoke all privileges on table public.%I from anon, authenticated',
      table_name
    );
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      table_name
    );
  end loop;
end
$$;

-- New public-schema objects must opt into Data API exposure explicitly.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
-- EXECUTE on new functions is granted to PUBLIC by PostgreSQL's global default.
-- A per-schema revoke cannot subtract that global grant, so revoke it globally.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

notify pgrst, 'reload schema';

commit;
