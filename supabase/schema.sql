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
  output_filename text
);

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
