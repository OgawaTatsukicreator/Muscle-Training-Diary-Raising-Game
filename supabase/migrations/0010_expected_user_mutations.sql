-- Bind writes to the account selected when the client started the operation.
-- Existing signatures remain available for the previously deployed app.
create function public.add_exercise(
  p_name text,
  p_body_part text,
  p_uses_bodyweight boolean,
  p_is_isometric boolean,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'account changed' using errcode = '42501';
  end if;
  return public.add_exercise(p_name, p_body_part, p_uses_bodyweight, p_is_isometric);
end;
$$;

create function public.save_body_weight(
  p_log_date date,
  p_weight_kg numeric,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'account changed' using errcode = '42501';
  end if;
  return public.save_body_weight(p_log_date, p_weight_kg);
end;
$$;

create function public.update_display_name(
  p_name text,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'account changed' using errcode = '42501';
  end if;
  return public.update_display_name(p_name);
end;
$$;

revoke all on function public.add_exercise(text, text, boolean, boolean, uuid) from public, anon;
revoke all on function public.save_body_weight(date, numeric, uuid) from public, anon;
revoke all on function public.update_display_name(text, uuid) from public, anon;
grant execute on function public.add_exercise(text, text, boolean, boolean, uuid) to authenticated;
grant execute on function public.save_body_weight(date, numeric, uuid) to authenticated;
grant execute on function public.update_display_name(text, uuid) to authenticated;
