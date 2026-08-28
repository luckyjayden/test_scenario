-- Schema for the test-scenario-generator app.
-- Already applied to the Supabase project provisioned for this deliverable
-- (ddangyo-test-scenario-generator). Kept here so the project can be
-- recreated elsewhere, or the schema audited/extended later.

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_filename text not null,
  service_name text,
  screen_name text,
  status text not null default 'processing', -- processing | success | failed
  error_message text,
  scenario_count integer,
  step_count integer,
  source_pdf_path text,
  output_xlsx_path text,
  output_filename text,
  progress_current integer,
  progress_total integer
);

-- Added after initial provisioning (batched extraction progress tracking) —
-- kept as an explicit alter so re-running this file against the original
-- table (created before these columns existed) still picks them up.
alter table public.generations
  add column if not exists progress_current integer,
  add column if not exists progress_total integer;

-- Added for resumable per-batch extraction (app/api/generate processes one
-- OpenAI batch per request instead of the whole document in one call, so a
-- document of any page count stays well under Vercel's function duration
-- limit). Holds { service_name, screen_scope_name, stages } accumulated so
-- far across batches; cleared once the generation finishes.
alter table public.generations
  add column if not exists extraction_partial jsonb;

create index if not exists generations_created_at_idx on public.generations (created_at desc);

alter table public.generations enable row level security;

-- Single-user personal tool: allow full access with no per-row ownership
-- check. There is no end-user auth in this MVP. Tighten this (e.g. scope by
-- an authenticated user_id) before giving multiple people access.
create policy "allow all to anon" on public.generations
  for all
  using (true)
  with check (true);

-- Storage bucket for uploaded PDFs + generated xlsx files.
insert into storage.buckets (id, name, public)
values ('test-scenario-files', 'test-scenario-files', false)
on conflict (id) do nothing;

create policy "service role full access"
  on storage.objects for all
  using (bucket_id = 'test-scenario-files')
  with check (bucket_id = 'test-scenario-files');

-- 검수하기(Review) 기능 — 문구/디자인 검수 이력. Kept separate from
-- `generations` (different lifecycle/columns) rather than overloading that
-- table. Review uploads reuse the same `test-scenario-files` bucket under a
-- `review/<id>/...` key prefix, so no new bucket/storage policy is needed —
-- the policy above already grants full access to the whole bucket.
create table if not exists public.review_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  source_type text not null default 'upload', -- 'upload' | 'figma'
  source_filename text,
  figma_file_key text,
  figma_node_id text,

  tone_manner_input text,
  tone_manner_detected text,

  status text not null default 'processing', -- processing | success | failed
  error_message text,

  finding_count integer,
  layout_issue_count integer,

  result_json jsonb,
  source_file_path text,

  -- Resumable per-batch processing — same pattern as
  -- generations.progress_current/extraction_partial (see above), adopted
  -- from the start here to avoid the OOM/timeout issues that pattern was
  -- built to fix.
  progress_current integer,
  progress_total integer,
  review_partial jsonb,

  updated_at timestamptz not null default now()
);

create index if not exists review_runs_created_at_idx on public.review_runs (created_at desc);

alter table public.review_runs enable row level security;

create policy "allow all to anon" on public.review_runs
  for all
  using (true)
  with check (true);
