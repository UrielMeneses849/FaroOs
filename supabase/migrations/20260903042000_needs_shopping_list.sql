-- Make Needs useful both as a live shopping list and as a quiet replenishment
-- library. A row remains the single source of truth for an item: checking it
-- off never creates a second record or a finance transaction.
alter table public.needs_items
  add column if not exists shopping_group text not null default 'supermarket'
    check (shopping_group in ('supermarket', 'pharmacy', 'cat', 'home', 'other')),
  add column if not exists quantity text,
  add column if not exists is_on_shopping_list boolean not null default false;

alter table public.needs_items
  drop constraint if exists needs_items_frequency_check;

alter table public.needs_items
  add constraint needs_items_frequency_check
    check (frequency in ('as_needed', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'one_time'));

-- Existing items that are due already belong in the new live list. Future
-- repeats stay in the optional routine library until they are needed again.
update public.needs_items
set is_on_shopping_list = true
where is_active
  and (frequency = 'one_time' or next_needed_on <= current_date);

update public.needs_items
set shopping_group = case category
  when 'cat' then 'cat'
  when 'personal' then 'pharmacy'
  when 'home' then 'supermarket'
  when 'big_purchase' then 'home'
  else 'other'
end
where shopping_group = 'supermarket';

create index if not exists needs_items_user_shopping_list_idx
  on public.needs_items (user_id, is_active, is_on_shopping_list, shopping_group);

notify pgrst, 'reload schema';
