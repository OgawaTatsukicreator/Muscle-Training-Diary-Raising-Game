-- Cardio (body_part = 'cardio') is not converted into volume.
--
-- Walking, running and the like have no agreed conversion to kilograms, and the
-- weight > 0 rule of 0003 made them impossible to log. They are now recorded by
-- time only: `reps` holds the minutes (1-600) and the exercise's pattern columns
-- are not used. The stored weight, assist and load are 0, so the generated
-- `volume_kg` is 0 and the record grants no growth points. Editing and deleting
-- work unchanged (the adjustment target is floor(0 / 100) = 0).
--
-- Cardio rows saved before this migration keep their volume; they are not
-- rewritten. Only the two places that validate a workout change:
--   * compute_workout_values (used by update_workout, 0006)
--   * save_workout (0003)
-- Both keep their signatures, grants and return contracts. The rest of each
-- function is copied unchanged from its previous definition.
--
-- lib/domain/load.ts (UNCONVERTED_BODY_PARTS) and lib/domain/workout-load.ts
-- mirror this rule; the migration test keeps the two in step.

create or replace function public.compute_workout_values(
  p_user_id uuid,
  p_exercise_id uuid,
  p_workout_date date,
  p_weight numeric,
  p_unit text,
  p_reps integer,
  p_sets integer,
  p_memo text,
  p_body_weight_kg numeric,
  p_assist numeric,
  out o_weight_kg numeric,
  out o_assist_kg numeric,
  out o_explicit_body_weight numeric,
  out o_body_weight_kg numeric,
  out o_load_per_unit_kg numeric,
  out o_volume_kg numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_exercise public.exercises%rowtype;
  v_max_reps integer;
  v_load numeric;
begin
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
  where id = p_exercise_id and user_id = p_user_id;

  if not found then
    raise exception 'exercise not found' using errcode = 'P0002';
  end if;

  v_max_reps := case
    when v_exercise.is_isometric or v_exercise.body_part = 'cardio' then 600
    else 200
  end;
  if p_reps > v_max_reps then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  o_weight_kg := round(
    case when p_unit = 'lb' then p_weight * 0.45359237 else p_weight end,
    3
  );
  o_assist_kg := case
    when v_exercise.calculation_pattern = 'D' then round(
      case when p_unit = 'lb' then coalesce(p_assist, 0) * 0.45359237
        else coalesce(p_assist, 0) end,
      3
    )
    else 0
  end;
  o_explicit_body_weight := round(p_body_weight_kg, 3);

  -- Cardio is not converted: the amount is the time only (reps = minutes), so
  -- the weight and assist are ignored and the load stays 0.
  if v_exercise.body_part = 'cardio' then
    o_weight_kg := 0;
    o_assist_kg := 0;
  end if;

  if o_weight_kg > 500 or o_assist_kg > 500 then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  if v_exercise.body_part = 'cardio' then
    o_body_weight_kg := o_explicit_body_weight;
    v_load := 0;
  elsif v_exercise.calculation_pattern = 'A' then
    if o_weight_kg <= 0 then
      raise exception 'invalid workout values' using errcode = '22023';
    end if;
    o_body_weight_kg := o_explicit_body_weight;
    v_load := o_weight_kg;
  else
    o_body_weight_kg := coalesce(
      o_explicit_body_weight,
      (
        select b.weight_kg
        from public.body_weight_logs as b
        where b.user_id = p_user_id and b.log_date <= p_workout_date
        order by b.log_date desc
        limit 1
      )
    );

    if o_body_weight_kg is null then
      raise exception 'body weight required' using errcode = '22023';
    end if;

    v_load := o_body_weight_kg * v_exercise.bw_ratio + o_weight_kg - o_assist_kg;
  end if;

  if v_load <= 0 and v_exercise.body_part <> 'cardio' then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  o_load_per_unit_kg := round(
    case when v_exercise.is_isometric then v_load / 10 else v_load end,
    4
  );
  o_volume_kg := round(o_load_per_unit_kg * p_reps * p_sets, 3);

  if o_volume_kg > 50000 then
    raise exception 'workout volume too large' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.compute_workout_values(
  uuid, uuid, date, numeric, text, integer, integer, text, numeric, numeric
) from public, anon, authenticated;

-- Result contract (unchanged):
--   { id, volumeKg, loadPerUnitKg, bodyWeightKg, growthPoints, food, created }
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

  v_max_reps := case
    when v_exercise.is_isometric or v_exercise.body_part = 'cardio' then 600
    else 200
  end;
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

  -- Cardio is not converted: the amount is the time only (reps = minutes), so
  -- the weight and assist are ignored and the load stays 0.
  if v_exercise.body_part = 'cardio' then
    v_weight_kg := 0;
    v_assist_kg := 0;
  end if;

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

  if v_exercise.body_part = 'cardio' then
    v_body_weight_kg := v_explicit_body_weight;
    v_load := 0;
  elsif v_exercise.calculation_pattern = 'A' then
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

  if v_load <= 0 and v_exercise.body_part <> 'cardio' then
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
