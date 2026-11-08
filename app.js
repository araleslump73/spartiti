/* Spartiti: Google Drive per un tablet vecchio (Firefox 68, Android 4.4).
   Niente framework, niente build. Sintassi limitata a ciò che Firefox 68 supporta
   (niente ?. e ??; Blob.arrayBuffer non esiste: si usa new Response(blob)). */
"use strict";

var CFG = window.SPARTITI_CONFIG || {};
var SCOPE = "https://www.googleapis.com/auth/drive";
var API = "https://www.googleapis.com/drive/v3/files";
var UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
var FOLDER = "application/vnd.google-apps.folder";
var DOC = "application/vnd.google-apps.document";
var SHORTCUT = "application/vnd.google-apps.shortcut";
var GAPPS = "application/vnd.google-apps.";
var FIELDS = "id,name,mimeType,parents,modifiedTime,size,shortcutDetails(targetId,targetMimeType)";
var MAX_FILE = 80 * 1024 * 1024;          // file più grandi non vengono scaricati offline
var REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");

function $(s) { return document.querySelector(s); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
var LS = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};

// ------------------------------------------------------------------ errori
function AppError(msg, kind) { this.message = msg; this.kind = kind; }
AppError.prototype = Object.create(Error.prototype);
function isNetErr(e) { return e instanceof TypeError || (e && e.kind === "offline"); }

// ------------------------------------------------------------------ login Google (OAuth implicito, redirect)
var token = LS.get("tok", ""), tokenExp = +LS.get("tokExp", "0");
function haveToken() { return !!token && Date.now() < tokenExp - 60000; }

