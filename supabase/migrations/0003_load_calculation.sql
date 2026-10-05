-- Load calculation: per-exercise body weight pattern, daily body weight and
-- server-side total-load volume.
--
-- Patterns (see lib/domain/load.ts, which mirrors this file):
--   A  load = weight
--   B  load = weight + body_weight * bw_ratio
--   C  load = body_weight * bw_ratio + weight
--   D  load = body_weight * bw_ratio + weight - assist
-- Isometric exercises are entered in seconds; 10 seconds count as one rep, so
-- the stored per-unit load is load / 10 and volume stays load_per_unit * reps * sets.
--
-- Existing workout rows are not recalculated: their per-unit load is the
-- stored weight, so their volume is unchanged.

-- Single SQL source of the default exercise list. Keep it in sync with
-- lib/data/exercise-master.ts (a unit test compares the two).
create or replace function public.exercise_master()
returns table (
  master_key text,
  name text,
  body_part text,
  calculation_pattern text,
  bw_ratio numeric,
  is_isometric boolean
)
language sql
immutable
set search_path = ''
as $$
  select * from (
    values
      ('default-bench-press', 'ベンチプレス', 'chest', 'A', 0.000, false),
      ('incline-barbell-press', 'インクライン・バーベルプレス', 'chest', 'A', 0.000, false),
      ('chest-press-machine', 'チェストプレス（マシン）', 'chest', 'A', 0.000, false),
      ('pec-fly', 'ペックフライ', 'chest', 'A', 0.000, false),
      ('cable-crossover', 'ケーブルクロスオーバー', 'chest', 'A', 0.000, false),
      ('default-lat-pulldown', 'ラットプルダウン', 'back', 'A', 0.000, false),
      ('barbell-bent-over-row', 'バーベル・ベントオーバーロウ', 'back', 'A', 0.000, false),
      ('seated-row', 'シーテッドロー', 'back', 'A', 0.000, false),
      ('one-hand-dumbbell-row', 'ワンハンド・ダンベルロウ', 'back', 'A', 0.000, false),
      ('t-bar-row', 'Tバーロウ', 'back', 'A', 0.000, false),
      ('default-deadlift', 'デッドリフト', 'back', 'A', 0.000, false),
      ('default-shoulder-press', 'バーベル・ショルダープレス', 'shoulders', 'A', 0.000, false),
      ('dumbbell-shoulder-press', 'ダンベル・ショルダープレス', 'shoulders', 'A', 0.000, false),
      ('default-side-raise', 'サイドレイズ', 'shoulders', 'A', 0.000, false),
      ('rear-raise', 'リアレイズ', 'shoulders', 'A', 0.000, false),
      ('upright-row', 'アップライトロウ', 'shoulders', 'A', 0.000, false),
      ('default-arm-curl', 'バーベルカール', 'arms', 'A', 0.000, false),
      ('dumbbell-curl', 'ダンベルカール', 'arms', 'A', 0.000, false),
      ('triceps-pressdown', 'トライセプス・プレスダウン', 'arms', 'A', 0.000, false),
      ('skull-crusher', 'スカルクラッシャー', 'arms', 'A', 0.000, false),
      ('leg-extension', 'レッグエクステンション', 'legs', 'A', 0.000, false),
      ('leg-curl', 'レッグカール', 'legs', 'A', 0.000, false),
      ('seated-calf-raise', 'シーテッド・カーフレイズ', 'legs', 'A', 0.000, false),
      ('default-squat', 'バーベルスクワット', 'legs', 'B', 0.880, false),
      ('front-squat', 'フロントスクワット', 'legs', 'B', 0.880, false),
      ('bodyweight-squat', '自重スクワット', 'legs', 'B', 0.880, false),
      ('pistol-squat', 'ピストルスクワット', 'legs', 'B', 0.880, false),
      ('bulgarian-squat', 'ブルガリアンスクワット', 'legs', 'B', 0.740, false),
      ('walking-lunge', 'ウォーキングランジ', 'legs', 'B', 0.740, false),
      ('reverse-lunge', 'リバースランジ', 'legs', 'B', 0.740, false),
      ('step-up', 'ステップアップ', 'legs', 'B', 0.740, false),
      ('default-leg-press', 'レッグプレス', 'legs', 'B', 0.700, false),
      ('hack-squat', 'ハックスクワット', 'legs', 'B', 0.880, false),
      ('standing-calf-raise', 'スタンディング・カーフレイズ', 'legs', 'B', 0.880, false),
      ('default-push-up', 'プッシュアップ', 'chest', 'C', 0.640, false),
      ('knee-push-up', '膝付きプッシュアップ', 'chest', 'C', 0.490, false),
      ('decline-push-up', 'ディクライン・プッシュアップ', 'chest', 'C', 0.740, false),
      ('incline-push-up', 'インクライン・プッシュアップ', 'chest', 'C', 0.550, false),
      ('pike-push-up', 'パイクプッシュアップ', 'shoulders', 'C', 0.750, false),
      ('handstand-push-up', 'ハンドスタンド・プッシュアップ', 'shoulders', 'C', 0.900, false),
      ('inverted-row', 'インバーテッドロウ', 'back', 'C', 0.600, false),
      ('hip-thrust', 'ヒップスラスト', 'legs', 'C', 0.400, false),
      ('back-extension', 'バックエクステンション', 'back', 'C', 0.600, false),
      ('good-morning', 'グッドモーニング', 'legs', 'C', 0.600, false),
      ('sit-up', 'シットアップ', 'abs', 'C', 0.600, false),
      ('default-crunch', 'クランチ', 'abs', 'C', 0.400, false),
      ('bicycle-crunch', 'バイシクルクランチ', 'abs', 'C', 0.400, false),
      ('leg-raise', 'レッグレイズ', 'abs', 'C', 0.350, false),
      ('v-sit', 'Vシット', 'abs', 'C', 0.800, false),
      ('default-plank', 'プランク', 'abs', 'C', 0.650, true),
      ('side-plank', 'サイドプランク', 'abs', 'C', 0.500, true),
      ('running-man', 'ランニングマン', 'abs', 'C', 0.150, false),
      ('pull-up', '懸垂（プルアップ）', 'back', 'D', 0.900, false),
      ('chin-up', 'チンニング（逆手懸垂）', 'back', 'D', 0.900, false),
      ('wide-grip-pull-up', 'ワイドグリップ・プルアップ', 'back', 'D', 0.900, false),
      ('muscle-up', 'マッスルアップ', 'back', 'D', 0.900, false),
      ('dips', 'ディップス', 'chest', 'D', 0.910, false),
      ('hanging-leg-raise', 'ハンギング・レッグレイズ', 'abs', 'D', 0.350, false),
      ('default-triceps-extension', 'トライセプスエクステンション', 'arms', 'A', 0.000, false),
      ('default-walking', 'ウォーキング', 'cardio', 'A', 0.000, false),
      ('default-running', 'ランニング', 'cardio', 'A', 0.000, false)
  ) as m (master_key, name, body_part, calculation_pattern, bw_ratio, is_isometric)
