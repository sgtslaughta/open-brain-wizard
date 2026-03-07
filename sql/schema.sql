-- open-brain-wizard: database schema for Supabase
-- Safe to re-run — all statements are idempotent.
-- Enable pgvector first via Database -> Extensions -> vector.

-- Enable vector extension (if not already enabled via dashboard)
create extension if not exists vector;

-- Create the thoughts table
create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast vector similarity search
create index if not exists thoughts_embedding_idx on thoughts
  using hnsw (embedding vector_cosine_ops);

-- Index for filtering by metadata fields
create index if not exists thoughts_metadata_idx on thoughts using gin (metadata);

-- Index for date range queries
create index if not exists thoughts_created_at_idx on thoughts (created_at desc);

-- Auto-update the updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists thoughts_updated_at on thoughts;
create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();

-- Semantic search function
create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Enable Row Level Security
alter table thoughts enable row level security;

-- Service role full access only
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'thoughts' and policyname = 'Service role full access'
  ) then
    create policy "Service role full access"
      on thoughts for all
      using (auth.role() = 'service_role');
  end if;
end;
$$;
