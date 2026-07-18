-- マソ君の日常 / initial schema
-- Apply with the Supabase CLI or paste into a new Supabase project's SQL editor.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'トレーニー'
    check (
      char_length(display_name) <= 30
      and char_length(btrim(display_name)) >= 1
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_sets integer not null default 3 check (default_sets between 1 and 20),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (
    char_length(name) <= 60 and char_length(btrim(name)) >= 1
  ),
  body_part text not null check (
    body_part in ('chest', 'back', 'legs', 'shoulders', 'arms', 'abs', 'cardio', 'other')
  ),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index exercises_user_body_name_unique
  on public.exercises (user_id, body_part, lower(btrim(name)));
create index exercises_user_body_part_idx
  on public.exercises (user_id, body_part);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null,
  client_request_id uuid not null,
  workout_date date not null,
  weight_kg numeric(10, 3) not null check (weight_kg between 0 and 2000),
  reps integer not null check (reps between 1 and 1000),
  sets integer not null check (sets between 1 and 100),
  volume_kg numeric(15, 3) generated always as (
    round((weight_kg * reps * sets)::numeric, 3)
  ) stored,
  memo text not null default '' check (char_length(memo) <= 500),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_logs_exercise_owner_fk
    foreign key (exercise_id, user_id)
    references public.exercises(id, user_id),
  unique (id, user_id),
  unique (user_id, client_request_id)
);

create index workout_logs_user_date_idx
  on public.workout_logs (user_id, workout_date desc)
  where deleted_at is null;
create index workout_logs_user_exercise_date_idx
  on public.workout_logs (user_id, exercise_id, workout_date desc)
  where deleted_at is null;

