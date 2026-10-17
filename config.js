// Good Side: connection to Supabase (project "Goodside Projet", Singapore server).
// The anon key is the public key meant for websites. Never put the service_role key here.
// Empty both values to run the site in demo mode with the sample listings.
window.GOODSIDE_CONFIG = {
  supabaseUrl: "https://jikcakhqificxsrtmgjk.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppa2Nha2hxaWZpY3hzcnRtZ2prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDE2NTUsImV4cCI6MjEwNzU3NzY1NX0.zuJ7_QZGMmDP0Y0VBABoRAgHnKfaoWE8gjRr_wB_d3Q",
  // Lien de la Page Facebook Good Side (ex. "https://www.facebook.com/goodsideph"). Vide = pas de lien en bas de page.
  facebookPage: "https://www.facebook.com/share/19mtFn7upC/",
  // Moyens de connexion affichés. phone : code par SMS (Semaphore), caché tant que Semaphore n'a pas validé
  // le nom d'expéditeur GoodSide (sans lui aucun SMS ne part ; remettre true à la validation).
  // google : bouton Google (client « Good Side site » du projet Google Cloud good-side, branché dans Supabase le 17/10/2026).
  // Il est caché dans le navigateur interne de Facebook / Messenger, où Google refuse la connexion.
  // facebook : bouton Facebook, caché tant que l'app Meta n'est pas branchée dans Supabase (remettre true à ce moment-là).
  // email : lien par email, en secours (seul moyen affiché tant que les autres sont cachés).
  login: { phone: false, google: true, facebook: false, email: true },
  // Options payantes, prix en pesos. bump = I-angat (remonte l'annonce), feature = Tampok (en vedette 7 jours).
  prices: { bump: 49, feature: 149 },
  // Compte GCash qui reçoit les paiements des options. number vide = le bouton « Palakasin » n'apparaît pas.
  // name : le nom tel que GCash l'affiche à celui qui paie, pour qu'il vérifie qu'il envoie au bon compte.
  gcash: { number: "+33 6 75 40 02 67", name: "Aiman B." }
};
