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

-- ============================================================
-- Phase 1: Preference Learning System
-- ============================================================

-- Active learned preferences
create table if not exists preferences (
  id uuid default gen_random_uuid() primary key,
  category text not null check (category in ('coding_style','communication','workflow','tools','conventions')),
  key text not null,
  value text not null,
  confidence float default 1.0 check (confidence >= 0.0 and confidence <= 1.0),
  source text default 'explicit' check (source in ('explicit','inferred','confirmed')),
  context text,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint preferences_category_key_unique unique (category, key)
);

create index if not exists preferences_embedding_idx on preferences
  using hnsw (embedding vector_cosine_ops);
create index if not exists preferences_category_idx on preferences (category);
create index if not exists preferences_active_idx on preferences (active) where active = true;

drop trigger if exists preferences_updated_at on preferences;
create trigger preferences_updated_at
  before update on preferences
  for each row
  execute function update_updated_at();

-- Pending model-suggested preferences
create table if not exists preference_suggestions (
  id uuid default gen_random_uuid() primary key,
  category text not null check (category in ('coding_style','communication','workflow','tools','conventions')),
  key text not null,
  suggested_value text not null,
  reason text,
  session_context text,
  status text default 'pending' check (status in ('pending','accepted','rejected','deferred')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists preference_suggestions_status_idx on preference_suggestions (status);

drop trigger if exists preference_suggestions_updated_at on preference_suggestions;
create trigger preference_suggestions_updated_at
  before update on preference_suggestions
  for each row
  execute function update_updated_at();

-- Semantic search for preferences
create or replace function match_preferences(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  category text,
  key text,
  value text,
  confidence float,
  source text,
  context text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    p.id,
    p.category,
    p.key,
    p.value,
    p.confidence,
    p.source,
    p.context,
    p.metadata,
    1 - (p.embedding <=> query_embedding) as similarity,
    p.created_at
  from preferences p
  where p.active = true
    and 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- Phase 2: Project Registry & Cross-Project Knowledge
-- ============================================================

-- Registry of all repos
create table if not exists projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  repo_url text,
  project_url text,
  provider text check (provider is null or provider in ('gitlab','github','bitbucket','other')),
  description text,
  languages text[] default '{}',
  frameworks text[] default '{}',
  status text default 'active' check (status in ('active','archived','idea','paused')),
  local_path text,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists projects_embedding_idx on projects
  using hnsw (embedding vector_cosine_ops);
create index if not exists projects_status_idx on projects (status);
create index if not exists projects_name_idx on projects (name);

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at
  before update on projects
  for each row
  execute function update_updated_at();

-- Reusable patterns extracted from projects
create table if not exists project_patterns (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references projects(id) on delete cascade,
  pattern_type text not null check (pattern_type in ('architecture','deployment','testing','code_pattern','config')),
  title text not null,
  description text,
  code_snippet text,
  file_path text,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists project_patterns_embedding_idx on project_patterns
  using hnsw (embedding vector_cosine_ops);
create index if not exists project_patterns_project_id_idx on project_patterns (project_id);
create index if not exists project_patterns_type_idx on project_patterns (pattern_type);

-- Project lifecycle memory
create table if not exists project_context (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references projects(id) on delete cascade,
  entry_type text not null check (entry_type in ('milestone','task','bug','decision','note','architecture')),
  title text not null,
  content text,
  status text default 'open' check (status in ('open','in_progress','completed','resolved','wont_fix')),
  priority text default 'medium' check (priority in ('critical','high','medium','low')),
  tags text[] default '{}',
  related_entry_id uuid references project_context(id) on delete set null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists project_context_embedding_idx on project_context
  using hnsw (embedding vector_cosine_ops);
create index if not exists project_context_project_id_idx on project_context (project_id);
create index if not exists project_context_status_idx on project_context (status);
create index if not exists project_context_entry_type_idx on project_context (entry_type);
create index if not exists project_context_tags_idx on project_context using gin (tags);

drop trigger if exists project_context_updated_at on project_context;
create trigger project_context_updated_at
  before update on project_context
  for each row
  execute function update_updated_at();

-- Troubleshooting knowledge base
create table if not exists troubleshooting_log (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete set null,
  symptom text not null,
  root_cause text,
  resolution text,
  environment_context text,
  tags text[] default '{}',
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists troubleshooting_log_embedding_idx on troubleshooting_log
  using hnsw (embedding vector_cosine_ops);
create index if not exists troubleshooting_log_project_id_idx on troubleshooting_log (project_id);
create index if not exists troubleshooting_log_tags_idx on troubleshooting_log using gin (tags);

-- Semantic search for projects
create or replace function match_projects(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  name text,
  repo_url text,
  project_url text,
  provider text,
  description text,
  languages text[],
  frameworks text[],
  status text,
  local_path text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    p.id, p.name, p.repo_url, p.project_url, p.provider, p.description,
    p.languages, p.frameworks, p.status, p.local_path, p.metadata,
    1 - (p.embedding <=> query_embedding) as similarity,
    p.created_at
  from projects p
  where 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Semantic search for patterns
create or replace function match_patterns(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_project_id uuid default null
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  pattern_type text,
  title text,
  description text,
  code_snippet text,
  file_path text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    pp.id, pp.project_id, pr.name as project_name,
    pp.pattern_type, pp.title, pp.description, pp.code_snippet, pp.file_path,
    pp.metadata,
    1 - (pp.embedding <=> query_embedding) as similarity,
    pp.created_at
  from project_patterns pp
  join projects pr on pr.id = pp.project_id
  where 1 - (pp.embedding <=> query_embedding) > match_threshold
    and (filter_project_id is null or pp.project_id = filter_project_id)
  order by pp.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Semantic search for project context
create or replace function match_project_context(
  query_embedding vector(1536),
  filter_project_id uuid,
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  project_id uuid,
  entry_type text,
  title text,
  content text,
  status text,
  priority text,
  tags text[],
  related_entry_id uuid,
  metadata jsonb,
  similarity float,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    pc.id, pc.project_id, pc.entry_type, pc.title, pc.content,
    pc.status, pc.priority, pc.tags, pc.related_entry_id, pc.metadata,
    1 - (pc.embedding <=> query_embedding) as similarity,
    pc.created_at, pc.updated_at, pc.resolved_at
  from project_context pc
  where pc.project_id = filter_project_id
    and 1 - (pc.embedding <=> query_embedding) > match_threshold
  order by pc.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Semantic search for troubleshooting
create or replace function match_troubleshooting(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_project_id uuid default null
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  symptom text,
  root_cause text,
  resolution text,
  environment_context text,
  tags text[],
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    tl.id, tl.project_id, pr.name as project_name,
    tl.symptom, tl.root_cause, tl.resolution, tl.environment_context,
    tl.tags, tl.metadata,
    1 - (tl.embedding <=> query_embedding) as similarity,
    tl.created_at
  from troubleshooting_log tl
  left join projects pr on pr.id = tl.project_id
  where 1 - (tl.embedding <=> query_embedding) > match_threshold
    and (filter_project_id is null or tl.project_id = filter_project_id)
  order by tl.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- Phase 3: Environment Auto-Configuration
-- ============================================================

create table if not exists environment_configs (
  id uuid default gen_random_uuid() primary key,
  environment_name text not null default 'default',
  config_type text not null check (config_type in ('shell','editor','extension','package','dotfile','system')),
  name text not null,
  version text,
  config_content text,
  install_command text,
  platform text default 'all' check (platform in ('linux','macos','windows','all')),
  priority int default 100,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add environment_name column if upgrading from v1
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'environment_configs' and column_name = 'environment_name'
  ) then
    alter table environment_configs add column environment_name text not null default 'default';
  end if;
end $$;

create index if not exists environment_configs_env_idx on environment_configs (environment_name);
create index if not exists environment_configs_type_idx on environment_configs (config_type);
create index if not exists environment_configs_platform_idx on environment_configs (platform);

drop trigger if exists environment_configs_updated_at on environment_configs;
create trigger environment_configs_updated_at
  before update on environment_configs
  for each row
  execute function update_updated_at();

-- ============================================================
-- Phase 4a: Decision Journal
-- ============================================================

create table if not exists decisions (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  context text,
  decision text not null,
  alternatives jsonb default '[]'::jsonb,
  outcome text,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists decisions_embedding_idx on decisions
  using hnsw (embedding vector_cosine_ops);
create index if not exists decisions_project_id_idx on decisions (project_id);

drop trigger if exists decisions_updated_at on decisions;
create trigger decisions_updated_at
  before update on decisions
  for each row
  execute function update_updated_at();

create or replace function match_decisions(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_project_id uuid default null
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  title text,
  context text,
  decision text,
  alternatives jsonb,
  outcome text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    d.id, d.project_id, pr.name as project_name,
    d.title, d.context, d.decision, d.alternatives, d.outcome,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity,
    d.created_at
  from decisions d
  left join projects pr on pr.id = d.project_id
  where 1 - (d.embedding <=> query_embedding) > match_threshold
    and (filter_project_id is null or d.project_id = filter_project_id)
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- Phase 4b: Cross-Session Clipboard (Snippets)
-- ============================================================

create table if not exists snippets (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  tags text[] default '{}',
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists snippets_embedding_idx on snippets
  using hnsw (embedding vector_cosine_ops);
create index if not exists snippets_tags_idx on snippets using gin (tags);

create or replace function match_snippets(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  tags text[],
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    s.id, s.content, s.tags, s.metadata,
    1 - (s.embedding <=> query_embedding) as similarity,
    s.created_at
  from snippets s
  where 1 - (s.embedding <=> query_embedding) > match_threshold
  order by s.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- Phase 4c: Session Continuity
-- ============================================================

create table if not exists sessions (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete set null,
  branch text,
  objective text,
  status text default 'active' check (status in ('active','paused','completed')),
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists sessions_project_id_idx on sessions (project_id);
create index if not exists sessions_status_idx on sessions (status);

drop trigger if exists sessions_updated_at on sessions;
create trigger sessions_updated_at
  before update on sessions
  for each row
  execute function update_updated_at();

-- ============================================================
-- Phase 4d: Skill & Knowledge Tracker
-- ============================================================

create table if not exists skills (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  category text check (category in ('language','framework','tool','platform','concept')),
  proficiency text default 'beginner' check (proficiency in ('beginner','intermediate','advanced','expert')),
  last_used timestamptz default now(),
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists skills_category_idx on skills (category);

drop trigger if exists skills_updated_at on skills;
create trigger skills_updated_at
  before update on skills
  for each row
  execute function update_updated_at();

-- ============================================================
-- Phase 4e: People Graph
-- ============================================================

create table if not exists people (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  role text,
  context text,
  last_contact timestamptz,
  notes text,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists people_embedding_idx on people
  using hnsw (embedding vector_cosine_ops);
create index if not exists people_name_idx on people (name);

drop trigger if exists people_updated_at on people;
create trigger people_updated_at
  before update on people
  for each row
  execute function update_updated_at();

create or replace function match_people(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  name text,
  role text,
  context text,
  last_contact timestamptz,
  notes text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    p.id, p.name, p.role, p.context, p.last_contact, p.notes,
    p.metadata,
    1 - (p.embedding <=> query_embedding) as similarity,
    p.created_at
  from people p
  where 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- Row Level Security for all tables
-- ============================================================

-- Enable RLS on all tables
alter table thoughts enable row level security;
alter table preferences enable row level security;
alter table preference_suggestions enable row level security;
alter table projects enable row level security;
alter table project_patterns enable row level security;
alter table project_context enable row level security;
alter table troubleshooting_log enable row level security;
alter table environment_configs enable row level security;
alter table decisions enable row level security;
alter table snippets enable row level security;
alter table sessions enable row level security;
alter table skills enable row level security;
alter table people enable row level security;

-- Service role full access policies
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array[
    'thoughts','preferences','preference_suggestions','projects',
    'project_patterns','project_context','troubleshooting_log',
    'environment_configs','decisions','snippets','sessions','skills','people'
  ])
  loop
    if not exists (
      select 1 from pg_policies where tablename = tbl and policyname = 'Service role full access'
    ) then
      execute format(
        'create policy "Service role full access" on %I for all using (auth.role() = ''service_role'')',
        tbl
      );
    end if;
  end loop;
end;
$$;
