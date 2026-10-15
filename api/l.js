// Share page for one listing: /l/123 (see vercel.json).
// Facebook and Messenger read these tags to show the listing's photo, price and title,
// then a visitor is sent on to the listing on the main page.
var SUPABASE_URL = "https://jikcakhqificxsrtmgjk.supabase.co";
// Public anon key, the same one as in config.js
var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppa2Nha2hxaWZpY3hzcnRtZ2prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDE2NTUsImV4cCI6MjEwNzU3NzY1NX0.zuJ7_QZGMmDP0Y0VBABoRAgHnKfaoWE8gjRr_wB_d3Q";
var SITE = "https://www.goodsideph.com";
var UNITS = { month: "/buwan", hour: "/oras" };

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function page(o) {
  return '<!doctype html><html lang="tl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + esc(o.title) + "</title>" +
    '<meta name="description" content="' + esc(o.desc) + '">' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:site_name" content="Good Side">' +
    '<meta property="og:locale" content="tl_PH">' +
    '<meta property="og:title" content="' + esc(o.title) + '">' +
    '<meta property="og:description" content="' + esc(o.desc) + '">' +
    '<meta property="og:url" content="' + esc(o.url) + '">' +
    '<meta property="og:image" content="' + esc(o.image) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta http-equiv="refresh" content="0;url=' + esc(o.target) + '">' +
    "</head><body>" +
    '<p><a href="' + esc(o.target) + '">' + esc(o.title) + "</a></p>" +
    "<script>location.replace(" + JSON.stringify(o.target).replace(/</g, "\\u003c") + ");</script>" +
    "</body></html>";
}

module.exports = async function (req, res) {
  var id = String((req.query && req.query.id) || "").replace(/\D/g, "").slice(0, 18);
  var o = {
    title: "Good Side · Bumili at magbenta sa Pilipinas",
    desc: "Libre ang pag-post. Direktang kausapin ang nagbebenta.",
    url: SITE + "/",
    image: SITE + "/og-image.png",
    target: "/"
  };
  if (id) {
    o.url = SITE + "/l/" + id;
    o.target = "/#l-" + id;
    try {
      var r = await fetch(SUPABASE_URL + "/rest/v1/listings?select=title,description,price,unit,location,photo_paths&status=eq.active&id=eq." + id, {
        headers: { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY }
      });
      var row = r.ok ? (await r.json())[0] : null;
      if (row) {
        var price = "₱" + Number(row.price).toLocaleString("en-US", { maximumFractionDigits: 2 }) + (UNITS[row.unit] || "");
        o.title = price + " · " + row.title;
        o.desc = row.location + " · " + (row.description ? row.description.slice(0, 150) : "Tingnan sa Good Side");
        if (row.photo_paths && row.photo_paths.length) {
          o.image = SUPABASE_URL + "/storage/v1/object/public/listing-photos/" + row.photo_paths[0].split("/").map(encodeURIComponent).join("/");
        }
      }
    } catch (e) { /* keep the general preview */ }
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.statusCode = 200;
  res.end(page(o));
};
