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

-- Calibration feedback loop: what we predicted vs. what actually happened on every closed lot.
create table if not exists spread_outcomes (
  lot_id bigint primary key,
  title text,
  category text,
  closed_at timestamptz,
  predicted_mid double precision,
  predicted_net double precision,
  confidence double precision,
  method text,
  score double precision,
  hammer double precision,
  landed_at_hammer double precision,
  sale_price double precision,
  sale_at timestamptz,
  recorded_at timestamptz default now(),
  data jsonb not null
);
create index if not exists spread_outcomes_closed on spread_outcomes (closed_at desc);
create index if not exists spread_outcomes_cat on spread_outcomes (category);

-- Liquidity feedback loop: how long your listings actually took, including the ones still sitting.
-- Safe to re-run; `add column if not exists` is a no-op on an already-migrated database.
alter table spread_outcomes add column if not exists listed_at timestamptz;
alter table spread_outcomes add column if not exists still_listed boolean;
alter table spread_outcomes add column if not exists predicted_days double precision;
create index if not exists spread_outcomes_listed on spread_outcomes (listed_at desc);

-- Valuations carry their lot's category so market trends can be grouped without a join.
alter table spread_valuations add column if not exists category text;
create index if not exists spread_valuations_created on spread_valuations (created_at desc);

-- The playbook: niches we hunt, with the market numbers that set each one's bid ceiling.
create table if not exists spread_theses (
  id text primary key,
  name text,
  family text,
  enabled boolean default true,
  origin text,
  price_median double precision,
  max_bid double precision,
  sold_90d integer,
  active_now integer,
  researched_at timestamptz,
  last_hunted_at timestamptz,
  updated_at timestamptz default now(),
  data jsonb not null
);
create index if not exists spread_theses_enabled on spread_theses (enabled, last_hunted_at);

-- Small key/value settings: the watchlist (lenses + custom instructions), and whatever comes next.
create table if not exists spread_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- People and the ledger: who has a key, what each of them did with each lot, and what it came to.
create table if not exists spread_users (
  id text primary key,
  name text not null,
  role text not null default 'partner',
  key_hash text not null unique,
  email text,
  share_pct double precision not null default 0,
  daily_budget_usd double precision not null default 1,
  active boolean not null default true,
  created_at timestamptz default now(),
  last_seen_at timestamptz,
  data jsonb not null
);
create table if not exists spread_events (
  id bigserial primary key,
  user_id text not null,
  lot_id bigint not null,
  kind text not null,
  amount double precision,
  at timestamptz not null default now(),
  note text default ''
);
create index if not exists spread_events_user on spread_events (user_id, at desc);
create index if not exists spread_events_lot on spread_events (lot_id);
create table if not exists spread_positions (
  user_id text not null,
  lot_id bigint not null,
  status text not null,
  closed_at timestamptz,
  won_at timestamptz,
  sale_at timestamptz,
  landed_cost double precision,
  sale_price double precision,
  updated_at timestamptz default now(),
  data jsonb not null,
  primary key (user_id, lot_id)
);
create index if not exists spread_positions_user on spread_positions (user_id, updated_at desc);
create index if not exists spread_positions_status on spread_positions (status);
