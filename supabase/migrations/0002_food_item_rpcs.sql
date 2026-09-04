-- Add the food item inventory and the atomic RPCs used by the cloud provider.
--
-- Result contracts:
--   exchange_food   -> { growthPoints, food, protein, created }
--   feed_maso_item  -> { level, experience, food, protein, created }
--
-- `created` is false when a completed request is replayed with the same
-- request id and payload. Reusing the request id with another payload fails.

alter table public.foods
  add column protein_balance integer not null default 0
    check (protein_balance >= 0);

-- The existing food log already provides the idempotency key and mascot
-- result for feeding. These two columns distinguish the inventory item and
-- preserve the complete response for an exact replay.
alter table public.food_logs
  add column kind text not null default 'onigiri'
    check (kind in ('onigiri', 'protein')),
  add column after_protein_balance integer not null default 0
    check (after_protein_balance >= 0);

-- Keep the immutable reward ledger complete while distinguishing which item
-- was consumed. Existing v1 food-use entries were all onigiri.
alter table public.reward_ledger
  add column food_kind text
    check (food_kind is null or food_kind in ('onigiri', 'protein'));

update public.reward_ledger
set food_kind = 'onigiri'
where event_type = 'food_use' and food_kind is null;

alter table public.reward_ledger
  drop constraint reward_ledger_event_shape;

alter table public.reward_ledger
  add constraint reward_ledger_event_shape check (
    (
      event_type = 'workout_reward'
      and workout_log_id is not null
      and growth_points_delta >= 0
      and food_delta >= 0
      and experience_delta = 0
      and food_kind is null
    )
    or (
      event_type = 'workout_adjustment'
      and workout_log_id is not null
      and experience_delta = 0
      and food_kind is null
    )
    or (
      event_type = 'food_use'
      and workout_log_id is null
      and growth_points_delta = 0
      and food_delta < 0
      and experience_delta > 0
      and food_kind is not null
      and food_kind in ('onigiri', 'protein')
    )
  );

create table public.food_exchange_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('onigiri', 'protein')),
  amount integer not null check (amount between 1 and 1000),
  after_growth_points integer not null check (after_growth_points >= 0),
  after_food_balance integer not null check (after_food_balance >= 0),
  after_protein_balance integer not null check (after_protein_balance >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.food_exchange_logs enable row level security;

create policy food_exchange_logs_owner_select
  on public.food_exchange_logs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Match the UI reward model: a workout earns growth points only. The food row
-- remains in the lock order and still records cumulative workout volume, but
-- neither food inventory is awarded directly by this RPC.
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
    'growthPoints', v_growth,
    'food', v_food,
    'created', true
  );
end;
$$;

create or replace function public.exchange_food(
  p_kind text,
  p_amount integer,
  p_request_id uuid,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_maso public.maso_status%rowtype;
  v_food public.foods%rowtype;
  v_exchange public.food_exchange_logs%rowtype;
  v_unit_cost integer;
  v_total_cost integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'authentication context changed' using errcode = '42501';
  end if;

  if p_request_id is null
    or p_kind is null or p_kind not in ('onigiri', 'protein')
    or p_amount is null or p_amount not between 1 and 1000 then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  select * into v_exchange
  from public.food_exchange_logs
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_exchange.kind is distinct from p_kind
      or v_exchange.amount is distinct from p_amount then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'growthPoints', v_exchange.after_growth_points,
      'food', v_exchange.after_food_balance,
      'protein', v_exchange.after_protein_balance,
      'created', false
    );
  end if;

  -- All reward/inventory RPCs lock mascot state before food state. Keeping one
  -- global order prevents deadlocks with save_workout and the feeding RPCs.
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

  -- A concurrent replay waits on the user's state rows, then observes the log.
  select * into v_exchange
  from public.food_exchange_logs
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_exchange.kind is distinct from p_kind
      or v_exchange.amount is distinct from p_amount then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'growthPoints', v_exchange.after_growth_points,
      'food', v_exchange.after_food_balance,
      'protein', v_exchange.after_protein_balance,
      'created', false
    );
  end if;

  v_unit_cost := case p_kind
    when 'onigiri' then 5
    when 'protein' then 15
  end;
  v_total_cost := p_amount * v_unit_cost;

  if v_maso.growth_points < v_total_cost then
    raise exception 'insufficient growth points' using errcode = '22023';
  end if;

  if (p_kind = 'onigiri' and v_food.balance > 2147483647 - p_amount)
    or (p_kind = 'protein' and v_food.protein_balance > 2147483647 - p_amount) then
    raise exception 'inventory limit reached' using errcode = '22003';
  end if;

  update public.maso_status
  set growth_points = growth_points - v_total_cost
  where user_id = v_user_id
  returning * into v_maso;

  update public.foods
  set balance = balance + case when p_kind = 'onigiri' then p_amount else 0 end,
      protein_balance = protein_balance
        + case when p_kind = 'protein' then p_amount else 0 end
  where user_id = v_user_id
  returning * into v_food;

  insert into public.food_exchange_logs (
    user_id, request_id, kind, amount, after_growth_points,
    after_food_balance, after_protein_balance
  ) values (
    v_user_id, p_request_id, p_kind, p_amount, v_maso.growth_points,
    v_food.balance, v_food.protein_balance
  );

  return jsonb_build_object(
    'growthPoints', v_maso.growth_points,
    'food', v_food.balance,
    'protein', v_food.protein_balance,
    'created', true
  );
