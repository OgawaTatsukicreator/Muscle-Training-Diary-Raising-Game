-- More kinds of food: バナナ (banana), ささみ (chicken) and ステーキ (steak) join
-- おにぎり (onigiri) and プロテイン (protein).
--
-- onigiri and protein keep their existing columns (foods.balance and
-- foods.protein_balance) so history, logs and the response contract of the
-- RPCs stay untouched. The new kinds live in food_inventory, one row per kind.
-- Every RPC result gains an `items` object with the current balance of the
-- new kinds: { "banana": n, "chicken": n, "steak": n }.
--
-- Prices and experience (keep in sync with FOOD_ITEMS in lib/domain/growth.ts;
-- a unit test compares them):
--   banana   2 pt ->  4 XP
--   onigiri  5 pt -> 10 XP
--   chicken 10 pt -> 21 XP
--   protein 15 pt -> 30 XP
--   steak   40 pt -> 90 XP

create table public.food_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('banana', 'chicken', 'steak')),
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create trigger food_inventory_set_updated_at
before update on public.food_inventory
for each row execute function public.set_updated_at();

alter table public.food_inventory enable row level security;

create policy food_inventory_owner_select on public.food_inventory
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.food_inventory from public, anon, authenticated;
grant select on public.food_inventory to authenticated;

-- The logs record the balance of the kind that was used.
alter table public.food_logs add column after_item_balance integer
  check (after_item_balance is null or after_item_balance >= 0);
alter table public.food_exchange_logs add column after_item_balance integer
  check (after_item_balance is null or after_item_balance >= 0);

alter table public.food_logs drop constraint food_logs_kind_check;
alter table public.food_logs add constraint food_logs_kind_check
  check (kind in ('onigiri', 'protein', 'banana', 'chicken', 'steak'));

alter table public.food_exchange_logs drop constraint food_exchange_logs_kind_check;
alter table public.food_exchange_logs add constraint food_exchange_logs_kind_check
  check (kind in ('onigiri', 'protein', 'banana', 'chicken', 'steak'));

alter table public.reward_ledger drop constraint reward_ledger_food_kind_check;
alter table public.reward_ledger add constraint reward_ledger_food_kind_check
  check (
    food_kind is null
    or food_kind in ('onigiri', 'protein', 'banana', 'chicken', 'steak')
  );

alter table public.reward_ledger drop constraint reward_ledger_event_shape;
alter table public.reward_ledger add constraint reward_ledger_event_shape check (
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
    and food_kind in ('onigiri', 'protein', 'banana', 'chicken', 'steak')
  )
);

-- Price and experience of one item. NULL for an unknown kind.
create or replace function public.food_item_stats(
  p_kind text,
  out o_cost integer,
  out o_experience integer
)
language sql
immutable
set search_path = ''
as $$
  select
    case p_kind
      when 'banana' then 2
      when 'onigiri' then 5
      when 'chicken' then 10
      when 'protein' then 15
      when 'steak' then 40
    end,
    case p_kind
      when 'banana' then 4
      when 'onigiri' then 10
      when 'chicken' then 21
      when 'protein' then 30
      when 'steak' then 90
    end
$$;

revoke all on function public.food_item_stats(text) from public, anon, authenticated;

-- The new kinds' balances as one JSON object (0 for kinds never owned).
create or replace function public.food_items_json(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'banana', coalesce(max(balance) filter (where kind = 'banana'), 0),
    'chicken', coalesce(max(balance) filter (where kind = 'chicken'), 0),
    'steak', coalesce(max(balance) filter (where kind = 'steak'), 0)
  )
  from public.food_inventory
  where user_id = p_user_id
$$;

