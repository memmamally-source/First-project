-- Research Project Tracker: update 5 — let people delete their own account (required for the App Store).
-- Paste into Supabase → SQL Editor → New query, then press Run. Safe to run more than once.
--
-- Deleting the account removes, through the existing "on delete cascade" links: the profile,
-- settings and meetings, every project the person owns (for everyone it was shared with),
-- their memberships of other people's projects, and invites they sent. Invites waiting for
-- their email address are removed too.

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  e text;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  select email into e from profiles where id = me;
  delete from project_invites where email = lower(coalesce(e, ''));
  delete from auth.users where id = me;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
