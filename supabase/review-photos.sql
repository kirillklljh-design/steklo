alter table public.zerkalo_reviews add column if not exists image_path text;
alter table public.zerkalo_reviews drop constraint if exists zerkalo_reviews_text_check;
alter table public.zerkalo_reviews add constraint zerkalo_reviews_text_check check(length(text)<=1200 and (length(btrim(text))>0 or nullif(image_path,'') is not null));
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
  insert into public.zerkalo_reviews (id, author, text, date_label, sort_order, image_path)
  select id, author, text, coalesce(date_label, ''), review_offset + coalesce(sort_order, 0), image_path
  from jsonb_to_recordset(p_reviews) as x(id uuid, author text, text text, date_label text, sort_order integer, image_path text);
  return jsonb_build_object('works', jsonb_array_length(p_works), 'reviews', jsonb_array_length(p_reviews));
end;
$function$;
revoke all on function public.zerkalo_import_content(jsonb, jsonb) from public, anon;
grant execute on function public.zerkalo_import_content(jsonb, jsonb) to authenticated;
