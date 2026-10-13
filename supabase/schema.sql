-- Research Project Tracker: database setup.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- Safe to run again: it only creates what's missing and replaces functions/policies.

-- People who have signed up (filled in automatically on sign-up).
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

-- One row per project; the project and its tasks live in `data`.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who a project is shared with.
create table if not exists public.project_members (
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Shares sent to an email that hasn't signed up yet; turned into members when they do.
create table if not exists public.project_invites (
  project_id uuid not null references public.projects on delete cascade,
  email text not null,
  invited_at timestamptz not null default now(),
  primary key (project_id, email)
);

-- Per-person settings (dashboard name, study-type filter and so on).
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Access checks. SECURITY DEFINER so policies can use them without recursing.
create or replace function public.is_project_owner(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from projects where id = pid and owner_id = auth.uid());
$$;

create or replace function public.can_access_project(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from projects where id = pid and owner_id = auth.uid())
      or exists (select 1 from project_members where project_id = pid and user_id = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for select using (id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "read accessible projects" on public.projects;
create policy "read accessible projects" on public.projects
  for select using (public.can_access_project(id));
drop policy if exists "create own projects" on public.projects;
create policy "create own projects" on public.projects
  for insert with check (owner_id = auth.uid());
drop policy if exists "edit accessible projects" on public.projects;
create policy "edit accessible projects" on public.projects
  for update using (public.can_access_project(id)) with check (public.can_access_project(id));
drop policy if exists "owner deletes project" on public.projects;
create policy "owner deletes project" on public.projects
  for delete using (owner_id = auth.uid());

drop policy if exists "see memberships" on public.project_members;
create policy "see memberships" on public.project_members
  for select using (user_id = auth.uid() or public.is_project_owner(project_id));
drop policy if exists "owner removes or member leaves" on public.project_members;
create policy "owner removes or member leaves" on public.project_members
  for delete using (user_id = auth.uid() or public.is_project_owner(project_id));

drop policy if exists "owner sees invites" on public.project_invites;
create policy "owner sees invites" on public.project_invites
  for select using (public.is_project_owner(project_id));
drop policy if exists "owner cancels invites" on public.project_invites;
create policy "owner cancels invites" on public.project_invites
  for delete using (public.is_project_owner(project_id));

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Members can edit a shared project but never take it over.
create or replace function public.protect_project_owner()
returns trigger language plpgsql as $$
begin
  new.owner_id := old.owner_id;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists protect_project_owner on public.projects;
create trigger protect_project_owner before update on public.projects
  for each row execute function public.protect_project_owner();

-- On sign-up: create the profile and accept any pending shares for that email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into project_members (project_id, user_id)
  select project_id, new.id from project_invites where email = lower(new.email)
  on conflict do nothing;
  delete from project_invites where email = lower(new.email);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Share a project by email. Returns 'added', 'invited' (not signed up yet) or 'self'.
create or replace function public.share_project(pid uuid, invitee text)
returns text language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(invitee));
  uid uuid;
begin
  if not is_project_owner(pid) then
    raise exception 'Only the project owner can share it';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not a valid email address';
  end if;
  select id into uid from profiles where email = e;
  if uid is null then
    insert into project_invites (project_id, email) values (pid, e) on conflict do nothing;
    return 'invited';
  end if;
  if uid = auth.uid() then
    return 'self';
  end if;
  insert into project_members (project_id, user_id) values (pid, uid) on conflict do nothing;
  return 'added';
end $$;

-- Everyone on a project, for the people who can see it.
create or replace function public.project_people(pid uuid)
returns table (user_id uuid, email text, full_name text, role text)
language sql security definer stable set search_path = public as $$
  select p.id, p.email, p.full_name, 'owner'
    from projects pr join profiles p on p.id = pr.owner_id
   where pr.id = pid and can_access_project(pid)
  union all
  select p.id, p.email, p.full_name, 'member'
    from project_members m join profiles p on p.id = m.user_id
   where m.project_id = pid and can_access_project(pid)
  union all
  select null, i.email, '', 'invited'
    from project_invites i
   where i.project_id = pid and is_project_owner(pid);
$$;

revoke execute on function public.share_project(uuid, text) from anon;
revoke execute on function public.project_people(uuid) from anon;