$$;

revoke all on function public.exercise_master() from public, anon, authenticated;

alter table public.exercises
  add column master_key text,
  add column calculation_pattern text not null default 'A'
    check (calculation_pattern in ('A', 'B', 'C', 'D')),
  add column bw_ratio numeric(4, 3) not null default 0
    check (bw_ratio between 0 and 1),
  add column is_isometric boolean not null default false,
  add constraint exercises_pattern_ratio_check check (
    (calculation_pattern = 'A' and bw_ratio = 0)
    or (calculation_pattern <> 'A' and bw_ratio > 0)
  );

create unique index exercises_user_master_key_unique
  on public.exercises (user_id, master_key)
  where master_key is not null;

-- Attach the master definition to the 14 exercises created by 0001. Rows the
-- user renamed no longer match by name and stay as plain weight exercises.
with legacy (old_name, body_part, master_key) as (
  values
    ('ベンチプレス', 'chest', 'default-bench-press'),
    ('プッシュアップ', 'chest', 'default-push-up'),
    ('ラットプルダウン', 'back', 'default-lat-pulldown'),
    ('デッドリフト', 'back', 'default-deadlift'),
    ('スクワット', 'legs', 'default-squat'),
    ('レッグプレス', 'legs', 'default-leg-press'),
    ('ショルダープレス', 'shoulders', 'default-shoulder-press'),
    ('サイドレイズ', 'shoulders', 'default-side-raise'),
    ('アームカール', 'arms', 'default-arm-curl'),
    ('トライセプスエクステンション', 'arms', 'default-triceps-extension'),
    ('クランチ', 'abs', 'default-crunch'),
    ('プランク', 'abs', 'default-plank'),
    ('ウォーキング', 'cardio', 'default-walking'),
    ('ランニング', 'cardio', 'default-running')
)
update public.exercises as e
set master_key = m.master_key,
    calculation_pattern = m.calculation_pattern,
    bw_ratio = m.bw_ratio,
    is_isometric = m.is_isometric
