-- User-chosen names (account display name, mascot name, exercise names) are
-- normalized on the server so a name can never look blank.
--
-- Before this migration only ASCII spaces were trimmed, so names made of
-- zero-width characters, the Hangul filler (U+3164) or the braille blank
-- (U+2800) passed validation and rendered as empty text.
--
-- The invisible-character and whitespace sets below must stay identical to
-- INVISIBLE_CHARACTERS / WHITESPACE_CHARACTERS in lib/domain/display-name.ts
-- (a unit test compares them).

create or replace function public.normalize_display_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        normalize(coalesce(p_name, ''), NFC),
        '[\u0001-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0\ufff9-\ufffb]',
        '',
        'g'
      ),
      '[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+',
      ' ',
      'g'
    ),
    ' '
  )
$$;

-- Normalizes, cuts to 30 characters and falls back to a default when nothing
-- visible is left. Used to repair stored names and to read sign-up metadata.
create or replace function public.clean_display_name(
  p_name text,
  p_default text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(left(public.normalize_display_name(p_name), 30), ' '), ''),
    p_default
  )
$$;

revoke all on function public.clean_display_name(text, text)
  from public, anon, authenticated;

-- Repair names saved before this migration.
update public.profiles
set display_name = public.clean_display_name(display_name, 'トレーニー')
where display_name is distinct from
  public.clean_display_name(display_name, 'トレーニー');

update public.maso_status
set maso_name = public.clean_display_name(maso_name, 'マソ君')
where maso_name is distinct from
  public.clean_display_name(maso_name, 'マソ君');

update public.exercises
set name = public.clean_display_name(name, 'その他の種目')
where name is distinct from public.clean_display_name(name, 'その他の種目')
  and not exists (
    select 1
    from public.exercises as other
    where other.user_id = exercises.user_id
      and other.body_part = exercises.body_part
      and other.id <> exercises.id
      and lower(btrim(other.name)) =
        lower(public.clean_display_name(exercises.name, 'その他の種目'))
  );

alter table public.profiles
  add constraint profiles_display_name_normalized
  check (
    display_name <> ''
    and display_name = public.normalize_display_name(display_name)
  );

alter table public.maso_status
  add constraint maso_status_name_normalized
  check (
    maso_name <> ''
    and maso_name = public.normalize_display_name(maso_name)
  );

-- New accounts: read the sign-up metadata through the same normalization. An
-- unusable name falls back to the default instead of failing the sign-up.
create or replace function public.initialize_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    public.clean_display_name(new.raw_user_meta_data ->> 'display_name', 'トレーニー')
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.maso_status (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.foods (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.exercises (
    user_id, name, body_part, is_default,
    master_key, calculation_pattern, bw_ratio, is_isometric
  )
  select new.id, m.name, m.body_part, true,
    m.master_key, m.calculation_pattern, m.bw_ratio, m.is_isometric
  from public.exercise_master() as m
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.initialize_new_user() from public, anon, authenticated;

-- The mascot name.
create or replace function public.rename_maso(
  p_name text,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'authentication context changed' using errcode = '42501';
  end if;

  if p_name is null or char_length(p_name) > 200 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  v_name := public.normalize_display_name(p_name);
  if char_length(v_name) not between 1 and 30 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  update public.maso_status
  set maso_name = v_name
  where user_id = v_user_id;

  if not found then
    raise exception 'maso status missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object('name', v_name);
end;
$$;

-- The account display name. Writes now go through this function so the
-- server decides what is stored; the direct column grant is removed.
create or replace function public.update_display_name(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_name is null or char_length(p_name) > 200 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  v_name := public.normalize_display_name(p_name);
  if char_length(v_name) not between 1 and 30 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  update public.profiles
  set display_name = v_name
  where id = v_user_id;

  if not found then
    raise exception 'profile missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object('displayName', v_name);
end;
$$;

revoke all on function public.update_display_name(text)
  from public, anon, authenticated;
grant execute on function public.update_display_name(text) to authenticated;

revoke update (display_name) on public.profiles from authenticated;

-- Exercise names use the same normalization.
create or replace function public.add_exercise(
  p_name text,
  p_body_part text,
  p_uses_bodyweight boolean default false,
  p_is_isometric boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_pattern text := 'A';
  v_ratio numeric(4, 3) := 0;
  v_isometric boolean := false;
  v_exercise public.exercises%rowtype;
  v_created boolean := true;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_name is null
    or char_length(p_name) > 200
    or p_body_part is null
    or p_body_part not in ('chest', 'back', 'legs', 'shoulders', 'arms', 'abs', 'cardio', 'other') then
    raise exception 'invalid exercise' using errcode = '22023';
  end if;

  v_name := public.normalize_display_name(p_name);
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid exercise' using errcode = '22023';
  end if;

  -- Only legs ask whether bodyweight is used and only abs may be timed.
  if p_body_part = 'legs' and coalesce(p_uses_bodyweight, false) then
    v_pattern := 'B';
    v_ratio := 0.74;
  elsif p_body_part = 'abs' then
    v_pattern := 'C';
    v_ratio := 0.5;
    v_isometric := coalesce(p_is_isometric, false);
  end if;

  insert into public.exercises (
    user_id, name, body_part, is_default,
    calculation_pattern, bw_ratio, is_isometric
  ) values (
    v_user_id, v_name, p_body_part, false,
    v_pattern, v_ratio, v_isometric
  )
  on conflict do nothing
  returning * into v_exercise;

  if not found then
    v_created := false;
    select * into v_exercise
    from public.exercises
    where user_id = v_user_id
      and body_part = p_body_part
      and lower(btrim(name)) = lower(v_name);

    if not found then
      raise exception 'exercise could not be created' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_exercise.id,
    'name', v_exercise.name,
    'bodyPart', v_exercise.body_part,
    'isDefault', v_exercise.is_default,
    'calculationPattern', v_exercise.calculation_pattern,
    'bwRatio', v_exercise.bw_ratio,
    'isIsometric', v_exercise.is_isometric,
    'created', v_created
  );
end;
$$;