end;
$$;

create or replace function public.feed_maso_item(
  p_kind text,
  p_amount integer,
  p_request_id uuid,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_maso public.maso_status%rowtype;
  v_food public.foods%rowtype;
  v_food_log public.food_logs%rowtype;
  v_before_level integer;
  v_before_experience integer;
  v_experience_per_item integer;
  v_added_experience integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'authentication context changed' using errcode = '42501';
  end if;

  if p_request_id is null
    or p_kind is null or p_kind not in ('onigiri', 'protein')
    or p_amount is null or p_amount not between 1 and 1000 then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  select * into v_food_log
  from public.food_logs
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_food_log.kind is distinct from p_kind
      or v_food_log.used_points is distinct from p_amount then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'level', v_food_log.after_level,
      'experience', v_food_log.after_experience,
      'food', v_food_log.after_food_balance,
      'protein', v_food_log.after_protein_balance,
      'created', false
    );
  end if;

  -- Preserve the same lock order as save_workout, feed_maso, and exchange_food.
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

  -- Recheck after locking so simultaneous retries cannot apply twice.
  select * into v_food_log
  from public.food_logs
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_food_log.kind is distinct from p_kind
      or v_food_log.used_points is distinct from p_amount then
      raise exception 'idempotency key reused with different payload'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'level', v_food_log.after_level,
      'experience', v_food_log.after_experience,
      'food', v_food_log.after_food_balance,
      'protein', v_food_log.after_protein_balance,
      'created', false
    );
  end if;

  if (p_kind = 'onigiri' and v_food.balance < p_amount)
    or (p_kind = 'protein' and v_food.protein_balance < p_amount) then
    raise exception 'insufficient food' using errcode = '22023';
  end if;

  v_before_level := v_maso.level;
  v_before_experience := v_maso.experience;
  v_experience_per_item := case p_kind
    when 'onigiri' then 10
    when 'protein' then 30
  end;
  v_added_experience := p_amount * v_experience_per_item;
  v_maso.experience := v_maso.experience + v_added_experience;

  while v_maso.level < 999
    and v_maso.experience >= 100 * v_maso.level loop
    v_maso.experience := v_maso.experience - 100 * v_maso.level;
    v_maso.level := v_maso.level + 1;
  end loop;

  if v_maso.level = 999 then
    v_maso.experience := least(v_maso.experience, 99900);
  end if;

  update public.maso_status
  set level = v_maso.level,
      experience = v_maso.experience
  where user_id = v_user_id;

  update public.foods
  set balance = balance - case when p_kind = 'onigiri' then p_amount else 0 end,
      protein_balance = protein_balance
        - case when p_kind = 'protein' then p_amount else 0 end,
      used_points = used_points + p_amount
  where user_id = v_user_id
  returning * into v_food;

  insert into public.food_logs (
    user_id, kind, used_points, before_level, after_level,
    before_experience, after_experience, experience_gained,
    after_food_balance, after_protein_balance, request_id
  ) values (
    v_user_id, p_kind, p_amount, v_before_level, v_maso.level,
    v_before_experience, v_maso.experience, v_added_experience,
    v_food.balance, v_food.protein_balance, p_request_id
  )
  returning * into v_food_log;

  insert into public.reward_ledger (
    user_id, event_type, growth_points_delta, food_delta,
    experience_delta, request_id, food_kind
  ) values (
    v_user_id, 'food_use', 0, -p_amount,
    v_added_experience, p_request_id, p_kind
  );

  if v_maso.level > v_before_level then
    insert into public.growth_logs (
      user_id, before_level, after_level, trigger_points, request_id
    ) values (
      v_user_id, v_before_level, v_maso.level, p_amount, p_request_id
    );
  end if;

  return jsonb_build_object(
    'level', v_food_log.after_level,
    'experience', v_food_log.after_experience,
    'food', v_food_log.after_food_balance,
    'protein', v_food_log.after_protein_balance,
    'created', true
  );
end;
$$;

-- Bind name changes to the account that was visible when the user acted. This
-- prevents a cross-tab session change from renaming another account's mascot.
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
  from public, anon, authenticated;
-- Retire the one-item v1 RPC; it cannot return or preserve protein inventory.
revoke all on function public.feed_maso(integer, uuid)
  from public, anon, authenticated;
-- Retire the v1 rename RPC because it cannot bind an intent to an account.
revoke all on function public.rename_maso(text)
  from public, anon, authenticated;
revoke all on function public.exchange_food(text, integer, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.feed_maso_item(text, integer, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.rename_maso(text, uuid)
  from public, anon, authenticated;
grant execute on function public.save_workout(uuid, date, numeric, text, integer, integer, text, uuid)
  to authenticated;
grant execute on function public.exchange_food(text, integer, uuid, uuid)
  to authenticated;
grant execute on function public.feed_maso_item(text, integer, uuid, uuid)
  to authenticated;
grant execute on function public.rename_maso(text, uuid)
  to authenticated;

revoke all on public.food_exchange_logs from public, anon, authenticated;
grant select on public.food_exchange_logs to authenticated;
