-- Good Side: base de données Supabase
-- Déjà installée sur le projet « Goodside Projet ». À garder comme référence,
-- ou à coller dans Supabase > SQL Editor pour recréer la base sur un nouveau projet.
-- Le script n'efface rien et peut être relancé sans danger.

-- 1. Profils (un par compte). Lecture seule depuis le site : personne ne peut se nommer admin.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'Profils visibles') then
    create policy "Profils visibles" on public.profiles for select using (true);
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 2. Annonces
create table if not exists public.listings (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cat text not null check (cat in ('sasakyan','motorsiklo','cellphone','electronics','ariarian','paupahan','damit','kasangkapan','trabaho','serbisyo')),
  title text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 2000),
  price numeric(14,2) not null check (price >= 0),
  unit text not null default '' check (unit in ('','month','hour')),
  location text not null check (char_length(location) between 2 and 40),
  photo_paths text[] not null default '{}',
  status text not null default 'active' check (status in ('active','sold','hidden')),
  report_count int not null default 0,
  created_at timestamptz not null default now(),
  bumped_at timestamptz not null default now(),   -- I-angat : remonte l'annonce
  featured_until timestamptz,                     -- Tampok : en vedette jusqu'à cette date
  negotiable boolean not null default false,      -- « Pwede tawad » : prix négociable
  deals text[] not null default '{}' check (deals <@ array['meetup','cod','shipping']::text[]),
  phone_verified boolean not null default false   -- badge « numéro vérifié », calculé par la base
);
-- Pour une base créée avant ces colonnes (migrations goodside_09 et goodside_10)
alter table public.listings
  add column if not exists negotiable boolean not null default false,
  add column if not exists deals text[] not null default '{}' check (deals <@ array['meetup','cod','shipping']::text[]),
  add column if not exists phone_verified boolean not null default false;
alter table public.listings drop constraint if exists listings_cat_check;
alter table public.listings add constraint listings_cat_check check (cat in (
  'sasakyan','motorsiklo','cellphone','electronics','ariarian','paupahan','damit','kasangkapan','trabaho','serbisyo'
));
create index if not exists listings_feed_idx on public.listings (status, bumped_at desc);
create index if not exists listings_cat_idx on public.listings (cat);
alter table public.listings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'listings' and policyname = 'Tout le monde voit les annonces actives') then
    create policy "Tout le monde voit les annonces actives" on public.listings
      for select using (status = 'active' or user_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'listings' and policyname = 'Un compte publie ses propres annonces') then
    create policy "Un compte publie ses propres annonces" on public.listings
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'listings' and policyname = 'Le vendeur ou un admin modifie') then
    create policy "Le vendeur ou un admin modifie" on public.listings
      for update to authenticated using (user_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'listings' and policyname = 'Le vendeur ou un admin supprime') then
    create policy "Le vendeur ou un admin supprime" on public.listings
      for delete to authenticated using (user_id = auth.uid() or public.is_admin());
  end if;
end $$;

-- Limite anti-spam : 10 annonces par 24 h et par compte
create or replace function public.limit_listings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.listings
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Limit reached: 10 listings per day';
  end if;
  new.status := 'active';
  new.report_count := 0;
  new.bumped_at := now();
  new.featured_until := null;
  return new;
end $$;
create or replace trigger listings_limit before insert on public.listings
  for each row execute function public.limit_listings();

-- Un vendeur ne peut ni remettre en ligne une annonce masquée, ni effacer ses signalements,
-- ni s'offrir I-angat ou Tampok
create or replace function public.protect_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('goodside.moderating', true), '') = 'on' then
    return new;
  end if;
  if not public.is_admin() then
    new.report_count := old.report_count;
    if old.status = 'hidden' then new.status := 'hidden'; end if;
    if new.status = 'hidden' and old.status <> 'hidden' then new.status := old.status; end if;
    new.user_id := old.user_id;
    new.bumped_at := old.bumped_at;
    new.featured_until := old.featured_until;
  end if;
  return new;
end $$;
create or replace trigger listings_protect before update on public.listings
  for each row execute function public.protect_moderation();

-- Badge « numéro vérifié » : vrai si le compte du vendeur a confirmé son numéro par SMS.
-- Le nom du trigger le fait passer après listings_protect, qui remet user_id à sa valeur d'origine.
create or replace function public.set_phone_verified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.phone_verified := exists (
    select 1 from auth.users u where u.id = new.user_id and u.phone_confirmed_at is not null
  );
  return new;
end $$;
create or replace trigger listings_verify_phone before insert or update on public.listings
  for each row execute function public.set_phone_verified();

-- 3. Contact du vendeur : table à part, jamais lisible directement.
-- Seul get_contact() le donne, et seulement à un visiteur connecté.
create table if not exists public.listing_contacts (
  listing_id bigint primary key references public.listings (id) on delete cascade,
  contact text not null check (char_length(contact) between 3 and 40)
);
alter table public.listing_contacts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'listing_contacts' and policyname = 'Le vendeur ajoute son contact') then
    create policy "Le vendeur ajoute son contact" on public.listing_contacts
      for insert to authenticated
      with check (exists (select 1 from public.listings l where l.id = listing_id and l.user_id = auth.uid()));
  end if;
