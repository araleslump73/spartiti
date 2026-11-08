// Finto Google Drive per provare l'interfaccia senza account (solo test locale).
window.SPARTITI_CONFIG = { clientId: "mock" };
window.SPARTITI_MOCK = function () {
  var F = "application/vnd.google-apps.folder", D = "application/vnd.google-apps.document";
  var items = {
    root: { name: "Il mio Drive", mimeType: F },
    musica: { name: "musica", mimeType: F, parents: ["root"] },
    a9: { name: "a9", mimeType: F, parents: ["musica"] },
    scaletta: { name: "scaletta", mimeType: D, parents: ["a9"] },
    pdf1: { name: "LOSING-MY-RELIGION.pdf", mimeType: "application/pdf", parents: ["a9"] },
    pdf2: { name: "space oddity chords.pdf", mimeType: "application/pdf", parents: ["altrove"] }
  };
  var doc = '<html><head><style type="text/css">@import url(https://themes.googleusercontent.com/fonts/css?kit=x);' +
    '.c1{font-weight:700;font-size:20pt}.c3{font-size:11pt;color:#000000}.c5{background-color:#ffffff;max-width:468pt;padding:72pt 72pt 72pt 72pt}p{margin:0;color:#000000}</style></head>' +
    '<body class="c5 doc-content"><p class="c1"><span>INTRO</span></p><p><span class="c3">Losing my religion</span></p>' +
    '<p><span class="c3">Am Em Dm G</span></p><p><span class="c3"><a href="https://www.google.com/url?q=https://drive.google.com/file/d/pdf1/view?usp%3Ddrive_link&amp;sa=D">LOSING-MY-RELIGION.pdf</a></span></p>' +
    '<p><span class="c3">Space oddity </span><span class="c3"><a href="https://drive.google.com/file/d/pdf2/view?usp=drive_link">space oddity chords.pdf</a></span></p>' +
    '<p><span class="c3">Sito esterno: <a href="https://example.com">example.com</a></span></p></body></html>';
  function meta(id) {
    if (!items[id]) return Promise.reject(new AppError("Drive 404", "http404"));
    var m = Object.assign({ id: id, modifiedTime: "2026-01-01T00:00:00Z" }, items[id]);
    return Promise.resolve(m);
  }
  window.haveToken = function () { return true; };
  window.dMeta = meta;
  window.dChildren = function (id) {
    if (window.MOCK_OFFLINE) return Promise.reject(new TypeError("NetworkError"));
    return Promise.resolve(Object.keys(items).filter(function (k) { return (items[k].parents || [])[0] === id; })
      .map(function (k) { return Object.assign({ id: k }, items[k]); }));
  };
  window.dSearch = function (q) { return window.dChildren("a9"); };
  window.dExportHtml = function () { return Promise.resolve(doc); };
  window.dBlob = function (m) { return fetch(m.id + ".pdf").then(function (r) { return r.blob(); }); };
  window.dUpdateHtml = function (id, h) { doc = h; return Promise.resolve(); };
  window.dUpload = function (folder, file, p) { items["up" + Date.now()] = { name: file.name, mimeType: file.type || "application/octet-stream", parents: [folder] }; p(1); return Promise.resolve(); };
  // simulazione offline: ?off nell'URL
  if (/[?&]off/.test(location.search)) {
    window.MOCK_OFFLINE = true;
    ["dMeta", "dExportHtml", "dBlob"].forEach(function (f) { window[f] = function () { return Promise.reject(new TypeError("NetworkError")); }; });
  }
};