create table public.maso_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  maso_name text not null default 'マソ君'
    check (
      char_length(maso_name) <= 30
      and char_length(btrim(maso_name)) >= 1
    ),
  level integer not null default 1 check (level between 1 and 999),
  experience integer not null default 0 check (experience between 0 and 99900),
  growth_points integer not null default 0 check (growth_points >= 0),
  current_image text not null default '/maso/maso-level-1.svg',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.foods (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  earned_from_volume numeric(18, 3) not null default 0
    check (earned_from_volume >= 0),
  used_points integer not null default 0 check (used_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_log_id uuid,
  event_type text not null check (
    event_type in ('workout_reward', 'workout_adjustment', 'food_use')
  ),
  growth_points_delta integer not null default 0,
  food_delta integer not null default 0,
  experience_delta integer not null default 0,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint reward_ledger_workout_owner_fk
    foreign key (workout_log_id, user_id)
    references public.workout_logs(id, user_id),
  constraint reward_ledger_event_shape check (
    (
      event_type = 'workout_reward'
      and workout_log_id is not null
      and growth_points_delta >= 0
      and food_delta >= 0
      and experience_delta = 0
    )
    or (
      event_type = 'workout_adjustment'
      and workout_log_id is not null
      and experience_delta = 0
    )
    or (
      event_type = 'food_use'
      and workout_log_id is null
      and growth_points_delta = 0
      and food_delta < 0
      and experience_delta > 0
    )
  ),
  unique (user_id, request_id, event_type)
);

create index reward_ledger_user_created_idx
  on public.reward_ledger (user_id, created_at desc);

create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  used_points integer not null check (used_points > 0),
  before_level integer not null check (before_level between 1 and 999),
  after_level integer not null check (after_level between before_level and 999),
  before_experience integer not null check (before_experience >= 0),
  after_experience integer not null check (after_experience >= 0),
  experience_gained integer not null check (experience_gained > 0),
  after_food_balance integer not null check (after_food_balance >= 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table public.growth_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  before_level integer not null check (before_level >= 1),
  after_level integer not null check (after_level >= before_level),
  trigger_points integer not null check (trigger_points > 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index food_logs_user_created_idx
  on public.food_logs (user_id, created_at desc);
create index growth_logs_user_created_idx
  on public.growth_logs (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();
create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();
create trigger workout_logs_set_updated_at
before update on public.workout_logs
for each row execute function public.set_updated_at();
create trigger maso_status_set_updated_at
before update on public.maso_status
for each row execute function public.set_updated_at();
create trigger foods_set_updated_at
before update on public.foods
for each row execute function public.set_updated_at();

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
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'トレーニー'), 30)
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

  insert into public.exercises (user_id, name, body_part, is_default)
  values
    (new.id, 'ベンチプレス', 'chest', true),
    (new.id, 'プッシュアップ', 'chest', true),
    (new.id, 'ラットプルダウン', 'back', true),
    (new.id, 'デッドリフト', 'back', true),
    (new.id, 'スクワット', 'legs', true),
    (new.id, 'レッグプレス', 'legs', true),
    (new.id, 'ショルダープレス', 'shoulders', true),
    (new.id, 'サイドレイズ', 'shoulders', true),
    (new.id, 'アームカール', 'arms', true),
    (new.id, 'トライセプスエクステンション', 'arms', true),
    (new.id, 'クランチ', 'abs', true),
    (new.id, 'プランク', 'abs', true),
    (new.id, 'ウォーキング', 'cardio', true),
    (new.id, 'ランニング', 'cardio', true)
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.initialize_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.initialize_new_user();

-- Backfill users that existed before this migration. Reusing the same defaults is
-- intentionally idempotent so local/staging databases can be rebuilt safely.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;
insert into public.maso_status (user_id)
select id from auth.users
on conflict (user_id) do nothing;
insert into public.foods (user_id)
select id from auth.users
on conflict (user_id) do nothing;
insert into public.exercises (user_id, name, body_part, is_default)
select users.id, defaults.name, defaults.body_part, true
from auth.users as users
cross join (
  values
    ('ベンチプレス', 'chest'), ('プッシュアップ', 'chest'),
    ('ラットプルダウン', 'back'), ('デッドリフト', 'back'),
    ('スクワット', 'legs'), ('レッグプレス', 'legs'),
    ('ショルダープレス', 'shoulders'), ('サイドレイズ', 'shoulders'),
    ('アームカール', 'arms'), ('トライセプスエクステンション', 'arms'),
    ('クランチ', 'abs'), ('プランク', 'abs'),
    ('ウォーキング', 'cardio'), ('ランニング', 'cardio')
) as defaults(name, body_part)
on conflict do nothing;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_logs enable row level security;
alter table public.maso_status enable row level security;
alter table public.foods enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.food_logs enable row level security;
alter table public.growth_logs enable row level security;

create policy profiles_owner_all on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy user_settings_owner_all on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy exercises_owner_all on public.exercises
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy workout_logs_owner_select on public.workout_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy maso_status_owner_select on public.maso_status
  for select to authenticated using ((select auth.uid()) = user_id);
create policy foods_owner_select on public.foods
  for select to authenticated using ((select auth.uid()) = user_id);
create policy reward_ledger_owner_select on public.reward_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
create policy food_logs_owner_select on public.food_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy growth_logs_owner_select on public.growth_logs
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.save_workout(
  p_exercise_id uuid,
  p_workout_date date,
  p_weight numeric,
  p_unit text,
  p_reps integer,
  p_sets integer,
  p_memo text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workout public.workout_logs%rowtype;
  v_maso public.maso_status%rowtype;
  v_food_state public.foods%rowtype;
  v_weight_kg numeric(10, 3);
  v_growth integer;
  v_food integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_request_id is null or p_exercise_id is null then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  if p_workout_date is null
    or p_workout_date > (now() at time zone 'Asia/Tokyo')::date
    or p_weight is null or p_weight < 0 or p_weight > 2000
    or p_unit is null or p_unit not in ('kg', 'lb')
    or p_reps is null or p_reps not between 1 and 1000
    or p_sets is null or p_sets not between 1 and 100
    or char_length(coalesce(p_memo, '')) > 500 then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.exercises
    where id = p_exercise_id and user_id = v_user_id
  ) then
    raise exception 'exercise not found' using errcode = 'P0002';
  end if;

  v_weight_kg := round(
    case when p_unit = 'lb' then p_weight * 0.45359237 else p_weight end,
    3
  );

  select * into v_workout
  from public.workout_logs
  where user_id = v_user_id and client_request_id = p_request_id;

  if found then
    if v_workout.exercise_id is distinct from p_exercise_id
      or v_workout.workout_date is distinct from p_workout_date
      or v_workout.weight_kg is distinct from v_weight_kg
      or v_workout.reps is distinct from p_reps
      or v_workout.sets is distinct from p_sets
      or v_workout.memo is distinct from btrim(coalesce(p_memo, '')) then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    select growth_points_delta, food_delta into v_growth, v_food
    from public.reward_ledger
    where user_id = v_user_id
      and workout_log_id = v_workout.id
      and event_type = 'workout_reward';

    if not found then
      raise exception 'workout reward ledger missing' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
      'id', v_workout.id,
      'volumeKg', v_workout.volume_kg,
      'growthPoints', v_growth,
      'food', v_food,
      'created', false
    );
  end if;

  -- Keep the lock order identical to feed_maso to avoid cross-RPC deadlocks.
  select * into v_maso
  from public.maso_status
  where user_id = v_user_id
  for update;
  if not found then
    raise exception 'maso status missing' using errcode = 'P0002';
  end if;

  select * into v_food_state
  from public.foods
  where user_id = v_user_id
  for update;
  if not found then
    raise exception 'food state missing' using errcode = 'P0002';
  end if;

  insert into public.workout_logs (
    user_id, exercise_id, client_request_id, workout_date,
    weight_kg, reps, sets, memo
  ) values (
    v_user_id, p_exercise_id, p_request_id, p_workout_date,
    v_weight_kg, p_reps, p_sets, btrim(coalesce(p_memo, ''))
  )
  on conflict (user_id, client_request_id) do nothing
  returning * into v_workout;

  if not found then
    select * into v_workout
    from public.workout_logs
    where user_id = v_user_id and client_request_id = p_request_id;

    if v_workout.exercise_id is distinct from p_exercise_id
      or v_workout.workout_date is distinct from p_workout_date
      or v_workout.weight_kg is distinct from v_weight_kg
      or v_workout.reps is distinct from p_reps
      or v_workout.sets is distinct from p_sets
      or v_workout.memo is distinct from btrim(coalesce(p_memo, '')) then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    select growth_points_delta, food_delta into v_growth, v_food
    from public.reward_ledger
    where user_id = v_user_id
      and workout_log_id = v_workout.id
      and event_type = 'workout_reward';

    if not found then
      raise exception 'workout reward ledger missing' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
      'id', v_workout.id,
      'volumeKg', v_workout.volume_kg,
      'growthPoints', v_growth,
      'food', v_food,
      'created', false
    );
  end if;

  v_growth := floor(v_workout.volume_kg / 100)::integer;
  v_food := floor(v_workout.volume_kg / 500)::integer;

  update public.maso_status
  set growth_points = growth_points + v_growth
  where user_id = v_user_id;

  update public.foods
  set balance = balance + v_food,
      earned_from_volume = earned_from_volume + v_workout.volume_kg
  where user_id = v_user_id;

  insert into public.reward_ledger (
    user_id, workout_log_id, event_type, growth_points_delta,
    food_delta, request_id
  ) values (
    v_user_id, v_workout.id, 'workout_reward', v_growth,
    v_food, p_request_id
  );

  return jsonb_build_object(
    'id', v_workout.id,
    'volumeKg', v_workout.volume_kg,
    'growthPoints', v_growth,
    'food', v_food,
    'created', true
  );
