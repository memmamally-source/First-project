-- Research Project Tracker: update 4 — one invite per person, and accurate "Shared with" counts.
-- Paste into Supabase → SQL Editor → New query, then press Run. Safe to run more than once.

-- 1. Remove leftover invites for people who already joined the project.
delete from public.project_invites i
 using public.project_members m
  join public.profiles p on p.id = m.user_id
 where i.project_id = m.project_id
   and i.email = p.email;

-- 2. From now on, joining a project clears that person's invite to it.
create or replace function public.clear_invite_on_join()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from project_invites
   where project_id = new.project_id
     and email = (select email from profiles where id = new.user_id);
  return new;
end $$;
drop trigger if exists clear_invite_on_join on public.project_members;
create trigger clear_invite_on_join after insert on public.project_members
  for each row execute function public.clear_invite_on_join();

-- 3. Sharing again with someone already invited just re-sends it ('reinvited').
create or replace function public.share_project(pid uuid, invitee text)
returns text language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(invitee));
  uid uuid;
  existed boolean;
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
  existed := exists (select 1 from project_invites where project_id = pid and email = e);
  insert into project_invites (project_id, email, invited_by, title)
  values (pid, e, auth.uid(), coalesce((select data ->> 'title' from projects where id = pid), ''))
  on conflict (project_id, email) do update set invited_at = now(), invited_by = excluded.invited_by, title = excluded.title;
  if existed then
    return 'reinvited';
  end if;
  return case when uid is null then 'invited_new' else 'invited' end;
end $$;

-- 4. How many people each of my projects is shared with (members plus pending invites, each person once).
create or replace function public.my_share_counts()
returns table (project_id uuid, people integer)
language sql security definer stable set search_path = public as $$
  select pr.id, count(distinct who)::integer
    from projects pr
    join (
      select m.project_id, coalesce(p.email, m.user_id::text) as who
        from project_members m left join profiles p on p.id = m.user_id
      union
      select i.project_id, i.email from project_invites i
    ) s on s.project_id = pr.id
   where pr.owner_id = auth.uid()
   group by pr.id;
$$;

revoke execute on function public.share_project(uuid, text) from anon;
revoke execute on function public.my_share_counts() from anon;
grant execute on function public.share_project(uuid, text) to authenticated;
grant execute on function public.my_share_counts() to authenticated;
