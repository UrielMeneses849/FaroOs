-- FARO OS Day 5: additive travel, sales, content and portfolio workflows.

create table public.travel_trips (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120), description text,
  status text not null default 'idea' check (status in ('idea','planning','booked','active','completed','cancelled')),
  start_date date, end_date date, origin text, currency char(3) not null default 'MXN',
  budget_total numeric(14,2) not null default 0 check (budget_total >= 0), travel_style text,
  travelers smallint not null default 1 check (travelers between 1 and 99), cover_image_url text,
  archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date), unique(id,user_id)
);
create table public.travel_destinations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, country text not null, city text not null, arrival_date date, departure_date date,
  nights smallint check (nights is null or nights >= 0), sort_order integer not null default 0, notes text,
  latitude numeric(9,6), longitude numeric(9,6), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, title text not null, completed boolean not null default false, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_reservations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, type text not null check(type in ('flight','hotel','train','car','activity','restaurant','insurance','other')),
  provider text not null, confirmation text, reservation_date timestamptz, amount numeric(14,2) not null default 0 check(amount >= 0),
  status text not null default 'planned' check(status in ('planned','reserved','paid','cancelled')),
  link text, notes text, document_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_itinerary_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, reservation_id uuid references public.travel_reservations(id) on delete set null,
  starts_at timestamptz not null, title text not null, type text not null check(type in ('transport','lodging','activity','food','reservation','free_time','note')),
  location text, duration_minutes integer check(duration_minutes is null or duration_minutes >= 0),
  status text not null default 'planned' check(status in ('planned','confirmed','completed','cancelled')),
  cost numeric(14,2) not null default 0 check(cost >= 0), notes text, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_budget_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, category text not null check(category in ('flights','lodging','transport','food','activities','shopping','insurance','documents','contingency','other')),
  description text not null, budgeted numeric(14,2) not null default 0 check(budgeted >= 0),
  reserved numeric(14,2) not null default 0 check(reserved >= 0), paid numeric(14,2) not null default 0 check(paid >= 0),
  finance_transaction_id uuid references public.finance_transactions(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_checklist_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, section text not null check(section in ('documents','luggage','health','payments','reservations','technology','pending')),
  title text not null, completed boolean not null default false, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, name text not null, type text, reference text, expires_on date, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);
create table public.travel_notes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, title text not null, content text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.travel_trips(id,user_id) on delete cascade
);

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, company text, email text, phone text, source text, workspace_id uuid references public.workspaces(id) on delete set null,
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.sales_opportunities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.sales_leads(id) on delete set null, client text not null, company text, service text not null,
  stage text not null default 'new' check(stage in ('new','contacted','discovery','proposal','negotiation','won','lost')),
  estimated_value numeric(14,2) not null default 0 check(estimated_value >= 0), probability smallint check(probability between 0 and 100),
  next_action text, follow_up_date date, workspace_id uuid references public.workspaces(id) on delete set null,
  notes text, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.sales_activities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null, title text not null, due_date date, completed boolean not null default false,
  task_id uuid references public.tasks(id) on delete set null, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(opportunity_id,user_id) references public.sales_opportunities(id,user_id) on delete cascade
);
create table public.sales_proposals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null, title text not null, amount numeric(14,2) not null default 0 check(amount >= 0),
  status text not null default 'draft' check(status in ('draft','sent','accepted','rejected','expired')), sent_at timestamptz, notes text,
  portfolio_project_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(opportunity_id,user_id) references public.sales_opportunities(id,user_id) on delete cascade
);

create table public.content_channels (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,name), unique(id,user_id)
);
create table public.content_campaigns (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, objective text, starts_on date, ends_on date, workspace_id uuid references public.workspaces(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.content_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, idea text, format text not null, channel_id uuid references public.content_channels(id) on delete set null,
  status text not null default 'idea' check(status in ('idea','research','draft','design','review','scheduled','published','archived')),
  objective text, publish_at timestamptz, workspace_id uuid references public.workspaces(id) on delete set null,
  campaign_id uuid references public.content_campaigns(id) on delete set null, cta text, notes text,
  portfolio_case_study_id uuid, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);

create table public.portfolio_projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, client text, role text, description text, problem text, solution text, impact text,
  technologies text[] not null default '{}', starts_on date, ends_on date,
  status text not null default 'draft' check(status in ('draft','review','published','archived')),
  links jsonb not null default '{}', workspace_id uuid references public.workspaces(id) on delete set null,
  visibility text not null default 'private' check(visibility in ('private','unlisted','public')),
  featured boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.portfolio_case_studies (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null, context text, problem text, process text, solution text, result text, metrics text,
  learnings text, testimonial text, status text not null default 'draft' check(status in ('draft','review','published','archived')),
  sales_opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
  foreign key(project_id,user_id) references public.portfolio_projects(id,user_id) on delete cascade
);
create table public.portfolio_assets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null, name text not null, url text not null, type text, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(project_id,user_id) references public.portfolio_projects(id,user_id) on delete cascade
);
create table public.portfolio_testimonials (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null, author text not null, role text, quote text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(project_id,user_id) references public.portfolio_projects(id,user_id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array[
    'travel_trips','travel_destinations','travel_goals','travel_itinerary_items','travel_reservations','travel_budget_items',
    'travel_checklist_items','travel_documents','travel_notes','sales_leads','sales_opportunities','sales_activities',
    'sales_proposals','content_channels','content_campaigns','content_items','portfolio_projects','portfolio_case_studies',
    'portfolio_assets','portfolio_testimonials'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy "Users select own %1$s" on public.%1$I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('create policy "Users insert own %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid())=user_id)',t);
    execute format('create policy "Users update own %1$s" on public.%1$I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
    execute format('create policy "Users delete own %1$s" on public.%1$I for delete to authenticated using ((select auth.uid())=user_id)',t);
    execute format('create trigger %1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()',t);
    execute format('create index %1$s_user_idx on public.%1$I(user_id)',t);
  end loop;
end $$;

create index travel_destinations_trip_idx on public.travel_destinations(trip_id,sort_order);
create index travel_itinerary_trip_date_idx on public.travel_itinerary_items(trip_id,starts_at);
create index travel_checklist_trip_idx on public.travel_checklist_items(trip_id,completed);
create index sales_pipeline_idx on public.sales_opportunities(user_id,stage,sort_order);
create index sales_follow_up_idx on public.sales_opportunities(user_id,follow_up_date);
create index content_pipeline_idx on public.content_items(user_id,status,sort_order);
create index content_publish_idx on public.content_items(user_id,publish_at);
create index portfolio_status_idx on public.portfolio_projects(user_id,status,updated_at desc);
