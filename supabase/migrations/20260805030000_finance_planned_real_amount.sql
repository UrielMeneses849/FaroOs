alter table public.finance_transactions add column if not exists planned_amount numeric(14,2);
update public.finance_transactions set planned_amount=amount where planned_amount is null and status in('planned','pending');
create or replace function public.preserve_finance_planned_amount() returns trigger language plpgsql set search_path='' as $$ begin if new.status in('planned','pending') and new.planned_amount is null then new.planned_amount:=new.amount; end if; return new; end $$;
drop trigger if exists preserve_finance_planned_amount on public.finance_transactions;
create trigger preserve_finance_planned_amount before insert or update on public.finance_transactions for each row execute function public.preserve_finance_planned_amount();
notify pgrst,'reload schema';