function login(silent) {
  var state = Math.random().toString(36).slice(2) + Date.now();
  sessionStorage.setItem("oauthState", state);
  sessionStorage.setItem("ret", location.hash || "#/");
  if (silent) sessionStorage.setItem("silentAt", String(Date.now()));
  var p = new URLSearchParams({
    client_id: CFG.clientId, redirect_uri: REDIRECT, response_type: "token",
    scope: SCOPE, include_granted_scopes: "true", state: state
  });
  if (silent) p.set("prompt", "none");
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

var authError = "";
function handleOAuthReturn() {
  var h = location.hash;
  if (!/(^#|&)(access_token|error)=/.test(h)) return;
  var p = new URLSearchParams(h.slice(1));
  var ret = sessionStorage.getItem("ret") || "#/";
  if (p.get("state") && p.get("state") === sessionStorage.getItem("oauthState")) {
    if (p.get("access_token")) {
      token = p.get("access_token");
      tokenExp = Date.now() + (parseInt(p.get("expires_in"), 10) || 3600) * 1000;
      LS.set("tok", token); LS.set("tokExp", String(tokenExp));
    } else {
      authError = p.get("error") || "errore";
    }
  }
  sessionStorage.removeItem("oauthState");
  history.replaceState(null, "", REDIRECT + ret);
}

function logout() { token = ""; tokenExp = 0; LS.del("tok"); LS.del("tokExp"); }

// Serve un token: se possibile rinnovo silenzioso (la pagina viene ricaricata).
function clientOk() { return !!CFG.clientId && !/INCOLLA/.test(CFG.clientId); }
function needToken() {
  if (navigator.onLine === false) return Promise.reject(new AppError("Sei offline", "offline"));
  if (!clientOk()) return Promise.reject(new AppError("Client ID mancante", "login"));
  var last = +(sessionStorage.getItem("silentAt") || 0);
  if (!authError && Date.now() - last > 60000) { login(true); return new Promise(function () {}); }
  return Promise.reject(new AppError("Serve l'accesso a Google", "login"));
}

// ------------------------------------------------------------------ Drive API
async function api(url, opts) {
  opts = opts || {};
  if (!haveToken()) await needToken();
  var headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + token });
  var r = await fetch(url, Object.assign({}, opts, { headers: headers }));
  if (r.status === 401) { logout(); await needToken(); }
  if (!r.ok) {
    var t = ""; try { t = await r.text(); } catch (e) {}
    var msg = "Drive " + r.status;
    try { msg += ": " + JSON.parse(t).error.message; } catch (e) { msg += " " + t.slice(0, 150); }
    throw new AppError(msg, "http" + r.status);
  }
  return r;
}
async function dMeta(id) {
  var r = await api(API + "/" + encodeURIComponent(id) + "?supportsAllDrives=true&fields=" + encodeURIComponent(FIELDS));
  var m = await r.json();
  if (id === "root" || (!m.parents && m.mimeType === FOLDER && m.name === "My Drive")) m.name = "Il mio Drive";
  return m;
}
async function dChildren(id) {
  var out = [], pageToken = "";
  do {
    var p = new URLSearchParams({
      pageSize: "300", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      orderBy: "folder,name_natural", q: "'" + id + "' in parents and trashed=false",
      fields: "nextPageToken,files(" + FIELDS + ")"
    });
    if (pageToken) p.set("pageToken", pageToken);
    var j = await (await api(API + "?" + p.toString())).json();
    out = out.concat(j.files || []);
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}
async function dSearch(q) {
  var p = new URLSearchParams({
    pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true", orderBy: "folder,name_natural",
    q: "name contains '" + q.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "' and trashed=false",
    fields: "files(" + FIELDS + ")"
  });
  return (await (await api(API + "?" + p.toString())).json()).files || [];
}
async function dExportHtml(id) {
  return (await api(API + "/" + encodeURIComponent(id) + "/export?mimeType=text%2Fhtml")).text();
}
async function dBlob(m) {
  if (m.mimeType.indexOf(GAPPS) === 0)   // Fogli, Presentazioni...: come PDF
    return (await api(API + "/" + encodeURIComponent(m.id) + "/export?mimeType=application%2Fpdf")).blob();
  return (await api(API + "/" + encodeURIComponent(m.id) + "?alt=media&supportsAllDrives=true")).blob();
}
async function dUpdateHtml(id, html) {
  await api(UPLOAD + "/" + encodeURIComponent(id) + "?uploadType=media&supportsAllDrives=true",
    { method: "PATCH", headers: { "Content-Type": "text/html; charset=UTF-8" }, body: html });
}
function dUpload(folderId, file, onProgress) {
  return new Promise(function (resolve, reject) {
    var b = "spartiti" + Date.now();
    var meta = { name: file.name, parents: [folderId] };
    var body = new Blob(["--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + b + "\r\nContent-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n", file, "\r\n--" + b + "--"]);
    var x = new XMLHttpRequest();
    x.open("POST", UPLOAD + "?uploadType=multipart&supportsAllDrives=true&fields=id,name");
    x.setRequestHeader("Authorization", "Bearer " + token);
    x.setRequestHeader("Content-Type", "multipart/related; boundary=" + b);
    x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = function () { x.status < 300 ? resolve() : reject(new AppError("Upload fallito (" + x.status + ")")); };
    x.onerror = function () { reject(new AppError("Errore di rete durante l'upload", "offline")); };
    x.send(body);
  });
}
function target(m) {   // segue le scorciatoie di Drive
  if (m.mimeType === SHORTCUT && m.shortcutDetails)
    return { id: m.shortcutDetails.targetId, mimeType: m.shortcutDetails.targetMimeType };
  return { id: m.id, mimeType: m.mimeType };
}

// ------------------------------------------------------------------ archivio offline (IndexedDB)
var DB = {
  db: null,
  open: function () {
    if (DB.db) return Promise.resolve(DB.db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open("spartiti", 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        d.createObjectStore("files", { keyPath: "id" });     // {id, meta, html|blob, pins[], savedAt}
        d.createObjectStore("folders", { keyPath: "id" });   // {id, meta, children[], pins[], savedAt}
        d.createObjectStore("pins", { keyPath: "id" });      // {id, name, mimeType, savedAt, count}
      };
      r.onsuccess = function () { DB.db = r.result; res(DB.db); };
      r.onerror = function () { rej(r.error); };
    });
  },
  req: function (store, mode, fn) {
    return DB.open().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, mode), out;
        var q = fn(tx.objectStore(store));
        if (q) q.onsuccess = function () { out = q.result; };
        tx.oncomplete = function () { res(out); };
        tx.onerror = function () { rej(tx.error); };
        tx.onabort = function () { rej(tx.error || new AppError("Spazio esaurito?")); };
      });
    });
  },
  get: function (s, k) { return DB.req(s, "readonly", function (o) { return o.get(k); }); },
  put: function (s, v) { return DB.req(s, "readwrite", function (o) { return o.put(v); }); },
  del: function (s, k) { return DB.req(s, "readwrite", function (o) { return o.delete(k); }); },
  all: function (s) { return DB.req(s, "readonly", function (o) { return o.getAll(); }); },
  keys: function (s) { return DB.req(s, "readonly", function (o) { return o.getAllKeys(); }); }
};