revoke all on function public.food_items_json(uuid) from public, anon, authenticated;

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
  v_item_balance integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'authentication context changed' using errcode = '42501';
  end if;

  if p_request_id is null
    or p_kind is null
    or (select o_cost from public.food_item_stats(p_kind)) is null
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
      'items', public.food_items_json(v_user_id),
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
      'items', public.food_items_json(v_user_id),
      'created', false
    );
  end if;

  v_unit_cost := (select o_cost from public.food_item_stats(p_kind));
  v_total_cost := p_amount * v_unit_cost;

  if v_maso.growth_points < v_total_cost then
    raise exception 'insufficient growth points' using errcode = '22023';
  end if;

  if p_kind in ('banana', 'chicken', 'steak') then
    select balance into v_item_balance
    from public.food_inventory
    where user_id = v_user_id and kind = p_kind
    for update;

    if coalesce(v_item_balance, 0) > 2147483647 - p_amount then
      raise exception 'inventory limit reached' using errcode = '22003';
    end if;
  elsif (p_kind = 'onigiri' and v_food.balance > 2147483647 - p_amount)
    or (p_kind = 'protein' and v_food.protein_balance > 2147483647 - p_amount) then
    raise exception 'inventory limit reached' using errcode = '22003';
  end if;

  update public.maso_status
  set growth_points = growth_points - v_total_cost
  where user_id = v_user_id
  returning * into v_maso;

  if p_kind in ('banana', 'chicken', 'steak') then
    insert into public.food_inventory (user_id, kind, balance)
    values (v_user_id, p_kind, p_amount)
    on conflict (user_id, kind)
      do update set balance = public.food_inventory.balance + excluded.balance
    returning balance into v_item_balance;
  else
    update public.foods
    set balance = balance + case when p_kind = 'onigiri' then p_amount else 0 end,
        protein_balance = protein_balance
          + case when p_kind = 'protein' then p_amount else 0 end
    where user_id = v_user_id
    returning * into v_food;

    v_item_balance := null;
  end if;

  insert into public.food_exchange_logs (
    user_id, request_id, kind, amount, after_growth_points,
    after_food_balance, after_protein_balance, after_item_balance
  ) values (
    v_user_id, p_request_id, p_kind, p_amount, v_maso.growth_points,
    v_food.balance, v_food.protein_balance, v_item_balance
  );

  return jsonb_build_object(
    'growthPoints', v_maso.growth_points,
    'food', v_food.balance,
    'protein', v_food.protein_balance,
    'items', public.food_items_json(v_user_id),
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
  v_item_balance integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_user_id is null or p_expected_user_id <> v_user_id then
    raise exception 'authentication context changed' using errcode = '42501';
  end if;

  if p_request_id is null
    or p_kind is null
    or (select o_cost from public.food_item_stats(p_kind)) is null
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
      'items', public.food_items_json(v_user_id),
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
      'items', public.food_items_json(v_user_id),
      'created', false
    );
  end if;

  if p_kind in ('banana', 'chicken', 'steak') then
    select balance into v_item_balance
    from public.food_inventory
    where user_id = v_user_id and kind = p_kind
    for update;

    if coalesce(v_item_balance, 0) < p_amount then
      raise exception 'insufficient food' using errcode = '22023';
    end if;
  elsif (p_kind = 'onigiri' and v_food.balance < p_amount)
    or (p_kind = 'protein' and v_food.protein_balance < p_amount) then
    raise exception 'insufficient food' using errcode = '22023';
  end if;

  v_before_level := v_maso.level;
  v_before_experience := v_maso.experience;
  v_experience_per_item := (select o_experience from public.food_item_stats(p_kind));
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

  if p_kind in ('banana', 'chicken', 'steak') then
    update public.food_inventory
    set balance = balance - p_amount
    where user_id = v_user_id and kind = p_kind
    returning balance into v_item_balance;

    update public.foods
    set used_points = used_points + p_amount
    where user_id = v_user_id
    returning * into v_food;
  else
    update public.foods
    set balance = balance - case when p_kind = 'onigiri' then p_amount else 0 end,
        protein_balance = protein_balance
          - case when p_kind = 'protein' then p_amount else 0 end,
        used_points = used_points + p_amount
    where user_id = v_user_id
    returning * into v_food;

    v_item_balance := null;
  end if;

  insert into public.food_logs (
    user_id, kind, used_points, before_level, after_level,
    before_experience, after_experience, experience_gained,
    after_food_balance, after_protein_balance, after_item_balance, request_id
  ) values (
    v_user_id, p_kind, p_amount, v_before_level, v_maso.level,
    v_before_experience, v_maso.experience, v_added_experience,
    v_food.balance, v_food.protein_balance, v_item_balance, p_request_id
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
    'items', public.food_items_json(v_user_id),
    'created', true
  );
end;
$$;