from legacy as l
join public.exercise_master() as m on m.master_key = l.master_key
where e.is_default
  and e.name = l.old_name
  and e.body_part = l.body_part;

-- A few legacy names became more specific (スクワット -> バーベルスクワット).
-- Skip a rename when the user already owns an exercise with the new name.
update public.exercises as e
set name = m.name
from public.exercise_master() as m
where e.master_key = m.master_key
  and e.is_default
  and e.name <> m.name
  and not exists (
    select 1
    from public.exercises as other
    where other.user_id = e.user_id
      and other.body_part = e.body_part
      and lower(btrim(other.name)) = lower(btrim(m.name))
      and other.id <> e.id
  );

-- Add the remaining master exercises for every existing account. A name
-- already used by the user's own exercise is left alone.
insert into public.exercises (
  user_id, name, body_part, is_default,
  master_key, calculation_pattern, bw_ratio, is_isometric
)
select users.id, m.name, m.body_part, true,
  m.master_key, m.calculation_pattern, m.bw_ratio, m.is_isometric
from auth.users as users
cross join public.exercise_master() as m
where not exists (
  select 1
  from public.exercises as e
  where e.user_id = users.id and e.master_key = m.master_key
)
on conflict do nothing;

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

-- Exercises can no longer be inserted directly: the calculation pattern is
-- derived on the server from the body part, so a client cannot choose it.
-- Renaming stays allowed; the body part and pattern are fixed once created.
revoke insert, update on public.exercises from authenticated;
grant update (name) on public.exercises to authenticated;

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

  v_name := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
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

