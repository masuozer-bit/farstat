/* =====================================================================
   Studiumm – lädt editierbare Seiteninhalte aus Supabase (site_content)
   ---------------------------------------------------------------------
   Öffentliche Seiten binden config.js + content.js ein. Dieses Skript
   liest die Inhalte per REST mit dem anon-Key (die Tabelle ist öffentlich
   lesbar) und ersetzt Text/HTML aller Elemente mit
       data-cms="<key>"        → element.textContent
       data-cms-html="<key>"   → element.innerHTML (für Inhalte mit Markup)
   Ist nichts gespeichert, bleiben die im HTML hinterlegten Standardtexte
   erhalten. Fehler (offline, Tabelle fehlt) werden lautlos ignoriert.
   ===================================================================== */
(function () {
  'use strict';

  var nodes = document.querySelectorAll('[data-cms],[data-cms-html]');
  if (!nodes.length) return;

  var cfg = window.STUDIUMM_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf('YOUR-') === -1;
  if (!configured) return;

  var url = cfg.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/site_content?select=key,value';
  fetch(url, {
    headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY }
  })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var map = {};
      (rows || []).forEach(function (r) { map[r.key] = r.value; });
      nodes.forEach(function (el) {
        var htmlKey = el.getAttribute('data-cms-html');
        var key = htmlKey || el.getAttribute('data-cms');
        if (map[key] == null) return;
        if (htmlKey) el.innerHTML = map[key];
        else el.textContent = map[key];
        el.classList.remove('placeholder'); // Platzhalter-Optik entfernen, sobald echter Text da ist
      });
    })
    .catch(function () { /* Standardtexte bleiben */ });
})();
