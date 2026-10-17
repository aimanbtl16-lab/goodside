# Good Side : mise en ligne avec Supabase

Ce dossier est le vrai site. Sans configuration, il tourne en mode démo avec les annonces d'exemple. Dès que `config.js` contient les clés Supabase, il passe en mode réel : comptes, annonces enregistrées, photos, contact vendeur, signalements.

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page et sa logique |
| `i18n.js` | Tous les textes, tagalog et anglais |
| `api.js` | La connexion à Supabase (ou au mode démo) |
| `config.js` | Les clés Supabase, les moyens de connexion, les prix et ton numéro GCash |
| `presyo.html` | La page des prix |
| `robots.txt`, `sitemap.xml` | Pour Google : les pages à visiter. Ajouter ici toute nouvelle page publique |
| `listings.js` | Les annonces d'exemple du mode démo |
| `places.js` | La liste officielle des 1 634 villes et communes (PSGC), proposée quand on écrit le lieu d'une annonce |
| `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | L'application installable sur le téléphone |
| `supabase/schema.sql` | La base de données à créer une seule fois |

> **État au 15 octobre 2026** : le site est en ligne sur https://www.goodsideph.com (domaine acheté chez Gandi, aussi accessible sur https://goodside-kappa.vercel.app ; Vercel, mis à jour automatiquement à chaque envoi sur `main`), branché au projet Supabase « Goodside Projet » (serveur de Singapour, le plus proche des Philippines). Restent l'étape 4 (réglages de connexion) et l'étape 5.

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

Prix dans `config.js` (`prices`) : I-angat ₱49, Tampok ₱149 pour 7 jours. La page `presyo.html` les affiche.

Tant que PayMongo ou Xendit n'est pas branché, le paiement se fait à la main par GCash :

1. Mets ton numéro GCash et ton nom tel que GCash l'affiche dans `config.js` (`gcash`). Sans numéro, le bouton n'apparaît pas.
2. Sur sa propre annonce, le vendeur choisit I-angat ou Tampok et voit ton numéro, le montant et un code : `GS-42-A` (I-angat de l'annonce 42) ou `GS-42-T` (Tampok).
3. Il t'envoie l'argent par GCash avec ce code dans le message.
4. Connecté sur le site, tape le code dans la recherche : l'annonce s'ouvre avec un cadre « Admin » que toi seul vois. Appuie sur « Activer », puis confirme.

Tu peux aussi le faire dans le SQL Editor :

```sql
select public.apply_boost(42, 'bump');     -- I-angat : l'annonce 42 repasse en tête
select public.apply_boost(42, 'feature');  -- Tampok : badge et première place pendant 7 jours
```

Un vendeur ne peut pas s'offrir ces options lui-même : la base refuse. Plus tard, la confirmation de paiement de PayMongo appellera la même fonction automatiquement.

## Partage sur Facebook, Messenger et TikTok

- Chaque annonce a un bouton « I-share » et « I-share sa Facebook ». Le lien ouvre directement l'annonce (adresse se terminant par `#l-42`).
- `og-image.png` est l'image d'aperçu affichée quand on partage le site. Dans `index.html`, les balises `og:` utilisent `https://www.goodsideph.com/`, le domaine principal.

## Adapté aux Philippines

- **Catégories** : Sasakyan, Motorsiklo, Cellphone, Electronics, Ari-arian, Paupahan (location), Damit at ukay, Kasangkapan, Trabaho, Serbisyo. Pour en ajouter une : la liste `CAT_ORDER` et une icône dans `index.html`, le nom dans `i18n.js` (deux langues), deux couleurs `--c-…` dans chaque thème, et la liste `listings_cat_check` dans la base.
- **Badge « Beripikado »** : affiché quand le vendeur s'est connecté avec son numéro (code SMS). C'est la base qui le calcule (`phone_verified`), le vendeur ne peut pas le cocher lui-même.
- **Options d'annonce** : « Pwede tawad » (prix négociable), et comment l'acheteur récupère l'objet : meet-up, COD (paiement à la livraison), envoi par J&T, LBC ou Lalamove.
- **Lieu** : en tapant le lieu, le vendeur voit les villes et communes officielles (`places.js`, « Ville, Province »). « QC », « davao » ou « Tagaytay » sont remplacés par le nom officiel, pour que le filtre par lieu ne mélange pas « QC » et « Quezon City ».
- **Connexion Google** : presque tous les téléphones Android ont un compte Google. Le bouton apparaît quand `login.google` vaut `true` dans `config.js`, une fois le client Google branché dans Supabase (**Authentication > Sign In / Providers > Google**). Il est caché dans le navigateur interne de Facebook et Messenger, où Google refuse la connexion.
- **Application installable** : sur Android, un bouton « I-install ang app » apparaît en bas de page ; sur iPhone, Partager puis « Sur l'écran d'accueil ». L'icône est le drapeau Good Side.
- **Photos plus légères** : réduites à 1 280 px avant l'envoi, pour économiser les données mobiles.

## Ce qui a été vérifié

- `schema.sql` exécuté deux fois sur PostgreSQL 16 avec des rôles qui imitent ceux de Supabase. 15 scénarios testés : un compte ne peut pas publier au nom d'un autre, ni se nommer admin, ni lire les numéros de téléphone directement, ni remettre en ligne une annonce masquée ; les photos ne s'écrivent que dans le dossier de leur propriétaire.
- Le site testé dans un navigateur, en mode démo et en mode réel avec un faux Supabase en mémoire (connexion, publication avec photo, contact, signalement, vendu, suppression).
- Pas encore testé contre un vrai projet Supabase : ce sera la première chose à faire après l'étape 2.
