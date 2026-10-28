-- Zerkalo Pyatigorsk: public catalog/reviews with a single authenticated owner.
-- Safe to re-run: tables and bucket are created idempotently; named policies are replaced.

create table if not exists public.zerkalo_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.zerkalo_works (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 90),
  description text not null check (length(btrim(description)) between 1 and 500),
  size text not null default '' check (length(size) <= 30),
  price integer not null check (price >= 0),
  image_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zerkalo_reviews (
  id uuid primary key default gen_random_uuid(),
  author text not null check (length(btrim(author)) between 1 and 80),
  text text not null check (length(btrim(text)) between 1 and 1200),
  date_label text not null default '' check (length(date_label) <= 50),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zerkalo_works_sort_order_idx on public.zerkalo_works (sort_order, created_at);
create index if not exists zerkalo_reviews_sort_order_idx on public.zerkalo_reviews (sort_order, created_at);

alter table public.zerkalo_owners enable row level security;
alter table public.zerkalo_works enable row level security;
alter table public.zerkalo_reviews enable row level security;

revoke all on table public.zerkalo_owners, public.zerkalo_works, public.zerkalo_reviews from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on table public.zerkalo_owners to authenticated;
grant select on table public.zerkalo_works to anon, authenticated;
grant select on table public.zerkalo_reviews to anon, authenticated;
grant insert, update, delete on table public.zerkalo_works to authenticated;
grant insert, update, delete on table public.zerkalo_reviews to authenticated;

drop policy if exists zerkalo_owners_read_self on public.zerkalo_owners;
create policy zerkalo_owners_read_self
  on public.zerkalo_owners for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists zerkalo_works_public_read on public.zerkalo_works;
create policy zerkalo_works_public_read
  on public.zerkalo_works for select to anon, authenticated
  using (true);

drop policy if exists zerkalo_works_owner_insert on public.zerkalo_works;
create policy zerkalo_works_owner_insert
  on public.zerkalo_works for insert to authenticated
  with check (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ));

drop policy if exists zerkalo_works_owner_update on public.zerkalo_works;
create policy zerkalo_works_owner_update
  on public.zerkalo_works for update to authenticated
  using (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ));

drop policy if exists zerkalo_works_owner_delete on public.zerkalo_works;
create policy zerkalo_works_owner_delete
  on public.zerkalo_works for delete to authenticated
  using (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ));

drop policy if exists zerkalo_reviews_public_read on public.zerkalo_reviews;
create policy zerkalo_reviews_public_read
  on public.zerkalo_reviews for select to anon, authenticated
  using (true);

drop policy if exists zerkalo_reviews_owner_insert on public.zerkalo_reviews;
create policy zerkalo_reviews_owner_insert
  on public.zerkalo_reviews for insert to authenticated
  with check (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ));

drop policy if exists zerkalo_reviews_owner_update on public.zerkalo_reviews;
create policy zerkalo_reviews_owner_update
  on public.zerkalo_reviews for update to authenticated
  using (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ));

drop policy if exists zerkalo_reviews_owner_delete on public.zerkalo_reviews;
create policy zerkalo_reviews_owner_delete
  on public.zerkalo_reviews for delete to authenticated
  using (exists (
    select 1 from public.zerkalo_owners
    where user_id = (select auth.uid())
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'zerkalo-works',
  'zerkalo-works',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists zerkalo_works_storage_owner_read on storage.objects;
create policy zerkalo_works_storage_owner_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'zerkalo-works'
    and exists (select 1 from public.zerkalo_owners where user_id = (select auth.uid()))
  );

drop policy if exists zerkalo_works_storage_owner_insert on storage.objects;
create policy zerkalo_works_storage_owner_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'zerkalo-works'
    and exists (select 1 from public.zerkalo_owners where user_id = (select auth.uid()))
  );

drop policy if exists zerkalo_works_storage_owner_update on storage.objects;
create policy zerkalo_works_storage_owner_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'zerkalo-works'
    and exists (select 1 from public.zerkalo_owners where user_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'zerkalo-works'
    and exists (select 1 from public.zerkalo_owners where user_id = (select auth.uid()))
  );

drop policy if exists zerkalo_works_storage_owner_delete on storage.objects;
create policy zerkalo_works_storage_owner_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'zerkalo-works'
    and exists (select 1 from public.zerkalo_owners where user_id = (select auth.uid()))
  );

-- One transaction for a portable JSON import: inserts only, never upserts.
create or replace function public.zerkalo_import_content(p_works jsonb, p_reviews jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  work_offset integer;
  review_offset integer;
begin
  if not exists (select 1 from public.zerkalo_owners where user_id = (select auth.uid())) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if p_works is null or p_reviews is null or jsonb_typeof(p_works) <> 'array' or jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'Invalid import';
  end if;
  if jsonb_array_length(p_works) + jsonb_array_length(p_reviews) > 200 then
    raise exception 'Import exceeds 200 records';
  end if;
  select coalesce(max(sort_order), -1) + 1 into work_offset from public.zerkalo_works;
  select coalesce(max(sort_order), -1) + 1 into review_offset from public.zerkalo_reviews;
  insert into public.zerkalo_works (id, title, description, size, price, image_path, sort_order)
  select id, title, description, coalesce(size, ''), price, image_path, work_offset + coalesce(sort_order, 0)
  from jsonb_to_recordset(p_works) as x(id uuid, title text, description text, size text, price integer, image_path text, sort_order integer);
  insert into public.zerkalo_reviews (id, author, text, date_label, sort_order)
  select id, author, text, coalesce(date_label, ''), review_offset + coalesce(sort_order, 0)
  from jsonb_to_recordset(p_reviews) as x(id uuid, author text, text text, date_label text, sort_order integer);
  return jsonb_build_object('works', jsonb_array_length(p_works), 'reviews', jsonb_array_length(p_reviews));
end;
$function$;
revoke all on function public.zerkalo_import_content(jsonb, jsonb) from public, anon;
grant execute on function public.zerkalo_import_content(jsonb, jsonb) to authenticated;