-- One body weight per account and day. Writes go through the RPCs below.
create table public.body_weight_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  weight_kg numeric(6, 3) not null check (weight_kg between 20 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

create trigger body_weight_logs_set_updated_at
before update on public.body_weight_logs
for each row execute function public.set_updated_at();

alter table public.body_weight_logs enable row level security;

create policy body_weight_logs_owner_select on public.body_weight_logs
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.body_weight_logs from public, anon, authenticated;
grant select on public.body_weight_logs to authenticated;

-- Workout rows keep what the volume was computed from, so later coefficient
-- changes never rewrite history. Old rows: load per unit = stored weight.
alter table public.workout_logs
  add column body_weight_kg numeric(6, 3)
    check (body_weight_kg is null or body_weight_kg between 20 and 300),
  add column assist_kg numeric(10, 3) not null default 0
    check (assist_kg between 0 and 500),
  add column load_per_unit_kg numeric(14, 4);

update public.workout_logs set load_per_unit_kg = weight_kg;

alter table public.workout_logs
  alter column load_per_unit_kg set not null,
  add constraint workout_logs_load_check check (load_per_unit_kg >= 0);

alter table public.workout_logs drop column volume_kg;
alter table public.workout_logs
  add column volume_kg numeric(15, 3) generated always as (
    round((load_per_unit_kg * reps * sets)::numeric, 3)
  ) stored;

drop function public.save_workout(uuid, date, numeric, text, integer, integer, text, uuid);

-- Result contract:
--   { id, volumeKg, loadPerUnitKg, bodyWeightKg, growthPoints, food, created }
-- Weight and assist use p_unit; the body weight is always kilograms.
-- The server derives the load from the exercise row, never from the client.
create or replace function public.save_workout(
  p_exercise_id uuid,
  p_workout_date date,
  p_weight numeric,
  p_unit text,
  p_reps integer,
  p_sets integer,
  p_memo text,
  p_request_id uuid,
  p_body_weight_kg numeric default null,
  p_assist numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workout public.workout_logs%rowtype;
  v_exercise public.exercises%rowtype;
  v_maso public.maso_status%rowtype;
  v_food_state public.foods%rowtype;
  v_weight_kg numeric(10, 3);
  v_assist_kg numeric(10, 3);
  v_explicit_body_weight numeric(6, 3);
  v_body_weight_kg numeric(6, 3);
  v_load numeric;
  v_load_per_unit numeric(14, 4);
  v_volume numeric;
  v_max_reps integer;
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
    or p_weight is null or p_weight < 0 or p_weight > 5000
    or p_unit is null or p_unit not in ('kg', 'lb')
    or coalesce(p_assist, 0) < 0 or coalesce(p_assist, 0) > 5000
    or p_reps is null or p_reps < 1
    or p_sets is null or p_sets not between 1 and 30
    or (p_body_weight_kg is not null and p_body_weight_kg not between 20 and 300)
    or char_length(coalesce(p_memo, '')) > 500 then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  select * into v_exercise
  from public.exercises
  where id = p_exercise_id and user_id = v_user_id;

  if not found then
    raise exception 'exercise not found' using errcode = 'P0002';
  end if;

  v_max_reps := case when v_exercise.is_isometric then 600 else 200 end;
  if p_reps > v_max_reps then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  v_weight_kg := round(
    case when p_unit = 'lb' then p_weight * 0.45359237 else p_weight end,
    3
  );
  v_assist_kg := case
    when v_exercise.calculation_pattern = 'D' then round(
      case when p_unit = 'lb' then coalesce(p_assist, 0) * 0.45359237
        else coalesce(p_assist, 0) end,
      3
    )
    else 0
  end;
  v_explicit_body_weight := round(p_body_weight_kg, 3);

  if v_weight_kg > 500 or v_assist_kg > 500 then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  select * into v_workout
  from public.workout_logs
  where user_id = v_user_id and client_request_id = p_request_id;

  if found then
    if v_workout.exercise_id is distinct from p_exercise_id
      or v_workout.workout_date is distinct from p_workout_date
      or v_workout.weight_kg is distinct from v_weight_kg
      or v_workout.assist_kg is distinct from v_assist_kg
      or (
        v_explicit_body_weight is not null
        and v_workout.body_weight_kg is distinct from v_explicit_body_weight
      )
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
      'loadPerUnitKg', v_workout.load_per_unit_kg,
      'bodyWeightKg', v_workout.body_weight_kg,
      'growthPoints', v_growth,
      'food', v_food,
      'created', false
    );
  end if;

  if v_exercise.calculation_pattern = 'A' then
    if v_weight_kg <= 0 then
      raise exception 'invalid workout values' using errcode = '22023';
    end if;
    v_body_weight_kg := v_explicit_body_weight;
    v_load := v_weight_kg;
  else
    v_body_weight_kg := coalesce(
      v_explicit_body_weight,
      (
        select b.weight_kg
        from public.body_weight_logs as b
        where b.user_id = v_user_id and b.log_date <= p_workout_date
        order by b.log_date desc
        limit 1
      )
    );

    if v_body_weight_kg is null then
      raise exception 'body weight required' using errcode = '22023';
    end if;

    v_load := v_body_weight_kg * v_exercise.bw_ratio + v_weight_kg - v_assist_kg;
  end if;

  if v_load <= 0 then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  v_load_per_unit := round(
    case when v_exercise.is_isometric then v_load / 10 else v_load end,
    4
  );
  v_volume := round(v_load_per_unit * p_reps * p_sets, 3);

  -- Sanity cap for one record (the form enforces the same limit).
  if v_volume > 50000 then
    raise exception 'workout volume too large' using errcode = '22023';
  end if;

  -- Keep the lock order identical to all inventory RPCs.
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
    weight_kg, assist_kg, body_weight_kg, load_per_unit_kg,
    reps, sets, memo
  ) values (
    v_user_id, p_exercise_id, p_request_id, p_workout_date,
    v_weight_kg, v_assist_kg, v_body_weight_kg, v_load_per_unit,
    p_reps, p_sets, btrim(coalesce(p_memo, ''))
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
      or v_workout.assist_kg is distinct from v_assist_kg
      or (
        v_explicit_body_weight is not null
        and v_workout.body_weight_kg is distinct from v_explicit_body_weight
      )
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
      'loadPerUnitKg', v_workout.load_per_unit_kg,
      'bodyWeightKg', v_workout.body_weight_kg,
      'growthPoints', v_growth,
      'food', v_food,
      'created', false
    );
  end if;

  if v_explicit_body_weight is not null then
    insert into public.body_weight_logs (user_id, log_date, weight_kg)
    values (v_user_id, p_workout_date, v_explicit_body_weight)
    on conflict (user_id, log_date)
      do update set weight_kg = excluded.weight_kg;
  end if;

  v_growth := floor(v_workout.volume_kg / 100)::integer;
  v_food := 0;

  update public.maso_status
  set growth_points = growth_points + v_growth
  where user_id = v_user_id;

  update public.foods
  set earned_from_volume = earned_from_volume + v_workout.volume_kg
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
    'loadPerUnitKg', v_workout.load_per_unit_kg,
    'bodyWeightKg', v_workout.body_weight_kg,
    'growthPoints', v_growth,
    'food', v_food,
    'created', true
  );
