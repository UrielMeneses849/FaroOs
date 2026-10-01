create table if not exists public.health_lab_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  study_kind text not null check (study_kind in ('insulin_resistance', 'blood_chemistry', 'other')),
  file_name text not null,
  storage_path text not null unique,
  notes text,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.health_lab_documents enable row level security;
create policy "Users manage their health lab documents" on public.health_lab_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('health-labs', 'health-labs', false)
on conflict (id) do update set public = false;
create policy "Users upload their health lab files" on storage.objects for insert to authenticated
  with check (bucket_id = 'health-labs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users read their health lab files" on storage.objects for select to authenticated
  using (bucket_id = 'health-labs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete their health lab files" on storage.objects for delete to authenticated
  using (bucket_id = 'health-labs' and (storage.foldername(name))[1] = auth.uid()::text);
