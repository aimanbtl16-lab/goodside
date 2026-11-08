// Good Side: data layer.
// "demo" mode uses the sample listings in listings.js (nothing is saved).
// "live" mode uses Supabase when config.js has a project URL and anon key.
(function () {
  var cfg = window.GOODSIDE_CONFIG || {};
  var BUCKET = "listing-photos";
  var COLS = "id,user_id,cat,title,description,price,unit,location,photo_paths,created_at,bumped_at,featured_until,negotiable,deals,phone_verified";
  var client = null;
  var user = null;
  var demoSeq = 1000;

  function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }

  function photoUrl(path) {
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function fromRow(r) {
    return {
      id: r.id,
      userId: r.user_id,
      cat: r.cat,
      price: Number(r.price),
      unit: r.unit || "",
      loc: r.location,
      date: isoDay(r.created_at),
      title: { tl: r.title, en: r.title },
      desc: r.description ? { tl: r.description, en: r.description } : null,
      photos: (r.photo_paths || []).map(photoUrl),
      featured: !!(r.featured_until && new Date(r.featured_until) > new Date()),
      featuredUntil: r.featured_until || null,
      negotiable: !!r.negotiable,
      deals: r.deals || [],
      verified: !!r.phone_verified,
      mine: !!(user && r.user_id === user.id)
    };
  }

  // Shrink phone photos before upload: max 1280 px, JPEG 0.78 (light on Philippine mobile data, still sharp on a phone).
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || !window.createImageBitmap) { resolve(file); return; }
      createImageBitmap(file).then(function (bmp) {
        var scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
        var c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        c.toBlob(function (blob) { resolve(blob || file); }, "image/jpeg", 0.78);
      }).catch(function () { resolve(file); });
    });
  }

  function fail(code, err) {
    var e = new Error(code); e.code = code; e.cause = err; return e;
  }

  // ---- SMS codes sent by Google (Firebase phone sign-in) ----
  // Google sends the SMS under its own approved sender names, so no Philippine sender name is needed.
  // The scripts load only when someone signs in by phone (light on mobile data).
  var FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
  var fbAuth = null, fbConfirm = null, fbVerifier = null;
  function viaFirebase() { return cfg.phoneVia === "firebase" && !!(cfg.firebase && cfg.firebase.apiKey); }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadFirebase() {
    if (!fbAuth) {
      fbAuth = loadScript(FIREBASE_SDK + "firebase-app-compat.js")
        .then(function () { return loadScript(FIREBASE_SDK + "firebase-auth-compat.js"); })
        .then(function () {
          var fb = window.firebase;
          var app = fb.apps.length ? fb.app() : fb.initializeApp(cfg.firebase);
          var auth = app.auth();
          auth.useDeviceLanguage();
          // Google only proves the number; the Good Side session lives in Supabase, so Google keeps nothing.
          return auth.setPersistence(fb.auth.Auth.Persistence.NONE).then(function () { return auth; });
        });
      fbAuth.catch(function () { fbAuth = null; });
    }
    return fbAuth;
  }
  function firebaseErr(err) {
    var c = (err && err.code) || "";
    if (c === "auth/too-many-requests" || c === "auth/quota-exceeded") return "rate";
    if (c === "auth/invalid-verification-code" || c === "auth/code-expired" || c === "auth/missing-verification-code") return "code";
    return "";
  }
  function firebaseSend(phone) {
    return loadFirebase().then(function (auth) {
      if (fbVerifier) { try { fbVerifier.clear(); } catch (e) { /* already gone */ } fbVerifier = null; }
      // A fresh spot for the invisible reCAPTCHA each time (a used one cannot be reused).
      var box = document.getElementById("recaptchaBox");
      if (!box) { box = document.createElement("div"); box.id = "recaptchaBox"; document.body.appendChild(box); }
      box.innerHTML = "";
      var spot = document.createElement("div");
      box.appendChild(spot);
      fbVerifier = new window.firebase.auth.RecaptchaVerifier(spot, { size: "invisible" }, auth.app);
      return auth.signInWithPhoneNumber(phone, fbVerifier);
    }).then(function (confirmation) {
      fbConfirm = confirmation;
      return { ok: true };
    }, function (err) {
      throw fail(firebaseErr(err) === "rate" ? "rate" : "sms", err);
    });
  }
  function firebaseVerify(code) {
    if (!fbConfirm) return Promise.reject(fail("code", new Error("no code sent yet")));
    return fbConfirm.confirm(code).then(function (cred) {
      return cred.user.getIdToken();
    }, function (err) {
      throw fail(firebaseErr(err) || "login", err);
    }).then(function (idToken) {
      return client.functions.invoke("firebase-phone-login", { body: { idToken: idToken } }).then(function (res) {
        var s = res.data;
        if (res.error || !s || !s.access_token || !s.refresh_token) throw fail("login", res.error || new Error("no session"));
        return client.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      });
    }).then(function (res) {
      if (res.error) throw fail("login", res.error);
      fbConfirm = null;
      loadFirebase().then(function (auth) { return auth.signOut(); }).catch(function () {});
      return { ok: true };
    });
  }

  var api = {
    mode: "demo",

    init: function () {
      if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient) {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        api.mode = "live";
        return client.auth.getSession().then(function (res) {
          user = res.data && res.data.session ? res.data.session.user : null;
          return user;
        });
      }
      return Promise.resolve(null);
    },

    onAuthChange: function (cb) {
      if (!client) return;
      client.auth.onAuthStateChange(function (_event, session) {
        user = session ? session.user : null;
        cb(user);
      });
    },

    user: function () { return user; },

    list: function () {
      if (!client) {
        return Promise.resolve((window.GOODSIDE_LISTINGS || []).map(function (it) {
          var copy = Object.assign({}, it); copy.sample = true; copy.photos = []; return copy;
        }));
      }
      return client.from("listings").select(COLS).eq("status", "active")
        .order("bumped_at", { ascending: false }).limit(300)
        .then(function (res) {
          if (res.error) throw fail("load", res.error);
          return res.data.map(fromRow);
        });
    },

    post: function (data, files) {
      if (!client) {
        var today = isoDay(Date.now());
        return Promise.resolve({
          id: "u" + (demoSeq++), cat: data.cat, price: data.price, unit: data.unit, loc: data.loc, date: today,
          title: { tl: data.title, en: data.title }, desc: data.desc ? { tl: data.desc, en: data.desc } : null,
          photos: (files || []).map(function (f) { return URL.createObjectURL(f); }), mine: true,
          negotiable: !!data.negotiable, deals: data.deals || [], verified: false
        });
      }
      if (!user) return Promise.reject(fail("auth"));
      var uploads = (files || []).slice(0, 6).map(function (file, i) {
        return shrink(file).then(function (blob) {
          var path = user.id + "/" + Date.now() + "-" + i + ".jpg";
          return client.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false })
            .then(function (res) { if (res.error) throw fail("upload", res.error); return path; });
        });
      });
      return Promise.all(uploads).then(function (paths) {
        return client.from("listings").insert({
          cat: data.cat, title: data.title, description: data.desc || null, price: data.price,
          unit: data.unit || "", location: data.loc, photo_paths: paths,
          negotiable: !!data.negotiable, deals: data.deals || []
        }).select(COLS).single();
      }).then(function (res) {
        if (res.error) throw fail(/Limit reached/.test(res.error.message || "") ? "limit" : "post", res.error);
        var row = res.data;
        if (!data.contact) return fromRow(row);
        // The seller's number lives in its own table; buyers only get it through get_contact()
        return client.from("listing_contacts").insert({ listing_id: row.id, contact: data.contact })
          .then(function () { return fromRow(row); });
      });
    },

    contact: function (id) {
      if (!client) return Promise.resolve({ demo: true });
      if (!user) return Promise.reject(fail("auth"));
      return client.rpc("get_contact", { listing_id: Number(id) }).then(function (res) {
        if (res.error) throw fail("contact", res.error);
        return { value: res.data };
      });
    },

    report: function (id) {
      if (!client) return Promise.resolve({ ok: true });
      if (!user) return Promise.reject(fail("auth"));
      return client.from("reports").insert({ listing_id: Number(id) }).then(function (res) {
        if (res.error && res.error.code === "23505") return { already: true };
        if (res.error) throw fail("report", res.error);
        return { ok: true };
      });
    },

    setStatus: function (id, status) {
      if (!client) return Promise.resolve({ ok: true });
      return client.from("listings").update({ status: status }).eq("id", Number(id)).then(function (res) {
        if (res.error) throw fail("update", res.error);
        return { ok: true };
      });
    },

    remove: function (id) {
      if (!client) return Promise.resolve({ ok: true });
      var paths = [];
      return client.from("listings").select("photo_paths").eq("id", Number(id)).maybeSingle().then(function (got) {
        paths = (got.data && got.data.photo_paths) || [];
        return client.from("listings").delete().eq("id", Number(id));
      }).then(function (res) {
        if (res.error) throw fail("delete", res.error);
        // Remove the listing's photos too; a failure here never blocks the delete
        if (!paths.length) return { ok: true };
        return client.storage.from(BUCKET).remove(paths).then(function () { return { ok: true }; }, function () { return { ok: true }; });
      });
    },

    // Admin only: is the signed-in account a moderator? (profiles.is_admin, never settable from the site)
    isAdmin: function () {
      if (!client || !user) return Promise.resolve(false);
      return client.rpc("is_admin").then(function (res) { return !res.error && res.data === true; });
    },

    // Admin only: turn on I-angat ("bump") or Tampok ("feature") after the GCash payment arrived.
    // The database refuses it for anyone who is not admin.
    applyBoost: function (id, kind) {
      if (!client) return Promise.resolve({ demo: true });
      return client.rpc("apply_boost", { listing_id: Number(id), kind: kind }).then(function (res) {
        if (res.error) throw fail("boost", res.error);
        return { ok: true };
      });
    },

    // Phone login: a 6-digit code by SMS, sent one of two ways (config.js phoneVia):
    // "firebase": Google Firebase sends and checks the code, then the Supabase function
    //   firebase-phone-login swaps Google's proof for a Good Side session (see firebaseSend/Verify below).
    // "semaphore": Supabase texts the code itself (Send SMS hook -> Semaphore) and checks it.
    // True when Google's anti-robot check (reCAPTCHA) may need room on screen while the code is sent.
    phoneUsesRecaptcha: function () { return !!(client && viaFirebase()); },

    // Starts loading Google's login scripts early, as soon as the login box opens.
    preparePhone: function () { if (client && viaFirebase()) loadFirebase().catch(function () {}); },

    sendPhoneCode: function (phone) {
      if (!client) return Promise.resolve({ demo: true });
      if (viaFirebase()) return firebaseSend(phone);
      return client.auth.signInWithOtp({ phone: phone }).then(function (res) {
        if (res.error) throw fail(res.error.status === 429 ? "rate" : "sms", res.error);
        return { ok: true };
      });
    },

    verifyPhoneCode: function (phone, code) {
      if (!client) return Promise.resolve({ demo: true });
      if (viaFirebase()) return firebaseVerify(code);
      return client.auth.verifyOtp({ phone: phone, token: code, type: "sms" }).then(function (res) {
        if (res.error) throw fail(res.error.status === 429 ? "rate" : "code", res.error);
        return { ok: true };
      });
    },

    signInFacebook: function () {
      if (!client) return Promise.resolve({ demo: true });
      return client.auth.signInWithOAuth({
        provider: "facebook",
        options: { redirectTo: location.origin + location.pathname }
      }).then(function (res) { if (res.error) throw fail("facebook", res.error); return { ok: true }; });
    },

    signInGoogle: function () {
      if (!client) return Promise.resolve({ demo: true });
      return client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + location.pathname }
      }).then(function (res) { if (res.error) throw fail("google", res.error); return { ok: true }; });
    },

    signIn: function (email) {
      if (!client) return Promise.resolve({ demo: true });
      return client.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: location.origin + location.pathname }
      }).then(function (res) { if (res.error) throw fail("login", res.error); return { ok: true }; });
    },

    signOut: function () {
      if (!client) return Promise.resolve();
      return client.auth.signOut();
    }
  };

  window.GoodSideApi = api;
})();
