-- PostgreSQL truncates the generated legacy constraint name. Remove it by
-- its constrained columns so weekly schedules can store several Saturdays.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'finance_recurring_occurrences'
      and constraint_type = 'UNIQUE'
      and constraint_name <> 'finance_recurring_occurrences_user_recurring_date_key'
  loop
    if (
      select array_agg(column_name::text order by ordinal_position)
      from information_schema.key_column_usage
      where table_schema = 'public'
        and table_name = 'finance_recurring_occurrences'
        and constraint_name = legacy_constraint.constraint_name
    ) = array['user_id', 'recurring_transaction_id', 'period'] then
      execute format(
        'alter table public.finance_recurring_occurrences drop constraint %I',
        legacy_constraint.constraint_name
      );
    end if;
  end loop;
end;
$$;
