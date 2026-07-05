-- AeroBrain — Supabase schema (free tier: PostGIS spatial + pgvector semantic).
-- Metadata mirror ONLY. Media (video/photos/models) stays on the Mac vault via
-- Cloudflare Tunnel — never in Supabase (1GB storage / 5GB egress free limits).
-- Idempotent: safe to re-run.

create extension if not exists postgis;
create extension if not exists vector;

-- ---------- flights ----------
create table if not exists flights (
  clip_id text primary key,
  date date,
  "time" text,
  tier text,
  duration_s real,
  resolution text,
  fps real,
  size_bytes bigint,
  has_srt boolean,
  has_proxy boolean,
  label text,
  archived boolean default false,
  raw_rel text,
  frame_count int,
  stats jsonb,
  ai jsonb,
  home geography(point, 4326),
  footprint geography(polygon, 4326),
  updated_at timestamptz default now()
);

-- deriva geometría PostGIS desde el jsonb stats (así el sync sólo manda JSON)
create or replace function flights_geo() returns trigger as $$
begin
  if new.stats ? 'home' then
    new.home := st_setsrid(st_makepoint(
      (new.stats->'home'->>0)::float, (new.stats->'home'->>1)::float), 4326)::geography;
  end if;
  if new.stats ? 'bbox' then
    new.footprint := st_makeenvelope(
      (new.stats->'bbox'->>0)::float, (new.stats->'bbox'->>1)::float,
      (new.stats->'bbox'->>2)::float, (new.stats->'bbox'->>3)::float, 4326)::geography;
  end if;
  new.updated_at := now();
  return new;
end$$ language plpgsql;

drop trigger if exists trg_flights_geo on flights;
create trigger trg_flights_geo before insert or update on flights
  for each row execute function flights_geo();

create index if not exists flights_home_gix on flights using gist (home);
create index if not exists flights_footprint_gix on flights using gist (footprint);
create index if not exists flights_date_ix on flights (date desc);

-- ---------- tracks (GPS 1Hz) ----------
create table if not exists tracks (
  clip_id text primary key references flights(clip_id) on delete cascade,
  points jsonb,
  line geography(linestring, 4326)
);
create or replace function tracks_geo() returns trigger as $$
declare pts text;
begin
  if new.points is not null and jsonb_array_length(new.points) > 1 then
    select string_agg(format('%s %s', (p->>'lon'), (p->>'lat')), ',')
      into pts from jsonb_array_elements(new.points) p;
    new.line := st_geogfromtext('SRID=4326;LINESTRING(' || pts || ')');
  end if;
  return new;
end$$ language plpgsql;
drop trigger if exists trg_tracks_geo on tracks;
create trigger trg_tracks_geo before insert or update on tracks
  for each row execute function tracks_geo();
create index if not exists tracks_line_gix on tracks using gist (line);

-- ---------- AI analysis + embedding ----------
create table if not exists ai_analysis (
  clip_id text primary key references flights(clip_id) on delete cascade,
  summary text,
  scene_type text,
  tags text[],
  travel_score int,
  deep boolean,
  highlights jsonb,
  data jsonb,
  embedding vector(1536)  -- OpenAI text-embedding-3-small
);
create index if not exists ai_embedding_hnsw on ai_analysis
  using hnsw (embedding vector_cosine_ops);

-- ---------- 3D models ----------
create table if not exists models (
  clip_id text primary key references flights(clip_id) on delete cascade,
  qa jsonb,
  corners jsonb,
  dsm_min real,
  dsm_max real,
  has_dsm boolean,
  meta jsonb
);

-- ---------- properties (public sale pages) ----------
create table if not exists properties (
  slug text primary key,
  titulo text,
  precio text,
  ubicacion text,
  data jsonb,
  updated_at timestamptz default now()
);

-- ---------- RLS + grants: público lee catálogo, sólo service_role escribe ----------
-- (el catálogo ya es público en vuelos.metislab.work/data — misma exposición)
do $$ declare t text;
begin
  foreach t in array array['flights','tracks','ai_analysis','models','properties'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists pub_read on %I', t);
    execute format('create policy pub_read on %I for select using (true)', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;

-- ---------- RPCs ----------
-- búsqueda semántica: vuelos más parecidos a un embedding de consulta
create or replace function match_flights(query vector(1536), k int default 10)
returns table(clip_id text, summary text, scene_type text, score float)
language sql stable as $$
  select a.clip_id, a.summary, a.scene_type,
         1 - (a.embedding <=> query) as score
  from ai_analysis a
  where a.embedding is not null
  order by a.embedding <=> query
  limit least(greatest(k, 1), 50);
$$;

-- vuelos que cubren un punto (lon,lat) — consulta espacial PostGIS
create or replace function flights_covering(lon float, lat float)
returns setof flights language sql stable as $$
  select * from flights
  where footprint is not null
    and st_intersects(footprint, st_setsrid(st_makepoint(lon, lat), 4326)::geography)
  order by date desc;
$$;

-- pares de vuelos que se solapan espacialmente (candidatos multi-fecha)
create or replace function overlapping_flights(target text)
returns table(clip_id text, date date, overlap_pct float)
language sql stable as $$
  select f.clip_id, f.date,
         round((st_area(st_intersection(f.footprint::geometry, t.footprint::geometry))
                / nullif(st_area(t.footprint::geometry), 0) * 100)::numeric, 1)::float
  from flights f
  join models m on m.clip_id = f.clip_id and m.has_dsm is true,
       flights t
  join models tm on tm.clip_id = t.clip_id and tm.has_dsm is true
  where t.clip_id = target and f.clip_id <> target
    and f.footprint is not null and t.footprint is not null
    and st_intersects(f.footprint, t.footprint)
  order by 3 desc;
$$;

grant execute on function match_flights(vector, int) to anon, authenticated, service_role;
grant execute on function flights_covering(float, float) to anon, authenticated, service_role;
grant execute on function overlapping_flights(text) to anon, authenticated, service_role;
