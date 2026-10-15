# Good Side : mise en ligne avec Supabase

Ce dossier est le vrai site. Sans configuration, il tourne en mode démo avec les annonces d'exemple. Dès que `config.js` contient les clés Supabase, il passe en mode réel : comptes, annonces enregistrées, photos, contact vendeur, signalements.

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page et sa logique |
| `i18n.js` | Tous les textes, tagalog et anglais |
| `api.js` | La connexion à Supabase (ou au mode démo) |
| `config.js` | Les 2 clés Supabase à remplir |
| `listings.js` | Les annonces d'exemple du mode démo |
| `supabase/schema.sql` | La base de données à créer une seule fois |

> **État au 15 octobre 2026** : les étapes 1 et 2 sont faites. La base est installée sur le projet Supabase « Goodside Projet » (serveur de Singapour, le plus proche des Philippines) et `config.js` est rempli. Il reste l'étape 3 (mise en ligne) et l'étape 4.

## Étape 1 : créer la base dans Supabase (5 minutes)

1. Sur supabase.com, ouvre ton compte et crée un projet « goodside ». Choisis la région **Southeast Asia (Singapore)**, la plus proche des Philippines. Note bien le mot de passe de la base.
2. Dans le projet, ouvre **SQL Editor**, puis **New query**.
3. Copie tout le contenu de `supabase/schema.sql`, colle-le, puis clique **Run**. Le message attendu est « Success. No rows returned ».

Le script crée les annonces, les comptes, les signalements (3 signalements masquent une annonce), une limite de 10 annonces par jour et par compte, et le dossier des photos. Il peut être relancé sans danger.

## Étape 2 : brancher le site

1. Dans Supabase, ouvre **Project Settings > API** (ou **Connect**).
2. Copie **Project URL** et la clé **anon public** dans `config.js` :

```js
window.GOODSIDE_CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

La clé « anon public » est faite pour être visible dans un site. Ne mets **jamais** la clé « service_role » dans `config.js`.

## Étape 3 : mettre le site en ligne

Le plus simple : mettre ce dossier dans un dépôt GitHub, puis sur vercel.com **Add New > Project > Import** ce dépôt, sans rien changer aux réglages. Vercel donne une adresse du type `goodside.vercel.app`, et on branchera goodside.ph plus tard.

## Étape 4 : réglages de connexion

1. Dans Supabase, **Authentication > URL Configuration** : mets l'adresse Vercel dans **Site URL** et ajoute-la dans **Redirect URLs**.
2. La connexion se fait par lien reçu par e-mail, sans mot de passe. L'envoi d'e-mails intégré à Supabase est très limité en nombre par heure : avant le lancement public, branche un service d'envoi (par exemple Resend) dans **Authentication > Emails > SMTP Settings**.

## Étape 5 : devenir modérateur

Connecte-toi une fois sur le site, puis lance dans le SQL Editor (avec ton e-mail) :

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'TON-EMAIL');
```

Tu peux alors voir les signalements dans **Table Editor > reports**, et remettre en ligne ou supprimer une annonce masquée dans **Table Editor > listings**.

## Vendre de la visibilité (I-angat et Tampok)

Tant que PayMongo ou Xendit n'est pas branché, tu peux déjà vendre ces options à la main : le vendeur te paie par GCash, puis tu lances dans le SQL Editor (avec le numéro de l'annonce) :

```sql
select public.apply_boost(42, 'bump');     -- I-angat : l'annonce 42 repasse en tête
select public.apply_boost(42, 'feature');  -- Tampok : badge et première place pendant 7 jours
```

Un vendeur ne peut pas s'offrir ces options lui-même : la base refuse. Plus tard, la confirmation de paiement de PayMongo appellera la même fonction automatiquement.

## Partage sur Facebook, Messenger et TikTok

- Chaque annonce a un bouton « I-share » et « I-share sa Facebook ». Le lien ouvre directement l'annonce (adresse se terminant par `#l-42`).
- `og-image.png` est l'image d'aperçu affichée quand on partage le site. Dans `index.html`, les balises `og:` utilisent `https://goodside.ph/` : remplace cette adresse si le domaine final est différent.

## Ce qui a été vérifié

- `schema.sql` exécuté deux fois sur PostgreSQL 16 avec des rôles qui imitent ceux de Supabase. 15 scénarios testés : un compte ne peut pas publier au nom d'un autre, ni se nommer admin, ni lire les numéros de téléphone directement, ni remettre en ligne une annonce masquée ; les photos ne s'écrivent que dans le dossier de leur propriétaire.
- Le site testé dans un navigateur, en mode démo et en mode réel avec un faux Supabase en mémoire (connexion, publication avec photo, contact, signalement, vendu, suppression).
- Pas encore testé contre un vrai projet Supabase : ce sera la première chose à faire après l'étape 2.
