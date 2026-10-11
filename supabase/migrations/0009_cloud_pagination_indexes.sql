-- Initial cloud loading filters by owner and pages in (created_at, id) order.
-- Keep the existing date/exercise indexes for history and analytics queries.
create index exercises_user_created_id_idx
  on public.exercises (user_id, created_at, id);

create index workout_logs_user_created_id_idx
  on public.workout_logs (user_id, created_at, id)
  where deleted_at is null;