end;
$$;

-- Records today's (or another past day's) body weight without a workout.
create or replace function public.save_body_weight(
  p_log_date date,
  p_weight_kg numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_weight numeric(6, 3);
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_log_date is null
    or p_log_date > (now() at time zone 'Asia/Tokyo')::date
    or p_weight_kg is null
    or p_weight_kg not between 20 and 300 then
    raise exception 'invalid body weight' using errcode = '22023';
  end if;

  v_weight := round(p_weight_kg, 3);

  insert into public.body_weight_logs (user_id, log_date, weight_kg)
  values (v_user_id, p_log_date, v_weight)
  on conflict (user_id, log_date)
    do update set weight_kg = excluded.weight_kg;

  return jsonb_build_object('date', p_log_date, 'weightKg', v_weight);
end;
$$;

revoke all on function public.add_exercise(text, text, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.save_workout(
  uuid, date, numeric, text, integer, integer, text, uuid, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.save_body_weight(date, numeric)
  from public, anon, authenticated;
grant execute on function public.add_exercise(text, text, boolean, boolean)
  to authenticated;
grant execute on function public.save_workout(
  uuid, date, numeric, text, integer, integer, text, uuid, numeric, numeric
) to authenticated;
grant execute on function public.save_body_weight(date, numeric)
  to authenticated;
