-- Research Project Tracker: update 3 — make invites reliable.
-- Paste into Supabase → SQL Editor → New query, then press Run. Safe to run more than once.

-- 1. Everyone who has an account gets a profile (some may have signed up before profiles existed).
insert into public.profiles (id, email, full_name)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data ->> 'full_name', '')
  from auth.users u
 where u.email is not null
on conflict (id) do update set email = excluded.email;

-- 2. Match invites against the email you're signed in with, not only the profile.
create or replace function public.my_email()
returns text language sql stable set search_path = public as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select email from profiles where id = auth.uid())
  ));
$$;

create or replace function public.my_invites()
returns table (project_id uuid, title text, invited_by_name text, invited_by_email text, invited_at timestamptz)
language sql security definer stable set search_path = public as $$
  select i.project_id,
         coalesce(nullif(pr.data ->> 'title', ''), nullif(i.title, ''), 'Untitled project'),
         coalesce(p.full_name, ''),
         coalesce(p.email, ''),
         i.invited_at
    from project_invites i
    join projects pr on pr.id = i.project_id
    left join profiles p on p.id = coalesce(i.invited_by, pr.owner_id)
   where i.email = my_email()
     and not exists (select 1 from project_members m where m.project_id = i.project_id and m.user_id = auth.uid())
   order by i.invited_at desc;
$$;

create or replace function public.respond_invite(pid uuid, accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  e text := my_email();
begin
  if auth.uid() is null or e is null then
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

-- 3. Keep profiles in step if someone changes their email.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = lower(new.email) where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

revoke execute on function public.my_invites() from anon;
revoke execute on function public.respond_invite(uuid, boolean) from anon;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.respond_invite(uuid, boolean) to authenticated;
grant execute on function public.my_email() to authenticated;

-- 4. A quick health check you can run any time: lists open invites and whether each email has an account.
--    select i.email, i.title, (p.id is not null) as has_account from project_invites i left join profiles p on p.email = i.email;
