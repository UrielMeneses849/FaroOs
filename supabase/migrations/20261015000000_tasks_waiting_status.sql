-- External dependencies have their own state; existing review/paused tasks stay unchanged.
alter type public.task_status add value if not exists 'waiting' before 'blocked';

notify pgrst, 'reload schema';
