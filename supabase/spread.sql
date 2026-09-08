-- Spread Hunter tables. Run once in the Supabase SQL editor (service-role access only; no RLS policies
-- are needed because the app talks to these tables with the service key from the server).

create table if not exists spread_lots (
  id bigint primary key,
  title text,
  category text,
  category_path text,
  auction_id bigint,
  ends_at timestamptz,
  high_bid double precision,
  min_bid double precision,
  bid_count integer default 0,
  is_closed boolean default false,
  fetched_at timestamptz,
  first_seen timestamptz default now(),
  alerted_at timestamptz,
  data jsonb not null
);
create index if not exists spread_lots_ends on spread_lots (ends_at);
create index if not exists spread_lots_cat on spread_lots (category);
create index if not exists spread_lots_closed on spread_lots (is_closed);

create table if not exists spread_valuations (
  lot_id bigint primary key,
  title_key text,
  low double precision,
  mid double precision,
  high double precision,
  confidence double precision,
  method text,
  cache_hit boolean default false,
  created_at timestamptz default now(),
  data jsonb not null
);
create index if not exists spread_valuations_created on spread_valuations (created_at);

create table if not exists spread_valuation_cache (
  title_key text primary key,
  created_at timestamptz default now(),
  data jsonb not null
);

create table if not exists spread_scans (
  id bigserial primary key,
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,
  trigger text,
  params jsonb,
  lots_seen integer default 0,
  lots_valued integer default 0,
  message text
);
