// Reads the link token from the URL fragment (never sent to any server log), then loads data client-side.
(function(){
  var C = window.COSTDASH || {};
  function params(){ var h = location.hash.replace(/^#/, ""), o = {}; h.split("&").forEach(function(p){ var x = p.split("="); if (x[0]) o[decodeURIComponent(x[0])] = decodeURIComponent(x.slice(1).join("=")); }); return o; }
  var p = params(), token = p.t || "";
  try { if (token) sessionStorage.setItem("costdash_t", token); else token = sessionStorage.getItem("costdash_t") || ""; } catch (e) {}
  if (p.t) history.replaceState(null, "", location.href.split("#")[0] + (p.tab ? "#" + p.tab : "#ALL"));
  function stop(title, msg){ var f = function(){ document.body.innerHTML = '<div style="font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;color:#1d2433;background:#f5f6fa"><div style="max-width:420px;text-align:center"><h2>' + title + '</h2><p style="color:#6b7686">' + msg + '</p></div></div>'; }; if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", f); else f(); }
  var H = { apikey: C.anonKey, Authorization: "Bearer " + C.anonKey, "Content-Type": "application/json" };
  var base = String(C.supabaseUrl || "").replace(/\/$/, "") + "/rest/v1/";
  function rpc(fn, body){ return fetch(base + "rpc/" + fn, { method: "POST", headers: H, body: JSON.stringify(body || {}), cache: "no-store", referrerPolicy: "no-referrer" }).then(function(r){ if (!r.ok) throw new Error("db " + r.status); return r.json(); }); }
  function get(q){ return fetch(base + q, { headers: H, cache: "no-store", referrerPolicy: "no-referrer" }).then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; }); }
  var link = C.accessMode !== "public";
  if (link && !/^[A-Za-z0-9_-]{24,}$/.test(token)) { stop("Not found", ""); return; }
  var num = function(v){ return v === null || v === undefined ? null : Number(v); };
  var fix = function(r){ ["cost_inr","cost_usd","billed_inr","billed_usd","savings_estimate_inr","savings_estimate_usd","billed_under_review_inr","value"].forEach(function(k){ if (k in r) r[k] = num(r[k]); }); return r; };
  Promise.all([link ? rpc("get_dashboard_link", { p_token: token }) : rpc("get_dashboard_totals"), get("usage_monthly?select=*")]).then(function(res){
    var rows = res[0] || [];
    if (!rows.length) { try { sessionStorage.removeItem("costdash_t"); } catch (e) {} stop(link ? "Link not valid" : "Awaiting data", link ? "This link is wrong or has expired. Ask Vivek for the current link." : ""); return; }
    if (!link) rows = rows.filter(function(r){ return r.client_key === "ALL"; }).map(function(r){ delete r.display_name; return r; });
    var D = { source: "live database", draft: rows.some(function(r){ return r.draft; }), rows: rows.map(fix), usage: (res[1] || []).map(fix),
      generated_at: rows.reduce(function(m, r){ return r.as_of > m ? r.as_of : m; }, ""), mode: link ? "link" : "public",
      clientsAllowed: link, showClientMargin: false, defaultPeriod: C.defaultPeriod || "2026-10" };
    var go = function(){ window.__boot(D); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  }).catch(function(){ stop("Could not load data", "Please try again in a minute."); });
})();
