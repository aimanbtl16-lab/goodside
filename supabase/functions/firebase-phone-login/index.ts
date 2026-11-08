// Good Side: phone login with SMS codes sent by Google (Firebase).
// The site signs the person in with Firebase (Google texts and checks the 6-digit code), then sends
// Firebase's ID token here. We check that Google really signed it for our Firebase project and for a
// Philippine mobile number, then open a normal Supabase session for that number:
// same account as a Semaphore SMS login for the same number, phone marked as confirmed (Beripikado badge).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

// Firebase project id (public, it is also in the site's config.js). Can be overridden by a function secret.
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GOOGLE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);
const ORIGINS = new Set([
  "https://www.goodsideph.com",
  "https://goodsideph.com",
  "https://goodside-kappa.vercel.app",
]);
const MAX_AGE_SECONDS = 10 * 60; // the code must have been checked by Google in the last 10 minutes

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://www.goodsideph.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function randomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Letters, digits and symbols so any password rule set in Supabase is met. Never shown to anyone.
  return "Gs-" + btoa(String.fromCharCode(...bytes)).replace(/=+$/, "") + "-9a";
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get("origin") ?? ""), "Content-Type": "application/json" };
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!FIREBASE_PROJECT_ID || !SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return reply(503, { error: "not_configured" });
  }

  let idToken: unknown;
  try {
    ({ idToken } = await req.json());
  } catch {
    return reply(400, { error: "bad_request" });
  }
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 4096) {
    return reply(400, { error: "bad_request" });
  }

  // 1. Google really signed this token, for our Firebase project, recently, after an SMS code check.
  let phoneE164 = "";
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_KEYS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
      algorithms: ["RS256"],
    });
    const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
    const authTime = Number(payload.auth_time);
    if (provider !== "phone") return reply(403, { error: "not_phone" });
    if (!authTime || Date.now() / 1000 - authTime > MAX_AGE_SECONDS) return reply(401, { error: "too_old" });
    phoneE164 = String(payload.phone_number ?? "");
  } catch {
    return reply(401, { error: "invalid_token" });
  }
  if (!/^\+639\d{9}$/.test(phoneE164)) return reply(403, { error: "not_ph_mobile" });
  const phone = phoneE164.slice(1); // Supabase stores numbers without the "+": 639XXXXXXXXX

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Find or create the Good Side account for this number, give it a fresh random password,
  //    and sign in with it to get a normal session. Two tries in case two logins for the same
  //    number cross each other.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: userId, error: findError } = await admin.rpc("auth_user_id_by_phone", { p_phone: phone });
    if (findError) return reply(500, { error: "lookup_failed" });

    const password = randomPassword();
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(String(userId), { password, phone_confirm: true });
      if (error) return reply(500, { error: "update_failed" });
    } else {
      const { error } = await admin.auth.admin.createUser({ phone, password, phone_confirm: true });
      if (error) {
        if (attempt === 0) continue; // created at the same moment by another login: look it up again
        return reply(500, { error: "create_failed" });
      }
    }

    const { data, error } = await anon.auth.signInWithPassword({ phone, password });
    if (!error && data.session) {
      return reply(200, {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }
  }
  return reply(500, { error: "sign_in_failed" });
});
