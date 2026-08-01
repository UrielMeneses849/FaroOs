create or replace function public.close_finance_budget(target_budget_id uuid,target_destination text,target_goal_id uuid default null)
returns uuid language plpgsql set search_path='' as $$
declare b public.finance_budgets; spent numeric(14,2); leftover numeric(14,2); closure_id uuid:=gen_random_uuid(); next_start date; next_end date; fund_id uuid;
begin
  select * into b from public.finance_budgets where id=target_budget_id and user_id=(select auth.uid());
  if b.id is null then raise exception 'Presupuesto no encontrado'; end if;
  if b.period_end>=current_date then raise exception 'La quincena aún no termina'; end if;
  select coalesce(sum(t.amount),0) into spent from public.finance_transactions t
  join public.finance_categories c on c.id=t.category_id and c.user_id=t.user_id
  where t.user_id=(select auth.uid()) and t.status='completed' and t.type in('expense','debt_payment')
    and t.transaction_date between b.period_start and b.period_end and (t.budget_id=b.id or(t.budget_id is null and c.id=b.category_id and c.name='Personal'));
  leftover:=greatest(0,b.planned_amount-spent);
  if target_destination='next_period' then
    next_start:=b.period_end+1;next_end:=case when extract(day from next_start)<=15 then date_trunc('month',next_start)::date+14 else (date_trunc('month',next_start)+interval '1 month-1 day')::date end;
    insert into public.finance_budgets(user_id,category_id,month,planned_amount,name,period_start,period_end,carry_over_enabled)
    values((select auth.uid()),b.category_id,date_trunc('month',next_start)::date,leftover,b.name,next_start,next_end,true)
    on conflict(user_id,name,period_start) do update set planned_amount=public.finance_budgets.planned_amount+excluded.planned_amount;
  elsif target_destination='goal' then
    if target_goal_id is null then raise exception 'Selecciona una meta';end if;
    insert into public.finance_goal_contributions(user_id,goal_id,amount,contribution_date,contribution_source,description)
    values((select auth.uid()),target_goal_id,leftover,current_date,'previously_reserved','Sobrante de presupuesto');
  elsif target_destination='savings_fund' then
    select id into fund_id from public.finance_savings_funds where user_id=(select auth.uid());
    insert into public.finance_savings_fund_entries(user_id,fund_id,amount,entry_date,description) values((select auth.uid()),fund_id,leftover,current_date,'Sobrante de presupuesto');
  elsif target_destination<>'available' then raise exception 'Destino inválido'; end if;
  insert into public.finance_budget_closures(id,user_id,budget_id,leftover_amount,destination,goal_id) values(closure_id,(select auth.uid()),b.id,leftover,target_destination,target_goal_id);
  return closure_id;
end $$;
revoke all on function public.close_finance_budget(uuid,text,uuid) from public;
grant execute on function public.close_finance_budget(uuid,text,uuid) to authenticated;
