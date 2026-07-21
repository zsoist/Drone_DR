-- Close stale application-owned policy/function surfaces that predate the
-- server-only catalog boundary. Managed PostGIS/pgvector objects remain in
-- public on this legacy project, but anon/authenticated cannot resolve that
-- schema because the preceding migration revoked schema USAGE.

begin;

revoke create on schema public from public, anon, authenticated;
revoke usage on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

-- `rooms` is a retired prototype table. Keep its data, but remove the old
-- unrestricted CRUD policies so restoring a table grant cannot reopen it.
do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'rooms'
  loop
    execute format('drop policy %I on public.rooms', policy_name);
  end loop;

  if to_regclass('public.rooms') is not null then
    revoke all privileges on table public.rooms from anon, authenticated;
    grant select, insert, update, delete on table public.rooms to service_role;
  end if;
end
$$;

-- Fixed search paths prevent role-controlled name resolution. This loop is
-- intentionally limited to non-extension functions owned by the migration
-- role; managed extension ACLs are isolated at the schema boundary instead.
do $$
declare
  fn_signature text;
begin
  for fn_signature in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d
        on d.classid = 'pg_proc'::regclass
       and d.objid = p.oid
       and d.deptype = 'e'
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proowner = current_user::regrole
       and d.objid is null
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public',
      fn_signature
    );
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      fn_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      fn_signature
    );
  end loop;
end
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC unless the creating
-- role changes its global defaults. Keep both global and schema-specific
-- defaults closed for future application migrations.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

notify pgrst, 'reload schema';

commit;