// ------------------------------------------------------------------ link nei documenti
function mapLink(u) {
  var m = u.match(/^https?:\/\/(?:www\.)?google\.com\/url\?(?:[^#]*&)?q=([^&]+)/);
  if (m) { try { u = decodeURIComponent(m[1]); } catch (e) {} }
  m = u.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
  if (m) return { t: "d", id: m[1], url: u };
  m = u.match(/(?:drive|docs)\.google\.com\/(?:file|document|presentation|spreadsheets)\/(?:u\/\d+\/)?d\/([\w-]+)/) ||
      u.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
  if (m) return { t: "f", id: m[1], url: u };
  return { t: "x", url: u };
}
function parseDoc(html) {
  var d = new DOMParser().parseFromString(html, "text/html");
  Array.prototype.forEach.call(d.querySelectorAll("script"), function (s) { s.remove(); });
  var css = Array.prototype.map.call(d.querySelectorAll("style"), function (s) { return s.textContent; }).join("\n");
  return { d: d, css: css, cls: d.body.className, body: d.body };
}
function linkedIds(html) {
  var out = [];
  Array.prototype.forEach.call(parseDoc(html).body.querySelectorAll("a[href]"), function (a) {
    var l = mapLink(a.getAttribute("href"));
    if (l.t !== "x" && out.indexOf(l.id) < 0) out.push(l.id);
  });
  return out;
}
// CSS dei Doc: confinato dentro #doc, pt -> rem (così A-/A+ ingrandisce tutto)
function docCss(css) {
  css = css.replace(/@import[^;]*;/g, "")
           .replace(/font-size:\s*([\d.]+)pt/g, function (a, n) { return "font-size:" + (n / 11).toFixed(3) + "rem"; });
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, function (all, sel, body) {
    sel = sel.trim();
    if (!sel || sel.charAt(0) === "@") return "";
    return sel.split(",").map(function (s) {
      s = s.trim();
      return /^(html|body)\b/.test(s) ? s.replace(/^(html|body)/, "#doc") : "#doc " + s;
    }).join(",") + "{" + body + "}";
  });
}

// ------------------------------------------------------------------ preferenze: zoom, tema, schermo intero
var zoom = parseFloat(LS.get("zoom", "1.3")) || 1.3;
function applyZoom() { document.documentElement.style.fontSize = (16 * zoom) + "px"; }
function setZoom(d) {
  zoom = Math.max(0.6, Math.min(3.5, Math.round((zoom + d) * 10) / 10));
  LS.set("zoom", String(zoom)); applyZoom();
  if (cur.onZoom) cur.onZoom();
}
function toggleTheme() {
  var dark = document.documentElement.classList.toggle("dark");
  LS.set("theme", dark ? "dark" : "light");
}
// Schermo intero a 3 stati: 0 normale, 1 intero (barra dell'app visibile), 2 intero senza barra.
// Firefox permette il fullscreen solo dopo un tocco: se è l'impostazione salvata (predefinita: sì),
// parte automaticamente al primo tocco dopo l'apertura.
var fsMode = 0;
function fsEl() { return document.fullscreenElement || document.mozFullScreenElement; }
function enterFs() { var e = document.documentElement; (e.requestFullscreen || e.mozRequestFullScreen).call(e); }
function exitFs() { var d = document; if (fsEl()) (d.exitFullscreen || d.mozCancelFullScreen).call(d); }
function setBar() { document.body.classList.toggle("nobar", fsMode === 2); }
function toggleFs() {
  if (fsMode === 0) { fsMode = 1; enterFs(); }
  else if (fsMode === 1) { fsMode = 2; }
  else { fsMode = 0; exitFs(); }
  LS.set("fs", fsMode ? "1" : "0");
  setBar();
}
function onFsChange() {
  if (!fsEl() && fsMode) { fsMode = 0; setBar(); }   // uscito con il tasto indietro di Android
}
function armAutoFs() {
  if (LS.get("fs", "1") !== "1" || fsEl()) return;
  function go() {
    document.removeEventListener("click", go, true);
    document.removeEventListener("touchend", go, true);
    if (!fsEl() && LS.get("fs", "1") === "1") { fsMode = 1; try { enterFs(); } catch (e) { fsMode = 0; } setBar(); }
  }
  document.addEventListener("click", go, true);
  document.addEventListener("touchend", go, true);
}

// ------------------------------------------------------------------ interfaccia
var view = $("#view"), cur = {};
var BTN = ["bMinus", "bPlus", "bUpload", "bEdit", "bSave", "bOffline"];
function chrome(title, buttons) {
  $("#title").textContent = title || "Spartiti";
  document.title = title || "Spartiti";
  BTN.forEach(function (b) { $("#" + b).hidden = (buttons || []).indexOf(b) < 0; });
}
function info(html) { $("#info").innerHTML = html || ""; }
function crumbs(html) { $("#crumbs").innerHTML = html || ""; }
function msg(html, isErr) { view.innerHTML = '<div class="msg' + (isErr ? " err" : "") + '">' + html + "</div>"; }
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function icon(mt) {
  if (mt === FOLDER) return "📁";
  if (mt === DOC) return "📄";
  if (mt === "application/pdf") return "📕";
  if (/^image\//.test(mt)) return "🖼";
  if (/^audio\//.test(mt)) return "🎵";
  return "📃";
}
function fmtDate(t) { var d = new Date(t); return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5); }
// Indicatore online/offline nella barra (nessun banner: non occupa spazio)
function updateNet() {
  var off = navigator.onLine === false || !!cur.stale;
  var n = $("#net");
  n.textContent = off ? "offline" : "online";
  n.className = off ? "off" : "on";
}
// Se sei online ma senza accesso a Google, un banner discreto propone il login
function staleNote(savedAt) {
  cur.stale = true; updateNet();
  if (navigator.onLine === false) return "";
  return (!haveToken() ? "Non collegato a Google" : "Drive non raggiungibile") +
    ": copia del " + fmtDate(savedAt) + ' <button onclick="login(false)">Accedi</button>';
}

function showLogin(note) {
  chrome("Spartiti", []); crumbs("");
  var bad = !clientOk();
  msg((note ? "<p>" + esc(note) + "</p>" : "") +
    (bad ? '<p class="err">Manca il Client ID in config.js (vedi README).</p>'
         : '<p><button onclick="authError=\'\';login(false)">Accedi con Google</button></p>') +
    '<p><a href="#/off">Apri i file scaricati per l\'offline</a></p>');
}

function showError(e) {
  if (e && e.kind === "login") return showLogin(authError ? "Accesso non riuscito (" + authError + ")." : "");
  msg(esc(e && e.message || e) + '<p><a href="#/off">File scaricati per l\'offline</a></p>', true);
}

// ------------------------------------------------------------------ dati: rete con ripiego sulla copia offline
function canTryNet() { return navigator.onLine !== false; }

async function loadFolder(id) {
  var cached = await DB.get("folders", id);
  if (canTryNet() && (haveToken() || !cached)) {
    try {
      var r = await Promise.all([dMeta(id), dChildren(id)]);
      if (cached) { cached.meta = r[0]; cached.children = r[1]; cached.savedAt = Date.now(); DB.put("folders", cached); }
      return { meta: r[0], children: r[1], live: true };
    } catch (e) { if (!cached || !isNetErr(e)) throw e; }
  }
  if (cached) return { meta: cached.meta, children: cached.children, live: false, savedAt: cached.savedAt };
  throw new AppError("Questa cartella non è stata scaricata per l'offline.");
}

async function loadFile(id) {
  var cached = await DB.get("files", id);
  if (canTryNet() && (haveToken() || !cached)) {
    try {
      var m = await dMeta(id);
      var t = target(m);
      if (t.id !== m.id || t.mimeType === FOLDER) return { redirect: (t.mimeType === FOLDER ? "#/d/" : "#/f/") + t.id };
      var rec = { id: id, meta: m, savedAt: Date.now(), pins: cached ? cached.pins : [] };
      if (m.mimeType === DOC) rec.html = await dExportHtml(id);
      else if (cached && cached.blob && cached.meta.modifiedTime === m.modifiedTime) rec.blob = cached.blob;
      else rec.blob = await dBlob(m);
      if (cached) DB.put("files", rec);            // tiene aggiornata la copia offline
      rec.live = true;
      return rec;
    } catch (e) { if (!cached || !isNetErr(e)) throw e; }
  }
  if (cached) { cached.live = false; return cached; }
  throw new AppError("Questo file non è stato scaricato per l'offline.");
}

async function metaAny(id) {
  var c = await DB.get("folders", id) || await DB.get("files", id);
  if (c) return c.meta;
  if (canTryNet() && haveToken()) return dMeta(id);
  return null;
}
var crumbCache = {};
async function renderCrumbs(id, seq) {
  var chain = [], n = 0;
  while (id && n++ < 12) {
    var m = crumbCache[id] || await metaAny(id).catch(function () { return null; });
    if (!m) break;
    crumbCache[id] = m;
    chain.unshift(m);
    id = m.parents && m.parents[0];
  }
  if (seq !== navSeq) return;
  crumbs(chain.map(function (m) { return '<a href="#/d/' + m.id + '">' + esc(m.name) + "</a>"; }).join(" &#8250; "));
}

// ------------------------------------------------------------------ viste
var navSeq = 0;
async function route() {
  var seq = ++navSeq;
  if (cur.cleanup) cur.cleanup();
  cur = {}; info(""); crumbs(""); updateNet();
  var h = location.hash || "#/";
  var m = h.match(/^#\/(d|f|e|s|off)?\/?(.*)$/) || [];
  var kind = m[1], arg = decodeURIComponent(m[2] || "");
  try {
    if (!kind) {
      if (!canTryNet()) return go("#/off");
      if (!haveToken() && authError) return showLogin(authError === "interaction_required" || authError === "consent_required" ? "" : "Accesso non riuscito (" + authError + ").");
      return go("#/d/root");
    }
    if (kind === "off") return await showOffline(seq);
    if (kind === "d") return await showFolder(arg, seq);
    if (kind === "f") return await showFile(arg, seq);
    if (kind === "e") return await showEdit(arg, seq);
    if (kind === "s") return await showSearch(arg, seq);
  } catch (e) {
    if (seq === navSeq) showError(e);
  }
}

function rowsHtml(items, offKeys) {
  return items.map(function (f) {
    var t = target(f);
    var off = offKeys && offKeys.indexOf(t.id) >= 0 ? '<span class="off">&#9679; offline</span>' : "";
    return '<a class="row" href="#/' + (t.mimeType === FOLDER ? "d" : "f") + "/" + t.id + '"><span class="ic">' +
      icon(t.mimeType) + '</span><span class="nm">' + esc(f.name) + "</span>" + off + "</a>";
  }).join("");
}

async function showFolder(id, seq) {
  chrome("…", []); msg("Carico…");
  var r = await loadFolder(id);
  if (seq !== navSeq) return;
  cur = { kind: "folder", id: id, meta: r.meta };
  chrome(r.meta.name, r.live ? ["bUpload", "bOffline"] : []);
  if (!r.live) info(staleNote(r.savedAt));
  var keys = (await DB.keys("files")).concat(await DB.keys("folders"));
  var top = id === "root" || !(r.meta.parents) ?
    '<a class="row" href="#/off"><span class="ic">📥</span><span class="nm">Scaricati per l\'offline</span></a>' +
    '<form class="row" id="sf"><input id="q" type="search" placeholder="Cerca nel Drive…" style="flex:1;font-size:19px;padding:8px"> <button class="act">Cerca</button></form>' : "";
  view.innerHTML = top + (r.children.length ? rowsHtml(r.children, keys) : '<div class="msg">Cartella vuota.</div>');
  var sf = $("#sf");
  if (sf) sf.onsubmit = function (e) { e.preventDefault(); var q = $("#q").value.trim(); if (q) go("#/s/" + encodeURIComponent(q)); };
  renderCrumbs(id, seq);
}

async function showSearch(q, seq) {
  chrome("Ricerca: " + q, []); msg("Cerco…");
  if (!canTryNet()) throw new AppError("La ricerca funziona solo online.");
  var items = await dSearch(q);
  if (seq !== navSeq) return;
  view.innerHTML = items.length ? rowsHtml(items, await DB.keys("files")) : '<div class="msg">Nessun risultato.</div>';
}

async function showFile(id, seq) {
  chrome("…", []); msg("Apro…");
  var r = await loadFile(id);
  if (seq !== navSeq) return;
  if (r.redirect) return location.replace(r.redirect);
  var m = r.meta;
  cur = { kind: "file", id: id, meta: m };
  if (!r.live) info(staleNote(r.savedAt));
  var parent = m.parents && m.parents[0];
  if (parent) renderCrumbs(parent, seq);
  if (r.html !== undefined) {
    chrome(m.name, ["bMinus", "bPlus"].concat(r.live ? ["bEdit", "bOffline"] : []));
    return renderDoc(r.html);
  }
  chrome(m.name, ["bMinus", "bPlus"].concat(r.live ? ["bOffline"] : []));
  var type = r.blob.type || m.mimeType;
  if (type === "application/pdf" || m.mimeType.indexOf(GAPPS) === 0) return renderPdf(r.blob, seq);
  var url = URL.createObjectURL(r.blob);
  cur.cleanup = function () { URL.revokeObjectURL(url); };
  if (/^image\//.test(type)) view.innerHTML = '<div style="text-align:center"><img src="' + url + '" style="max-width:100%"></div>';
  else if (/^audio\//.test(type)) view.innerHTML = '<div class="msg"><audio controls src="' + url + '" style="width:100%"></audio></div>';
  else if (/^text\//.test(type)) view.innerHTML = '<pre class="msg" style="white-space:pre-wrap">' + esc(await new Response(r.blob).text()) + "</pre>";
  else msg('Formato non visualizzabile qui. <a class="act" href="' + url + '" download="' + esc(m.name) + '">Scarica</a>');
}

function renderDoc(html) {
  var p = parseDoc(html);
  Array.prototype.forEach.call(p.body.querySelectorAll("a[href]"), function (a) {
    var l = mapLink(a.getAttribute("href"));
    if (l.t === "x") { a.setAttribute("href", l.url); a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
    else a.setAttribute("href", "#/" + l.t + "/" + l.id);
  });
  view.innerHTML = "<style>" + docCss(p.css) + '</style><div id="doc"><div class="' + esc(p.cls) + '">' + p.body.innerHTML + "</div></div>";
}

// ---- PDF con pdf.js (caricato solo quando serve; resta in cache per l'offline)
var pdfjsReady = null;
function loadPdfjs() {
  if (!pdfjsReady) pdfjsReady = new Promise(function (res, rej) {
    var s = document.createElement("script");
    s.src = "pdfjs/pdf.min.js";
    s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror = function () { pdfjsReady = null; rej(new AppError("pdf.js non caricato")); };
    document.head.appendChild(s);
  });
  return pdfjsReady;
}
async function renderPdf(blob, seq) {
  var lib = await loadPdfjs();
  var data = new Uint8Array(await new Response(blob).arrayBuffer());
  // isEvalSupported:false chiude una vulnerabilità nota delle versioni vecchie di pdf.js
  var task = lib.getDocument({ data: data, isEvalSupported: false });
  var pdf = await task.promise;
  if (seq !== navSeq) { pdf.destroy(); return; }
  view.innerHTML = '<div id="pdf"></div>';
  var box = $("#pdf"), pages = [], obs;
  var first = await pdf.getPage(1), base = first.getViewport({ scale: 1 });
  function cssWidth() { return Math.round(view.clientWidth * zoom / 1.3); }
  for (var i = 1; i <= pdf.numPages; i++) {
    var c = document.createElement("canvas");
    c.className = "pg"; c.dataset.n = i;
    box.appendChild(c);
    pages.push({ n: i, c: c, done: 0 });
  }
  function size() {
    var w = cssWidth();
    pages.forEach(function (p) { p.c.style.width = w + "px"; if (!p.done) p.c.style.height = Math.round(w * base.height / base.width) + "px"; });
  }
  async function draw(p) {
    var w = cssWidth();
    if (p.done === w || p.busy) return;
    p.busy = true;
    try {
      var pg = await pdf.getPage(p.n), vp1 = pg.getViewport({ scale: 1 });
      var scale = w / vp1.width * Math.min(window.devicePixelRatio || 1, 2);
      var vp = pg.getViewport({ scale: scale });
      var c = p.c; c.width = vp.width; c.height = vp.height;
      c.style.height = Math.round(w * vp1.height / vp1.width) + "px";
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      p.done = w;
    } catch (e) { /* pagina saltata */ }
    p.busy = false;
  }
  size();
  obs = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) draw(pages[e.target.dataset.n - 1]); });
  }, { rootMargin: "1200px 0px" });
  pages.forEach(function (p) { obs.observe(p.c); });
  cur.onZoom = function () { size(); pages.forEach(function (p) { p.done = 0; obs.unobserve(p.c); obs.observe(p.c); }); };
  cur.cleanup = function () { obs.disconnect(); pdf.destroy(); };
}

// ---- modifica di un Google Doc (solo online)
async function showEdit(id, seq) {
  chrome("…", []); msg("Apro per la modifica…");
  if (!canTryNet()) throw new AppError("La modifica richiede la connessione.");
  var m = await dMeta(id);
  if (m.mimeType !== DOC) throw new AppError("Si possono modificare solo i Google Docs.");
  var html = await dExportHtml(id);
  if (seq !== navSeq) return;
  var p = parseDoc(html);
  chrome("Modifica: " + m.name, ["bMinus", "bPlus", "bSave"]);
  info("Modifica il testo e poi tocca <b>Salva</b>. Drive conserva la cronologia delle versioni.");
  view.innerHTML = "<style>" + docCss(p.css) + '</style><div id="doc"><div class="' + esc(p.cls) + '" contenteditable="true">' + p.body.innerHTML + "</div></div>";
  var ed = view.querySelector("[contenteditable]");
  var dirty = false;
  ed.addEventListener("input", function () { dirty = true; });
  ed.addEventListener("click", function (e) { if (e.target.closest("a")) e.preventDefault(); });
  window.onbeforeunload = function () { return dirty ? "Modifiche non salvate" : undefined; };
  cur = { kind: "edit", id: id, meta: m,
    cleanup: function () { window.onbeforeunload = null; },
    save: async function () {
      info("Salvo…");
      var fresh = parseDoc(await dExportHtml(id));          // parte da un export fresco: stili e intestazione intatti
      fresh.body.innerHTML = ed.innerHTML;
      var out = "<!DOCTYPE html>" + fresh.d.documentElement.outerHTML;
      await dUpdateHtml(id, out);
      dirty = false;
      var c = await DB.get("files", id);
      if (c) { c.html = await dExportHtml(id); c.savedAt = Date.now(); await DB.put("files", c); }
      info("Salvato ✔ <a href=\"#/f/" + id + "\">Torna al documento</a>");
    } };
}

// ---- upload nella cartella corrente
function startUpload() { $("#file").value = ""; $("#file").click(); }
$("#file").onchange = async function () {
  var files = Array.prototype.slice.call(this.files);
  if (!files.length || cur.kind !== "folder") return;
  var folder = cur.id;
  try {
    if (!haveToken()) await needToken();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      progress("Carico " + (i + 1) + "/" + files.length + ": " + f.name);
      await dUpload(folder, f, function (x) { progress("Carico " + (i + 1) + "/" + files.length + ": " + f.name + " " + Math.round(x * 100) + "%"); });
    }
    progress(""); route();
  } catch (e) { progress(""); showError(e); }
};

// ------------------------------------------------------------------ download per l'offline
var stopReq = false;
function progress(t) { $("#prog").style.display = t ? "block" : "none"; $("#progTxt").textContent = t; }
$("#progStop").onclick = function () { stopReq = true; };

function addPin(rec, pin) { rec.pins = rec.pins || []; if (rec.pins.indexOf(pin) < 0) rec.pins.push(pin); return rec; }

async function cacheImages(html) {
  var c;
  try { c = await caches.open("spartiti-img"); } catch (e) { return; }   // Cache API: solo su HTTPS
  var imgs = parseDoc(html).body.querySelectorAll("img[src^='http']");
  for (var i = 0; i < imgs.length; i++) {
    var src = imgs[i].getAttribute("src");
    try { if (!(await c.match(src))) await c.put(src, await fetch(src, { mode: "no-cors" })); } catch (e) {}
  }
}

async function makeOffline(rootId) {
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
  stopReq = false;
  var seen = {}, n = 0, skipped = [];
  var pin = rootId;
  function tick(name) { if (stopReq) throw new AppError("Download interrotto"); progress("Scarico (" + (++n) + "): " + name); }

  async function saveFile(m, linkDepth) {
    if (seen[m.id]) return; seen[m.id] = 1;
    tick(m.name);
    var old = await DB.get("files", m.id);
    var rec = addPin(old || { id: m.id }, pin);
    rec.meta = m; rec.savedAt = Date.now();
    if (m.mimeType === DOC) {
      rec.html = await dExportHtml(m.id);
      await DB.put("files", rec);
      await cacheImages(rec.html);
      if (linkDepth < 3) {
        var ids = linkedIds(rec.html);
        for (var i = 0; i < ids.length; i++) {
          if (seen[ids[i]]) continue;
          var lm;
          try { lm = await dMeta(ids[i]); } catch (e) { if (isNetErr(e)) throw e; skipped.push(ids[i]); continue; }
          var t = target(lm);
          if (t.id !== lm.id) { try { lm = await dMeta(t.id); } catch (e) { skipped.push(t.id); continue; } }
          if (lm.mimeType === FOLDER) await saveFolder(lm, 0);   // cartella linkata: solo il primo livello
          else await saveFile(lm, linkDepth + 1);
        }
      }
    } else {
      if (m.size && +m.size > MAX_FILE) { skipped.push(m.name + " (troppo grande)"); return; }
      if (!(old && old.blob && old.meta && old.meta.modifiedTime === m.modifiedTime)) rec.blob = await dBlob(m);
      await DB.put("files", rec);
    }
  }
  async function saveFolder(m, depthLeft) {
    if (seen["d:" + m.id]) return; seen["d:" + m.id] = 1;
    tick(m.name);
    var kids = await dChildren(m.id);
    var old = await DB.get("folders", m.id);
    var rec = addPin(old || { id: m.id }, pin);
    rec.meta = m; rec.children = kids; rec.savedAt = Date.now();
    await DB.put("folders", rec);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i], t = target(k);
      var km = t.id === k.id ? k : await dMeta(t.id).catch(function () { return null; });
      if (!km) continue;
      if (km.mimeType === FOLDER) { if (depthLeft > 0) await saveFolder(km, depthLeft - 1); }
      else await saveFile(km, 0);
    }
  }

  var root = await dMeta(rootId);
  // il "segnaposto" viene registrato subito: se il download si interrompe resta eliminabile
  var old = await DB.get("pins", rootId);
  if (!old) await DB.put("pins", { id: rootId, name: root.name + " (incompleto)", mimeType: root.mimeType, savedAt: Date.now(), count: 0 });
  if (root.mimeType === FOLDER) await saveFolder(root, 8); else await saveFile(root, 0);
  await DB.put("pins", { id: rootId, name: root.name, mimeType: root.mimeType, savedAt: Date.now(), count: n });
  progress("");
  return { n: n, skipped: skipped };
}

