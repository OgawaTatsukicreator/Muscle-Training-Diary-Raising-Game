-- Edit and delete a saved workout.
--
-- Rewards follow the record: the growth points granted for a workout are the
-- sum of its reward_ledger rows (workout_reward + workout_adjustment). An edit
-- or delete re-targets that sum to floor(volume / 100) (0 after a delete) and
-- books the difference as a 'workout_adjustment' ledger row.
--
-- Points the player already spent are never taken back below zero: the applied
-- change is clamped so maso_status.growth_points stays >= 0, and the clamped
-- amount is what the ledger records. Because the next adjustment starts from
-- the ledger sum (what was really granted) and not from the formula, editing a
-- record down and back up cannot be used to mint points.
--
-- Deleting is a soft delete (deleted_at) so the ledger keeps its foreign key.

-- Validates one workout's input against its exercise and computes what is
-- stored. Mirrors the checks and arithmetic of save_workout (0003) and
-- lib/domain/workout-load.ts. Internal: only called from the RPCs below.
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

  v_max_reps := case when v_exercise.is_isometric then 600 else 200 end;
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

  if o_weight_kg > 500 or o_assist_kg > 500 then
    raise exception 'invalid workout values' using errcode = '22023';
  end if;

  if v_exercise.calculation_pattern = 'A' then
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

  if v_load <= 0 then
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

