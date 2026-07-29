-- Safe, repeatable deployment assertions for the FARO finance schema.
do $$
declare
  finance_table_count integer;
  rls_table_count integer;
  policy_count integer;
  foreign_key_count integer;
begin
  select count(*) into finance_table_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'finance_accounts', 'finance_categories', 'finance_transactions',
      'finance_recurring_transactions', 'finance_budgets',
      'finance_goals', 'finance_goal_contributions'
    );

  if finance_table_count <> 7 then
    raise exception 'Finance schema verification failed: expected 7 tables, found %',
      finance_table_count;
  end if;

  select count(*) into rls_table_count
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in (
      'finance_accounts', 'finance_categories', 'finance_transactions',
      'finance_recurring_transactions', 'finance_budgets',
      'finance_goals', 'finance_goal_contributions'
    )
    and relrowsecurity;

  if rls_table_count <> 7 then
    raise exception 'Finance security verification failed: expected RLS on 7 tables, found %',
      rls_table_count;
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'finance_accounts', 'finance_categories', 'finance_transactions',
      'finance_recurring_transactions', 'finance_budgets',
      'finance_goals', 'finance_goal_contributions'
    )
    and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  if policy_count <> 28 then
    raise exception 'Finance policy verification failed: expected 28 policies, found %',
      policy_count;
  end if;

  select count(*) into foreign_key_count
  from information_schema.table_constraints
  where constraint_schema = 'public'
    and table_name like 'finance_%'
    and constraint_type = 'FOREIGN KEY';

  if foreign_key_count < 17 then
    raise exception 'Finance relationship verification failed: expected at least 17 foreign keys, found %',
      foreign_key_count;
  end if;
end;
$$;

notify pgrst, 'reload schema';
