-- Research Project Tracker: update 2 — sharing becomes an invitation to accept or decline.
-- Paste into Supabase → SQL Editor → New query, then press Run. Safe to run more than once.

alter table public.project_invites
  add column if not exists invited_by uuid references auth.users on delete cascade;
alter table public.project_invites
  add column if not exists title text not null default '';

-- New accounts no longer join shared projects automatically; their invites wait for them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

-- Invite someone by email. Returns 'invited', 'invited_new' (no account yet), 'already' or 'self'.
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
  if uid = auth.uid() then
    return 'self';
  end if;
  if uid is not null and exists (select 1 from project_members where project_id = pid and user_id = uid) then
    return 'already';
  end if;
  insert into project_invites (project_id, email, invited_by, title)
  values (pid, e, auth.uid(), coalesce((select data ->> 'title' from projects where id = pid), ''))
  on conflict (project_id, email) do update set invited_at = now(), invited_by = excluded.invited_by, title = excluded.title;
  return case when uid is null then 'invited_new' else 'invited' end;
end $$;

-- Invites waiting for the signed-in person.
create or replace function public.my_invites()
returns table (project_id uuid, title text, invited_by_name text, invited_by_email text, invited_at timestamptz)
language sql security definer stable set search_path = public as $$
  select i.project_id,
         coalesce(nullif(pr.data ->> 'title', ''), nullif(i.title, ''), 'Untitled project'),
         coalesce(p.full_name, ''),
         coalesce(p.email, ''),
         i.invited_at
    from project_invites i
    join profiles me on me.id = auth.uid() and i.email = me.email
    join projects pr on pr.id = i.project_id
    left join profiles p on p.id = coalesce(i.invited_by, pr.owner_id)
   order by i.invited_at desc;
$$;

-- Accept or decline an invite. Returns 'accepted', 'declined' or 'gone' (withdrawn meanwhile).
create or replace function public.respond_invite(pid uuid, accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  e text;
begin
  select email into e from profiles where id = auth.uid();
  if e is null then
    raise exception 'Sign in first';
  end if;
  delete from project_invites where project_id = pid and email = e;
  if not found then
    return 'gone';
  end if;
  if accept then
    insert into project_members (project_id, user_id) values (pid, auth.uid()) on conflict do nothing;
    return 'accepted';
  end if;
  return 'declined';
end $$;

revoke execute on function public.my_invites() from anon;
revoke execute on function public.respond_invite(uuid, boolean) from anon;
revoke execute on function public.share_project(uuid, text) from anon;
