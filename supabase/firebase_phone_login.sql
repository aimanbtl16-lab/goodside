-- Good Side: lookup used by the Edge Function firebase-phone-login (SMS codes sent by Google Firebase).
-- Returns the account id for a phone number (639XXXXXXXXX). Only the server (service_role) may call it.
create or replace function public.auth_user_id_by_phone(p_phone text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select u.id from auth.users u where u.phone = p_phone and u.deleted_at is null limit 1);
end
$$;

revoke execute on function public.auth_user_id_by_phone(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_phone(text) to service_role;
