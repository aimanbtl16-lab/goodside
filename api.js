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

    // Phone login: Supabase texts a 6-digit code (Send SMS hook -> Semaphore), then the code is checked
    sendPhoneCode: function (phone) {
      if (!client) return Promise.resolve({ demo: true });
      return client.auth.signInWithOtp({ phone: phone }).then(function (res) {
        if (res.error) throw fail(res.error.status === 429 ? "rate" : "sms", res.error);
        return { ok: true };
      });
    },

    verifyPhoneCode: function (phone, code) {
      if (!client) return Promise.resolve({ demo: true });
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
