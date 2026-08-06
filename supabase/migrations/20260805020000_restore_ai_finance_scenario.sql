create or replace function public.restore_ai_finance_scenario(p_confirm_is_test_user boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid := (select auth.uid()); nu uuid; bbva uuid; transport uuid; personal uuid; housing uuid; income_cat uuid; period date:=date_trunc('month',current_date)::date; item record; rid uuid;
begin
 if uid is null or not p_confirm_is_test_user then raise exception 'Dedicated test user confirmation required'; end if;
 perform public.prepare_ai_test_environment(10000,15000,3000,true);
 insert into public.finance_categories(user_id,name,type,is_default,is_active) values(uid,'Ingresos','income',true,true),(uid,'Vivienda','expense',true,true) on conflict(user_id,name,type) do update set is_active=true;
 select id into nu from public.finance_accounts where user_id=uid and name='NU Pruebas'; select id into bbva from public.finance_accounts where user_id=uid and name='BBVA Pruebas';
 select id into transport from public.finance_categories where user_id=uid and name='Transporte' and type='expense'; select id into personal from public.finance_categories where user_id=uid and name='Personal' and type='expense'; select id into housing from public.finance_categories where user_id=uid and name='Vivienda' and type='expense'; select id into income_cat from public.finance_categories where user_id=uid and name='Ingresos' and type='income';
 delete from public.finance_transactions where user_id=uid and (description='Licencia Moto' or recurring_transaction_id in(select id from public.finance_recurring_transactions where user_id=uid and description in('Sueldo BBVA Q1','Sueldo Bimsa','Seguro Hermana','Renta','Gasolina Attitude','Gasolina Moto')));
 delete from public.finance_recurring_transactions where user_id=uid and description in('Sueldo BBVA Q1','Sueldo Bimsa','Seguro Hermana','Renta','Gasolina Attitude','Gasolina Moto');
 for item in select * from (values ('Sueldo BBVA Q1','income',7000,'biweekly',bbva,income_cat),('Sueldo Bimsa','income',38000,'monthly',bbva,income_cat),('Seguro Hermana','income',700,'monthly',bbva,income_cat),('Renta','expense',4200,'monthly',nu,housing),('Gasolina Attitude','expense',750,'monthly',nu,transport),('Gasolina Moto','expense',250,'monthly',nu,transport)) v(description,type,amount,frequency,account_id,category_id) loop
  insert into public.finance_recurring_transactions(user_id,account_id,category_id,type,amount,description,frequency,start_date,next_occurrence,is_active) values(uid,item.account_id,item.category_id,item.type::public.finance_transaction_type,item.amount,item.description,item.frequency::public.finance_frequency,current_date,current_date,true) returning id into rid;
  insert into public.finance_recurring_occurrences(user_id,recurring_transaction_id,period,expected_date,amount,status,description) values(uid,rid,period,current_date,item.amount,'pending',item.description);
 end loop;
 delete from public.finance_transactions where user_id=uid and description='Licencia Moto' and status in('planned','pending');
 insert into public.finance_transactions(user_id,account_id,category_id,type,amount,description,status,transaction_date) values(uid,nu,transport,'expense',1300,'Licencia Moto','planned',current_date);
 return jsonb_build_object('restored',true,'recurring',6,'planned',1);
end $$;
revoke all on function public.restore_ai_finance_scenario(boolean) from public;
grant execute on function public.restore_ai_finance_scenario(boolean) to authenticated;
notify pgrst,'reload schema';