async function removePin(pin) {
  for (var s of ["files", "folders"]) {
    var all = await DB.all(s);
    for (var i = 0; i < all.length; i++) {
      var r = all[i], k = (r.pins || []).indexOf(pin);
      if (k < 0) continue;
      r.pins.splice(k, 1);
      if (r.pins.length) await DB.put(s, r); else await DB.del(s, r.id);
    }
  }
  await DB.del("pins", pin);
}

async function doOffline(id) {
  try {
    var r = await makeOffline(id);
    info("Disponibile offline ✔ (" + r.n + " elementi)" + (r.skipped.length ? " — saltati: " + esc(r.skipped.join(", ")) : ""));
  } catch (e) { progress(""); info('<span class="err">' + esc(e.message || e) + "</span>"); }
}

async function showOffline(seq) {
  chrome("Scaricati per l'offline", []);
  var pins = await DB.all("pins");
  if (seq !== navSeq) return;
  var est = "";
  if (navigator.storage && navigator.storage.estimate) {
    try { var q = await navigator.storage.estimate(); est = "Spazio usato: " + Math.round(q.usage / 1048576) + " MB"; } catch (e) {}
  }
  pins.sort(function (a, b) { return a.name.localeCompare(b.name); });
  view.innerHTML = (pins.length ? pins.map(function (p) {
    return '<div class="row"><a class="nm" style="color:inherit;text-decoration:none" href="#/' + (p.mimeType === FOLDER ? "d" : "f") + "/" + p.id + '"><span class="ic">' +
      icon(p.mimeType) + "</span> " + esc(p.name) + '<br><small style="opacity:.6">' + fmtDate(p.savedAt) + "</small></a>" +
      '<button class="act x" data-up="' + p.id + '">Aggiorna</button><button class="act x" data-rm="' + p.id + '">Elimina</button></div>';
  }).join("") : '<div class="msg">Niente ancora. Apri una cartella o un documento online e tocca &#11015;.</div>') +
    '<div class="msg"><small>' + est + "</small></div>";
  view.onclick = async function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.up) { if (!canTryNet()) return info("Serve la connessione per aggiornare."); await doOffline(b.dataset.up); route(); }
    if (b.dataset.rm && confirm("Eliminare la copia offline?")) { await removePin(b.dataset.rm); route(); }
  };
  cur.cleanup = function () { view.onclick = null; };
}