end;
$$;

create or replace function public.feed_maso(
  p_amount integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_food public.foods%rowtype;
  v_maso public.maso_status%rowtype;
  v_food_log public.food_logs%rowtype;
  v_before_level integer;
  v_before_experience integer;
  v_added_experience integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_request_id is null or p_amount is null or p_amount not between 1 and 1000 then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  select * into v_food_log
  from public.food_logs
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_food_log.used_points is distinct from p_amount then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'level', v_food_log.after_level,
      'experience', v_food_log.after_experience,
      'food', v_food_log.after_food_balance,
      'created', false
    );
  end if;

  -- Keep the lock order identical to save_workout.
  select * into v_maso
  from public.maso_status
  where user_id = v_user_id
  for update;
  if not found then
    raise exception 'maso status missing' using errcode = 'P0002';
  end if;

  select * into v_food
  from public.foods
  where user_id = v_user_id
  for update;
  if not found then
    raise exception 'food state missing' using errcode = 'P0002';
  end if;

  select * into v_food_log
  from public.food_logs
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_food_log.used_points is distinct from p_amount then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'level', v_food_log.after_level,
      'experience', v_food_log.after_experience,
      'food', v_food_log.after_food_balance,
      'created', false
    );
  end if;

  if v_food.balance < p_amount then
    raise exception 'insufficient food' using errcode = '22023';
  end if;

  v_before_level := v_maso.level;
  v_before_experience := v_maso.experience;
  v_added_experience := p_amount * 10;
  v_maso.experience := v_maso.experience + v_added_experience;

  while v_maso.level < 999
    and v_maso.experience >= 100 * v_maso.level loop
    v_maso.experience := v_maso.experience - 100 * v_maso.level;
    v_maso.level := v_maso.level + 1;
  end loop;

  if v_maso.level = 999 then
    v_maso.experience := least(v_maso.experience, 99900);
  end if;

  update public.foods
  set balance = balance - p_amount,
      used_points = used_points + p_amount
  where user_id = v_user_id;

  update public.maso_status
  set level = v_maso.level,
      experience = v_maso.experience
  where user_id = v_user_id;

  insert into public.food_logs (
    user_id, used_points, before_level, after_level,
    before_experience, after_experience, experience_gained,
    after_food_balance, request_id
  ) values (
    v_user_id, p_amount, v_before_level, v_maso.level,
    v_before_experience, v_maso.experience, v_added_experience,
    v_food.balance - p_amount, p_request_id
  );

  insert into public.reward_ledger (
    user_id, event_type, food_delta, experience_delta, request_id
  ) values (
    v_user_id, 'food_use', -p_amount, v_added_experience, p_request_id
  );

  if v_maso.level > v_before_level then
    insert into public.growth_logs (
      user_id, before_level, after_level, trigger_points, request_id
    ) values (
      v_user_id, v_before_level, v_maso.level, p_amount, p_request_id
    );
  end if;

  return jsonb_build_object(
    'level', v_maso.level,
    'experience', v_maso.experience,
    'food', v_food.balance - p_amount,
    'created', true
  );
end;
$$;

create or replace function public.rename_maso(p_name text)
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

  if p_name is null or char_length(p_name) > 100 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  v_name := btrim(p_name);
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

revoke all on function public.save_workout(uuid, date, numeric, text, integer, integer, text, uuid)
  from public, anon;
revoke all on function public.feed_maso(integer, uuid)
  from public, anon;
revoke all on function public.rename_maso(text)
  from public, anon;
grant execute on function public.save_workout(uuid, date, numeric, text, integer, integer, text, uuid)
  to authenticated;
grant execute on function public.feed_maso(integer, uuid)
  to authenticated;
grant execute on function public.rename_maso(text)
  to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on public.profiles, public.user_settings, public.exercises,
  public.workout_logs, public.maso_status, public.foods,
  public.reward_ledger, public.food_logs, public.growth_logs
  from public, anon, authenticated;
grant select on public.profiles, public.user_settings, public.exercises to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (default_sets, weight_unit) on public.user_settings to authenticated;
grant insert (user_id, name, body_part), update (name, body_part)
  on public.exercises to authenticated;
grant select on public.workout_logs, public.maso_status, public.foods,
  public.reward_ledger, public.food_logs, public.growth_logs to authenticated;