-- Result contract:
--   { id, volumeKg, loadPerUnitKg, bodyWeightKg,
--     growthPoints (total now granted for this record),
--     growthPointsDelta (change applied by this call), created }
create or replace function public.update_workout(
  p_workout_id uuid,
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
  v_maso public.maso_status%rowtype;
  v_food public.foods%rowtype;
  v_ledger public.reward_ledger%rowtype;
  v_weight_kg numeric;
  v_assist_kg numeric;
  v_explicit_body_weight numeric;
  v_body_weight_kg numeric;
  v_load_per_unit numeric;
  v_volume numeric;
  v_old_volume numeric;
  v_granted integer;
  v_target integer;
  v_applied integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_workout_id is null or p_request_id is null then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  -- Keep the lock order identical to all reward RPCs: mascot, food, then rows.
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

  select * into v_workout
  from public.workout_logs
  where id = p_workout_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'workout not found' using errcode = 'P0002';
  end if;

  select * into v_ledger
  from public.reward_ledger
  where user_id = v_user_id
    and request_id = p_request_id
    and event_type = 'workout_adjustment';

  if found then
    -- A replay of an already applied edit: return the stored result unless the
    -- request id is being reused for something else.
    if v_ledger.workout_log_id is distinct from p_workout_id then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    select * into v_weight_kg, v_assist_kg, v_explicit_body_weight,
      v_body_weight_kg, v_load_per_unit, v_volume
    from public.compute_workout_values(
      v_user_id, v_workout.exercise_id, p_workout_date, p_weight, p_unit,
      p_reps, p_sets, p_memo, p_body_weight_kg, p_assist
    );

    if v_workout.workout_date is distinct from p_workout_date
      or v_workout.weight_kg is distinct from round(v_weight_kg, 3)
      or v_workout.assist_kg is distinct from round(v_assist_kg, 3)
      or v_workout.reps is distinct from p_reps
      or v_workout.sets is distinct from p_sets
      or v_workout.memo is distinct from btrim(coalesce(p_memo, '')) then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    select coalesce(sum(growth_points_delta), 0)::integer into v_granted
    from public.reward_ledger
    where user_id = v_user_id and workout_log_id = p_workout_id;

    return jsonb_build_object(
      'id', v_workout.id,
      'volumeKg', v_workout.volume_kg,
      'loadPerUnitKg', v_workout.load_per_unit_kg,
      'bodyWeightKg', v_workout.body_weight_kg,
      'growthPoints', v_granted,
      'growthPointsDelta', v_ledger.growth_points_delta,
      'created', false
    );
  end if;

  select * into v_weight_kg, v_assist_kg, v_explicit_body_weight,
    v_body_weight_kg, v_load_per_unit, v_volume
  from public.compute_workout_values(
    v_user_id, v_workout.exercise_id, p_workout_date, p_weight, p_unit,
    p_reps, p_sets, p_memo, p_body_weight_kg, p_assist
  );

  v_old_volume := v_workout.volume_kg;

  update public.workout_logs
  set workout_date = p_workout_date,
      weight_kg = v_weight_kg,
      assist_kg = v_assist_kg,
      body_weight_kg = v_body_weight_kg,
      load_per_unit_kg = v_load_per_unit,
      reps = p_reps,
      sets = p_sets,
      memo = btrim(coalesce(p_memo, ''))
  where id = p_workout_id and user_id = v_user_id
  returning * into v_workout;

  if v_explicit_body_weight is not null then
    insert into public.body_weight_logs (user_id, log_date, weight_kg)
    values (v_user_id, p_workout_date, v_explicit_body_weight)
    on conflict (user_id, log_date)
      do update set weight_kg = excluded.weight_kg;
  end if;

  select coalesce(sum(growth_points_delta), 0)::integer into v_granted
  from public.reward_ledger
  where user_id = v_user_id and workout_log_id = p_workout_id;

  v_target := floor(v_workout.volume_kg / 100)::integer;
  v_applied := greatest(v_target - v_granted, -v_maso.growth_points);

  insert into public.reward_ledger (
    user_id, workout_log_id, event_type, growth_points_delta,
    food_delta, request_id
  ) values (
    v_user_id, p_workout_id, 'workout_adjustment', v_applied, 0, p_request_id
  );

  update public.maso_status
  set growth_points = growth_points + v_applied
  where user_id = v_user_id;

  update public.foods
  set earned_from_volume = greatest(
    earned_from_volume + (v_workout.volume_kg - v_old_volume), 0
  )
  where user_id = v_user_id;

  return jsonb_build_object(
    'id', v_workout.id,
    'volumeKg', v_workout.volume_kg,
    'loadPerUnitKg', v_workout.load_per_unit_kg,
    'bodyWeightKg', v_workout.body_weight_kg,
    'growthPoints', v_granted + v_applied,
    'growthPointsDelta', v_applied,
    'created', true
  );
end;
$$;

-- Result contract: { id, growthPointsDelta, created }
-- Deleting an already deleted workout succeeds without changing anything.
create or replace function public.delete_workout(
  p_workout_id uuid,
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
  v_food public.foods%rowtype;
  v_granted integer;
  v_applied integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_workout_id is null or p_request_id is null then
    raise exception 'invalid request' using errcode = '22023';
  end if;

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

  select * into v_workout
  from public.workout_logs
  where id = p_workout_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'workout not found' using errcode = 'P0002';
  end if;

  if v_workout.deleted_at is not null then
    return jsonb_build_object(
      'id', v_workout.id,
      'growthPointsDelta', 0,
      'created', false
    );
  end if;

  select coalesce(sum(growth_points_delta), 0)::integer into v_granted
  from public.reward_ledger
  where user_id = v_user_id and workout_log_id = p_workout_id;

  v_applied := greatest(-v_granted, -v_maso.growth_points);

  insert into public.reward_ledger (
    user_id, workout_log_id, event_type, growth_points_delta,
    food_delta, request_id
  ) values (
    v_user_id, p_workout_id, 'workout_adjustment', v_applied, 0, p_request_id
  );

  update public.maso_status
  set growth_points = growth_points + v_applied
  where user_id = v_user_id;

  update public.foods
  set earned_from_volume = greatest(earned_from_volume - v_workout.volume_kg, 0)
  where user_id = v_user_id;

  update public.workout_logs
  set deleted_at = now()
  where id = p_workout_id and user_id = v_user_id;

  return jsonb_build_object(
    'id', v_workout.id,
    'growthPointsDelta', v_applied,
    'created', true
  );
end;
$$;

revoke all on function public.update_workout(
  uuid, date, numeric, text, integer, integer, text, uuid, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.delete_workout(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.update_workout(
  uuid, date, numeric, text, integer, integer, text, uuid, numeric, numeric
) to authenticated;
grant execute on function public.delete_workout(uuid, uuid) to authenticated;