end $$;

create or replace function public.get_contact(listing_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else c.contact end
  from public.listings l left join public.listing_contacts c on c.listing_id = l.id
  where l.id = get_contact.listing_id and l.status = 'active';
$$;

-- 4. Signalements : 3 signalements masquent l'annonce jusqu'à vérification
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter)
);
alter table public.reports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'reports' and policyname = 'Un compte signale') then
    create policy "Un compte signale" on public.reports
      for insert to authenticated with check (reporter = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'reports' and policyname = 'Les admins lisent les signalements') then
    create policy "Les admins lisent les signalements" on public.reports
      for select to authenticated using (public.is_admin());
  end if;
end $$;

create or replace function public.on_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('goodside.moderating', 'on', true);
  update public.listings
     set report_count = report_count + 1,
         status = case when report_count + 1 >= 3 and status = 'active' then 'hidden' else status end
   where id = new.listing_id;
  perform set_config('goodside.moderating', 'off', true);
  return new;
end $$;
create or replace trigger reports_count after insert on public.reports
  for each row execute function public.on_report();

-- 5. Photos : dossier public en lecture, chaque compte n'écrit que dans son propre sous-dossier
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Goodside photos lisibles') then
    create policy "Goodside photos lisibles" on storage.objects
      for select using (bucket_id = 'listing-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Goodside ajout photos') then
    create policy "Goodside ajout photos" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Goodside suppression photos') then
    create policy "Goodside suppression photos" on storage.objects
      for delete to authenticated
      using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- 6. Activer une option payante (I-angat ou Tampok).
-- Appelée plus tard par la confirmation de paiement (PayMongo / Xendit),
-- ou par toi dans le SQL Editor après un paiement GCash reçu directement :
--   select public.apply_boost(42, 'bump');      -- remonte l'annonce 42
--   select public.apply_boost(42, 'feature');   -- annonce 42 en vedette 7 jours
create or replace function public.apply_boost(listing_id bigint, kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Autorisé : un admin connecté, le serveur (service_role), ou toi dans le SQL Editor (aucune requête du site)
  if not (public.is_admin()
          or coalesce(auth.role(), '') = 'service_role'
          or nullif(current_setting('request.jwt.claims', true), '') is null) then
    raise exception 'Not allowed';
  end if;
  perform set_config('goodside.moderating', 'on', true);
  if kind = 'bump' then
    update public.listings set bumped_at = now() where id = apply_boost.listing_id and status = 'active';
  elsif kind = 'feature' then
    update public.listings
       set featured_until = greatest(coalesce(featured_until, now()), now()) + interval '7 days',
           bumped_at = now()
     where id = apply_boost.listing_id and status = 'active';
  else
    raise exception 'Unknown kind %', kind;
  end if;
  perform set_config('goodside.moderating', 'off', true);
end $$;

-- 7. Pour devenir admin (modération), après ta première connexion sur le site :
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'TON-EMAIL');

-- 8. Connexion par téléphone : envoi du code SMS par Semaphore (Philippines).
-- Branché dans Supabase : Authentication > Auth Hooks > Send SMS hook > Postgres > public.send_sms_semaphore.
-- La clé API Semaphore est dans Vault sous le nom 'semaphore_api_key' (jamais dans ce fichier).
create extension if not exists pg_net with schema extensions;

create or replace function public.send_sms_semaphore(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone text := regexp_replace(coalesce(event->'user'->>'phone', ''), '[^0-9]', '', 'g');
  otp text := event->'sms'->>'otp';
  api_key text;
begin
  -- Only Supabase Auth may send codes (blocks calls from the public API, which would cost SMS credits)
  if session_user <> 'supabase_auth_admin' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Not allowed'));
  end if;
  -- Philippine mobile numbers only (639XXXXXXXXX): no costly messages to other countries
  if phone !~ '^639[0-9]{9}$' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Philippine mobile numbers only'));
  end if;
  if otp is null or otp !~ '^[0-9]{4,10}$' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Missing code'));
  end if;
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'semaphore_api_key' limit 1;
  if api_key is null or api_key = '' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 500, 'message', 'SMS service not configured'));
  end if;
  -- OTP route of Semaphore: {otp} is replaced by our own code passed in "code"
  perform net.http_post(
    url := 'https://api.semaphore.co/api/v4/otp',
    body := jsonb_build_object(
      'apikey', api_key,
      'number', phone,
      'message', 'Good Side code: {otp}. Huwag itong ibigay kahit kanino.',
      'code', otp
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return '{}'::jsonb;
end;
$$;

grant execute on function public.send_sms_semaphore(jsonb) to supabase_auth_admin;