// ------------------------------------------------------------------ pulsanti ed eventi
$("#bBack").onclick = function () { history.length > 1 ? history.back() : go("#/"); };
$("#bHome").onclick = function () { go("#/"); };
$("#bMinus").onclick = function () { setZoom(-0.1); };
$("#bPlus").onclick = function () { setZoom(0.1); };
$("#bTheme").onclick = toggleTheme;
$("#bFs").onclick = toggleFs;
$("#fab").onclick = function () { fsMode = 1; setBar(); };
$("#bUpload").onclick = startUpload;
$("#bEdit").onclick = function () { go("#/e/" + cur.id); };
$("#bSave").onclick = function () { if (cur.save) cur.save().catch(function (e) { info('<span class="err">Non salvato: ' + esc(e.message || e) + "</span>"); }); };
$("#bOffline").onclick = function () { if (cur.id) doOffline(cur.id); };
document.addEventListener("fullscreenchange", onFsChange);
document.addEventListener("mozfullscreenchange", onFsChange);
window.addEventListener("hashchange", route);
window.addEventListener("online", function () { updateNet(); if (/^#\/(off)?$/.test(location.hash)) route(); });
window.addEventListener("offline", updateNet);

if (window.SPARTITI_MOCK) window.SPARTITI_MOCK();   // solo per i test locali (mock.js non viene pubblicato)
applyZoom();
armAutoFs();
handleOAuthReturn();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
route();
