/* =====================================================================
   Studiumm – Admin-Bereich
   Phase 1: Rolle + Schülerliste
   Phase 2: Schülerdaten einsehen (Termine, Lernplan, Dokumente, read-only)
   Nur für Konten mit profiles.is_admin = true.
   ===================================================================== */

(function () {
  'use strict';

  var cfg = window.STUDIUMM_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf('YOUR-') === -1;
  var sb = (window.supabase && configured)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  // ---------- Helfer ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function fmtSize(b) {
    b = b || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function extIco(name) { return ((name || '').split('.').pop() || '').toUpperCase().slice(0, 4) || '•'; }
  function fmtTermin(date, time, endTime) {
    var when = new Date(date + 'T00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
    if (!time) return when;
    return when + ' · ' + (endTime ? time + '–' + endTime : time);
  }
  function fmtDay(iso) {
    return iso ? new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  var adminShell = document.getElementById('adminShell');
  if (!adminShell) return;

  var students = [];
  var groups = [];
  var currentDocs = [];
  var currentPayments = [];
  var currentTermine = [];
  var currentStudentId = null;
  var myId = null;
  var chatChannel = null;
  var notifChannel = null;
  var notifs = [];
  var allTermine = [];
  var materials = [];
  var pickedMaterialFile = null;
  var MAX_MATERIAL = 25 * 1024 * 1024;
  var WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];
  var DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  var calRef = new Date();
  var calY = calRef.getFullYear(), calM = calRef.getMonth();

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function studentName(id) {
    var s = students.filter(function (p) { return p.id === id; })[0];
    return s ? (s.full_name || s.email || '—') : '—';
  }
  function fmtEUR(a) { return a == null ? '' : Number(a).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }

  // Termine einer Serie erzeugen: ab startStr, für `weeks` Wochen, je gewähltem
  // Wochentag (0=Mo … 6=So). Liefert sortierte 'YYYY-MM-DD'-Strings.
  function seriesDates(startStr, weeks, weekdaysSel) {
    var start = new Date(startStr + 'T00:00');
    var out = [];
    weekdaysSel.forEach(function (wd) {
      var first = new Date(start);
      while (((first.getDay() + 6) % 7) !== wd) first.setDate(first.getDate() + 1);
      for (var i = 0; i < weeks; i++) {
        var d = new Date(first); d.setDate(first.getDate() + i * 7);
        out.push(d);
      }
    });
    out.sort(function (a, b) { return a - b; });
    return out.map(function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); });
  }

  (async function init() {
    if (!sb) { window.location.href = 'anmelden.html'; return; }

    var sess = await sb.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.href = 'anmelden.html'; return; }
    myId = user.id;

    var me = await sb.from('profiles').select('full_name,is_admin').eq('id', user.id).single();
    if (me.error || !me.data || !me.data.is_admin) {
      alert('Dieser Bereich ist nur für Administratoren.');
      window.location.href = 'dashboard.html';
      return;
    }

    var firstName = ((me.data.full_name || user.email || '').split(' ')[0]) || 'Admin';
    setText('whoami', 'Admin · ' + firstName);
    setText('greeting', 'Hallo, ' + firstName + ' 👋');

    document.getElementById('logoutBtn').addEventListener('click', async function () {
      await sb.auth.signOut();
      window.location.href = 'index.html';
    });

    wirePanels();

    // Klick auf eine Schüler-Zeile -> Detailansicht
    document.getElementById('studentList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-student]');
      if (row) openStudent(row.dataset.student);
    });
    // Zurück-Button + Downloads + Termin-Aktionen in der Detailansicht
    document.getElementById('studentDetail').addEventListener('click', async function (e) {
      if (e.target.closest('#backBtn')) { backToList(); return; }

      var tact = e.target.closest('[data-tact]');
      if (tact) {
        var id = tact.dataset.tid;
        var act = tact.dataset.tact;
        if (act === 'remove') {
          if (!confirm('Diesen Termin endgültig aus der Datenbank löschen?')) return;
          var del = await sb.from('termine').delete().eq('id', id);
          if (del.error) { alert('Aktion fehlgeschlagen: ' + del.error.message); return; }
        } else if (act === 'cancelseries') {
          if (!confirm('Die ganze Serie (alle zukünftigen Termine) absagen?')) return;
          var rs = await sb.rpc('update_series', { p_series: tact.dataset.series, p_action: 'cancel', p_date: null });
          if (rs.error) { alert('Aktion fehlgeschlagen: ' + rs.error.message); return; }
        } else if (act === 'cancel') {
          var term = currentTermine.filter(function (t) { return t.id === id; })[0];
          if (term && term.series_id) {
            var rc = await sb.rpc('update_series', { p_series: term.series_id, p_action: 'cancel', p_date: term.date });
            if (rc.error) { alert('Aktion fehlgeschlagen: ' + rc.error.message); return; }
          } else {
            var can = await sb.from('termine').update({
              status: 'cancelled', cancelled_by: 'tutor', cancelled_at: new Date().toISOString()
            }).eq('id', id);
            if (can.error) { alert('Aktion fehlgeschlagen: ' + can.error.message); return; }
          }
        } else {
          var newStatus = act === 'accept' ? 'confirmed' : 'declined';
          var upd = await sb.from('termine').update({ status: newStatus }).eq('id', id);
          if (upd.error) { alert('Aktion fehlgeschlagen: ' + upd.error.message); return; }
        }
        await refreshStudentDetail();
        await loadAllTermine();
        return;
      }

      // Zahlung als bezahlt/offen markieren
      var pay = e.target.closest('[data-pay]');
      if (pay) {
        var pid = pay.dataset.pay;
        var p = currentPayments.filter(function (x) { return x.id === pid; })[0];
        if (!p) return;
        var nowPaid = !p.paid;
        var pu = await sb.from('payments').update({
          paid: nowPaid, paid_at: nowPaid ? new Date().toISOString() : null
        }).eq('id', pid);
        if (pu.error) { alert('Aktion fehlgeschlagen: ' + pu.error.message); return; }
        await refreshStudentDetail();
        return;
      }
      // Zahlung löschen
      var pdel = e.target.closest('[data-pay-del]');
      if (pdel) {
        if (!confirm('Diese Zahlung löschen?')) return;
        var pd = await sb.from('payments').delete().eq('id', pdel.dataset.payDel);
        if (pd.error) { alert('Aktion fehlgeschlagen: ' + pd.error.message); return; }
        await refreshStudentDetail();
        return;
      }

      var dl = e.target.closest('[data-dl]');
      if (dl) {
        e.preventDefault();
        var doc = currentDocs.filter(function (d) { return d.id === dl.dataset.dl; })[0];
        if (!doc) return;
        var s = await sb.storage.from('documents').createSignedUrl(doc.storage_path, 120, { download: doc.name });
        if (s.error) { alert('Download fehlgeschlagen: ' + s.error.message); return; }
        window.open(s.data.signedUrl, '_blank');
      }
    });

    // Tutor schlägt dem Schüler einen Termin vor / legt eine Zahlung an
    document.getElementById('studentDetail').addEventListener('submit', async function (e) {
      if (e.target.closest('#proposeForm')) {
        e.preventDefault();
        var date = document.getElementById('propDate').value;
        var time = document.getElementById('propTime').value;
        var endTime = document.getElementById('propTimeEnd').value;
        var title = document.getElementById('propTitle').value.trim();
        if (!date || !title) return;
        if (time && endTime && endTime <= time) { alert('Die Endzeit muss nach der Startzeit liegen.'); return; }
        var res = await sb.from('termine').insert({
          user_id: currentStudentId, date: date, time: time || null, end_time: endTime || null, title: title,
          status: 'proposed', proposed_by: 'tutor'
        });
        if (res.error) { alert('Konnte den Vorschlag nicht senden: ' + res.error.message); return; }
        await refreshStudentDetail();
        await loadAllTermine();
        return;
      }

      if (e.target.closest('#seriesForm')) {
        e.preventDefault();
        var sStart = document.getElementById('serStart').value;
        var sWeeks = parseInt(document.getElementById('serWeeks').value, 10);
        var sFrom = document.getElementById('serFrom').value;
        var sTo = document.getElementById('serTo').value;
        var sTitle = document.getElementById('serTitle').value.trim();
        var wds = [].slice.call(document.querySelectorAll('#seriesForm [data-wd]:checked'))
          .map(function (c) { return parseInt(c.dataset.wd, 10); });
        if (!sStart || !sTitle) return;
        if (!sWeeks || sWeeks < 1) { alert('Bitte die Anzahl Wochen angeben.'); return; }
        if (!wds.length) { alert('Bitte mindestens einen Wochentag wählen.'); return; }
        if (sFrom && sTo && sTo <= sFrom) { alert('Die Endzeit muss nach der Startzeit liegen.'); return; }
        var dates = seriesDates(sStart, sWeeks, wds);
        if (!dates.length) return;
        var rr = await sb.rpc('propose_series', {
          p_student: currentStudentId, p_title: sTitle, p_dates: dates,
          p_time: sFrom || null, p_end: sTo || null
        });
        if (rr.error) { alert('Serie konnte nicht angelegt werden: ' + rr.error.message); return; }
        await refreshStudentDetail();
        await loadAllTermine();
        return;
      }

      if (e.target.closest('#payForm')) {
        e.preventDefault();
        var label = document.getElementById('payLabel').value.trim();
        var amountRaw = document.getElementById('payAmount').value;
        var due = document.getElementById('payDue').value;
        if (!label) return;
        var row = { user_id: currentStudentId, label: label, due_date: due || null };
        if (amountRaw !== '') row.amount = parseFloat(amountRaw.replace(',', '.'));
        var pr = await sb.from('payments').insert(row);
        if (pr.error) { alert('Konnte die Zahlung nicht anlegen: ' + pr.error.message); return; }
        await refreshStudentDetail();
        return;
      }
    });

    // Chat: Unterhaltung wählen (Schüler ODER Gruppe) + zurück
    document.getElementById('chatPickWrap').addEventListener('click', function (e) {
      var row = e.target.closest('[data-conv-kind]');
      if (row) openConvo(row.dataset.convKind, row.dataset.convId, row.dataset.convName);
    });
    document.getElementById('chatBack').addEventListener('click', chatBackToList);

    // Lerngruppen: anlegen, öffnen, Mitglieder verwalten
    document.getElementById('groupForm').addEventListener('submit', createGroup);
    document.getElementById('groupList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-group]');
      if (row) openGroup(row.dataset.group);
    });
    document.getElementById('groupDetail').addEventListener('click', onGroupDetailClick);
    document.getElementById('groupDetail').addEventListener('submit', onGroupDetailSubmit);

    wireCms();
    wireCalendar();
    wireNotifications();
    wireMaterials();

    await loadStudents();
    await loadGroups();
    await loadAllTermine();
    await loadAllAvailabilities();
    await loadNotifications();
    await loadMaterials();
  })();

  function wirePanels() {
    function showPanel(name) {
      document.querySelectorAll('.panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'panel-' + name);
      });
      document.querySelectorAll('.side-link[data-panel]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.panel === name);
      });
      window.scrollTo(0, 0);
    }
    document.querySelectorAll('.side-link[data-panel]').forEach(function (b) {
      b.addEventListener('click', function () { showPanel(b.dataset.panel); });
    });
    document.querySelectorAll('.ov-card[data-open]').forEach(function (c) {
      c.addEventListener('click', function () { showPanel(c.dataset.open); });
    });
  }

  async function loadStudents() {
    var list = document.getElementById('studentList');
    var res = await sb.from('profiles')
      .select('id,full_name,email,is_admin,created_at')
      .order('created_at', { ascending: true });

    if (res.error) {
      list.innerHTML = '<p class="empty-note">Konnte Schüler nicht laden: ' + esc(res.error.message) + '</p>';
      return;
    }
    students = res.data || [];
    setText('ovStudents', students.length);
    renderChatStudents();

    if (!students.length) {
      list.innerHTML = '<p class="empty-note">Noch keine Registrierungen.</p>';
      return;
    }

    var body = students.map(function (p) {
      return '<tr data-student="' + esc(p.id) + '">' +
        '<td>' + esc(p.full_name || '—') + (p.is_admin ? ' <span class="admin-badge">Admin</span>' : '') + '</td>' +
        '<td>' + esc(p.email || '—') + '</td>' +
        '<td>' + esc(fmtDay(p.created_at)) + '</td>' +
        '</tr>';
    }).join('');

    list.innerHTML =
      '<table class="admin-table"><thead><tr>' +
      '<th>Name</th><th>E-Mail</th><th>Registriert</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function backToList() {
    document.getElementById('studentDetail').hidden = true;
    document.getElementById('studentListWrap').hidden = false;
    window.scrollTo(0, 0);
  }

  async function openStudent(id) {
    var s = students.filter(function (p) { return p.id === id; })[0];
    if (!s) return;
    currentStudentId = id;
    document.getElementById('studentListWrap').hidden = true;
    var detail = document.getElementById('studentDetail');
    detail.hidden = false;
    detail.innerHTML = '<p class="empty-note">Lädt …</p>';
    window.scrollTo(0, 0);
    await refreshStudentDetail();
  }

  async function refreshStudentDetail() {
    var id = currentStudentId;
    var s = students.filter(function (p) { return p.id === id; })[0];
    if (!s) return;
    var detail = document.getElementById('studentDetail');

    var tRes = await sb.from('termine').select('id,date,time,end_time,title,status,proposed_by,cancelled_at,cancelled_by,series_id').eq('user_id', id).order('date', { ascending: true });
    var lRes = await sb.from('plan_lists').select('id,title,created_at').eq('user_id', id).order('created_at', { ascending: true });
    var kRes = await sb.from('plan_tasks').select('id,list_id,text,done').eq('user_id', id);
    var dRes = await sb.from('docs').select('id,name,size,type,storage_path,created_at').eq('user_id', id).order('created_at', { ascending: false });
    var aRes = await sb.from('availabilities').select('id,weekday,from_time,to_time').eq('user_id', id).order('weekday', { ascending: true });
    var pRes = await sb.from('payments').select('id,label,amount,due_date,paid,paid_at,created_at').eq('user_id', id).order('created_at', { ascending: false });

    var firstErr = (tRes.error || lRes.error || kRes.error || dRes.error || aRes.error || pRes.error);
    if (firstErr) {
      detail.innerHTML = '<button class="btn btn-ghost btn-sm" id="backBtn">← Zurück</button>' +
        '<p class="empty-note" style="margin-top:18px">Konnte Daten nicht laden: ' + esc(firstErr.message) + '</p>';
      return;
    }

    var byList = {};
    (kRes.data || []).forEach(function (t) { (byList[t.list_id] = byList[t.list_id] || []).push(t); });
    var plan = (lRes.data || []).map(function (l) { return { id: l.id, title: l.title, tasks: byList[l.id] || [] }; });

    currentDocs = dRes.data || [];
    currentPayments = pRes.data || [];
    currentTermine = tRes.data || [];
    detail.innerHTML = renderDetail(s, currentTermine, plan, currentDocs, aRes.data || [], currentPayments);
  }

  function adminProposalRow(x) {
    var info, actions;
    if (x.status === 'declined') {
      info = '<span class="badge badge-declined">Abgelehnt</span>';
      actions = '<button class="icon-btn" data-tid="' + esc(x.id) + '" data-tact="remove" title="Entfernen">✕</button>';
    } else if (x.proposed_by === 'student') {
      info = '<span class="badge badge-pending">Vom Schüler</span>';
      actions = '<button class="btn-confirm" data-tid="' + esc(x.id) + '" data-tact="accept">Annehmen</button>' +
        '<button class="btn btn-ghost btn-sm" data-tid="' + esc(x.id) + '" data-tact="decline">Ablehnen</button>';
    } else if (x.series_id) {
      info = '<span class="badge badge-pending">Serie · Gesendet</span>';
      actions = '<button class="btn btn-ghost btn-sm" data-tid="' + esc(x.id) + '" data-series="' + esc(x.series_id) + '" data-tact="cancelseries">Serie zurückziehen</button>';
    } else {
      info = '<span class="badge badge-pending">Gesendet</span>';
      actions = '<button class="btn btn-ghost btn-sm" data-tid="' + esc(x.id) + '" data-tact="remove">Zurückziehen</button>';
    }
    return '<div class="row-item"><span class="when">' + esc(fmtTermin(x.date, x.time, x.end_time)) + '</span>' +
      '<span class="grow">' + esc(x.title) + ' ' + info + '</span>' + actions + '</div>';
  }

  function cancelInfo(x) {
    var who = x.cancelled_by === 'student' ? 'Schüler' : 'Tutor';
    return x.cancelled_at
      ? ' <small class="cancel-note">abgesagt am ' + esc(fmtDay(x.cancelled_at)) + ' von ' + who + '</small>'
      : '';
  }

  function renderDetail(s, termine, plan, docs, avail, payments) {
    var confirmed = termine.filter(function (x) { return x.status === 'confirmed'; });
    var cancelled = termine.filter(function (x) { return x.status === 'cancelled'; });
    var open = termine.filter(function (x) {
      return x.status === 'proposed' || (x.status === 'declined' && x.proposed_by === 'tutor');
    });

    var proposeForm =
      '<form class="add-row" id="proposeForm">' +
      '<input type="date" id="propDate" required />' +
      '<span class="time-range"><input type="time" id="propTime" aria-label="Von" />' +
      '<span class="time-dash">–</span>' +
      '<input type="time" id="propTimeEnd" aria-label="Bis" /></span>' +
      '<input type="text" id="propTitle" class="grow" placeholder="Titel, z. B. Sitzung Modul 2" required />' +
      '<button type="submit" class="btn btn-primary">Termin vorschlagen</button></form>';

    var seriesForm =
      '<form class="series-form" id="seriesForm">' +
      '<div class="series-row"><label>Ab <input type="date" id="serStart" required /></label>' +
      '<label>für <input type="number" id="serWeeks" min="1" max="52" value="6" /> Wochen</label>' +
      '<span class="time-range"><input type="time" id="serFrom" aria-label="Von" />' +
      '<span class="time-dash">–</span><input type="time" id="serTo" aria-label="Bis" /></span></div>' +
      '<div class="series-weekdays">' + DOW.map(function (d, i) {
        return '<label class="wd-opt"><input type="checkbox" data-wd="' + i + '" /> ' + d + '</label>';
      }).join('') + '</div>' +
      '<div class="series-row"><input type="text" id="serTitle" class="grow" placeholder="Titel, z. B. Sitzung Statistik" required />' +
      '<button type="submit" class="btn btn-primary">Serie vorschlagen</button></div></form>';

    var openHtml = open.length ? open.map(adminProposalRow).join('')
      : '<p class="empty-note">Keine offenen Vorschläge.</p>';

    var t = confirmed.length ? confirmed.map(function (x) {
      var badge = x.series_id ? '<span class="badge badge-confirmed">Serie</span>' : '<span class="badge badge-confirmed">Bestätigt</span>';
      var seriesBtn = x.series_id
        ? '<button class="btn btn-ghost btn-sm" data-tid="' + esc(x.id) + '" data-series="' + esc(x.series_id) + '" data-tact="cancelseries">Serie absagen</button>' : '';
      return '<div class="row-item"><span class="when">' + esc(fmtTermin(x.date, x.time, x.end_time)) + '</span>' +
        '<span class="grow">' + esc(x.title) + ' ' + badge + '</span>' +
        '<button class="btn btn-ghost btn-sm" data-tid="' + esc(x.id) + '" data-tact="cancel">Absagen</button>' + seriesBtn +
        '<button class="icon-btn" data-tid="' + esc(x.id) + '" data-tact="remove" title="Endgültig löschen">✕</button></div>';
    }).join('') : '<p class="empty-note">Keine bestätigten Termine.</p>';

    var cx = cancelled.length ? cancelled.map(function (x) {
      var badge = x.series_id ? '<span class="badge badge-cancelled">Serie · Abgesagt</span>' : '<span class="badge badge-cancelled">Abgesagt</span>';
      return '<div class="row-item"><span class="when">' + esc(fmtTermin(x.date, x.time, x.end_time)) + '</span>' +
        '<span class="grow">' + esc(x.title) + ' ' + badge + cancelInfo(x) + '</span>' +
        '<button class="icon-btn" data-tid="' + esc(x.id) + '" data-tact="remove" title="Endgültig löschen">✕</button></div>';
    }).join('') : '';

    var av = (avail && avail.length) ? avail.map(function (a) {
      return '<div class="row-item"><span class="when">' + esc(WEEKDAYS[a.weekday] || '—') + '</span>' +
        '<span class="grow">' + esc(a.from_time) + '–' + esc(a.to_time) + ' Uhr</span></div>';
    }).join('') : '<p class="empty-note">Keine Verfügbarkeiten eingetragen.</p>';

    var payForm =
      '<form class="add-row" id="payForm">' +
      '<input type="text" id="payLabel" class="grow" placeholder="Bezeichnung, z. B. Sitzung Modul 2" required />' +
      '<input type="text" id="payAmount" inputmode="decimal" placeholder="Betrag €" style="max-width:120px" />' +
      '<input type="date" id="payDue" aria-label="Fällig am" />' +
      '<button type="submit" class="btn btn-primary">Hinzufügen</button></form>';

    var pay = (payments && payments.length) ? payments.map(function (x) {
      var meta = [x.amount != null ? fmtEUR(x.amount) : '', x.due_date ? 'fällig ' + fmtDay(x.due_date) : '']
        .filter(Boolean).join(' · ');
      var badge = x.paid
        ? '<span class="badge badge-confirmed">Bezahlt' + (x.paid_at ? ' am ' + esc(fmtDay(x.paid_at)) : '') + '</span>'
        : '<span class="badge badge-pending">Offen</span>';
      return '<div class="row-item' + (x.paid ? ' done' : '') + '">' +
        '<input type="checkbox" data-pay="' + esc(x.id) + '"' + (x.paid ? ' checked' : '') + ' title="Als bezahlt markieren" />' +
        '<span class="grow">' + esc(x.label) + (meta ? ' <small class="muted-note">' + esc(meta) + '</small>' : '') + ' ' + badge + '</span>' +
        '<button class="icon-btn" data-pay-del="' + esc(x.id) + '" title="Löschen">✕</button></div>';
    }).join('') : '<p class="empty-note">Noch keine Zahlungen.</p>';

    var p = plan.length ? plan.map(function (l) {
      var done = l.tasks.filter(function (x) { return x.done; }).length;
      var tasks = l.tasks.map(function (x) {
        return '<div class="task' + (x.done ? ' done' : '') + '">' +
          '<input type="checkbox" disabled' + (x.done ? ' checked' : '') + ' />' +
          '<label>' + esc(x.text) + '</label></div>';
      }).join('');
      return '<div class="plan-section"><div class="plan-section-head"><h3>' + esc(l.title) + '</h3>' +
        '<span class="plan-progress">' + done + '/' + l.tasks.length + ' erledigt</span></div>' + tasks + '</div>';
    }).join('') : '<p class="empty-note">Kein Lernplan.</p>';

    var d = docs.length ? docs.map(function (doc) {
      return '<div class="row-item"><span class="d-ico">' + esc(extIco(doc.name)) + '</span>' +
        '<span class="d-meta"><strong>' + esc(doc.name) + '</strong>' +
        '<small>' + fmtSize(doc.size) + ' · ' + esc(fmtDay(doc.created_at)) + '</small></span>' +
        '<a class="d-dl" href="#" data-dl="' + esc(doc.id) + '">Download</a></div>';
    }).join('') : '<p class="empty-note">Keine Dokumente.</p>';

    return '<button class="btn btn-ghost btn-sm" id="backBtn" style="margin-bottom:18px">← Zurück zur Liste</button>' +
      '<div class="panel-head"><h2>' + esc(s.full_name || '—') +
      (s.is_admin ? ' <span class="admin-badge">Admin</span>' : '') + '</h2>' +
      '<p>' + esc(s.email || '') + '</p></div>' +
      '<div class="list-head">Termin vorschlagen</div>' + proposeForm +
      '<div class="list-head" style="margin-top:26px">Terminserie vorschlagen</div>' + seriesForm +
      '<div class="list-head" style="margin-top:26px">Offene Vorschläge</div>' + openHtml +
      '<div class="list-head" style="margin-top:26px">Bestätigte Termine</div>' + t +
      (cx ? '<div class="list-head" style="margin-top:26px">Abgesagte Termine</div>' + cx : '') +
      '<div class="list-head" style="margin-top:26px">Zahlungen</div>' + payForm + pay +
      '<div class="list-head" style="margin-top:26px">Verfügbarkeiten</div>' + av +
      '<div class="list-head" style="margin-top:26px">Lernplan</div>' + p +
      '<div class="list-head" style="margin-top:26px">Dokumente</div>' + d;
  }

  // =====================================================================
  // NACHRICHTEN (Chat mit einzelnen Schülern)
  // =====================================================================
  function renderChatStudents() {
    var wrap = document.getElementById('chatStudentList');
    if (!wrap) return;
    var others = students.filter(function (p) { return p.id !== myId; });
    if (!others.length) { wrap.innerHTML = '<p class="empty-note">Noch keine Schüler.</p>'; return; }
    wrap.innerHTML = '<table class="admin-table"><tbody>' + others.map(function (p) {
      var nm = p.full_name || p.email || '—';
      return '<tr data-conv-kind="student" data-conv-id="' + esc(p.id) + '" data-conv-name="' + esc(nm) + '">' +
        '<td>' + esc(nm) + (p.is_admin ? ' <span class="admin-badge">Admin</span>' : '') + '</td>' +
        '<td>' + esc(p.email || '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function renderChatGroups() {
    var wrap = document.getElementById('chatGroupList');
    if (!wrap) return;
    if (!groups.length) { wrap.innerHTML = '<p class="empty-note">Noch keine Gruppen.</p>'; return; }
    wrap.innerHTML = '<table class="admin-table"><tbody>' + groups.map(function (g) {
      return '<tr data-conv-kind="group" data-conv-id="' + esc(g.id) + '" data-conv-name="' + esc(g.name) + '">' +
        '<td>' + esc(g.name) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function chatBackToList() {
    document.getElementById('chatConvo').hidden = true;
    document.getElementById('chatPickWrap').hidden = false;
    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
  }

  async function openConvo(kind, id, name) {
    var col = kind === 'group' ? 'group_id' : 'student_id';

    document.getElementById('chatPickWrap').hidden = true;
    document.getElementById('chatConvo').hidden = false;
    setText('chatWith', (kind === 'group' ? 'Gruppe: ' : '') + (name || ''));

    var thread = document.getElementById('chatThread');
    var form = document.getElementById('chatForm');
    var seen = {};
    thread.innerHTML = '<p class="empty-note">Lädt …</p>';

    function add(m) {
      if (seen[m.id]) return; seen[m.id] = true;
      var mine = m.sender_id === myId;
      var time = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      var el = document.createElement('div');
      el.className = 'msg ' + (mine ? 'me' : 'them');
      el.innerHTML = (mine ? '' : '<span class="msg-from">' + esc(m.sender_name || 'Schüler') + '</span>') +
        '<div class="bubble">' + esc(m.body) + '</div><span class="msg-meta">' + esc(time) + '</span>';
      thread.appendChild(el);
    }
    function clearEmpty() { var n = thread.querySelector('.empty-note'); if (n) thread.innerHTML = ''; }
    function scrollDown() { thread.scrollTop = thread.scrollHeight; }

    var res = await sb.from('messages').select('id,sender_id,sender_name,body,created_at')
      .eq(col, id).order('created_at', { ascending: true });
    thread.innerHTML = '';
    var rows = res.data || [];
    if (res.error) thread.innerHTML = '<p class="empty-note">Fehler: ' + esc(res.error.message) + '</p>';
    else if (!rows.length) thread.innerHTML = '<p class="empty-note">Noch keine Nachrichten. Schreib die erste!</p>';
    else rows.forEach(add);
    scrollDown();

    form.onsubmit = async function (e) {
      e.preventDefault();
      var input = document.getElementById('chatText');
      var text = input.value.trim();
      if (!text) return;
      var btn = form.querySelector('button');
      btn.disabled = true;
      var payload = { body: text }; payload[col] = id;
      var r = await sb.from('messages').insert(payload)
        .select('id,sender_id,sender_name,body,created_at').single();
      btn.disabled = false;
      if (r.error) { alert('Senden fehlgeschlagen: ' + r.error.message); return; }
      clearEmpty(); add(r.data); scrollDown();
      input.value = '';
    };

    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
    chatChannel = sb.channel('admin-' + kind + '-' + id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: col + '=eq.' + id },
        function (payload) { clearEmpty(); add(payload.new); scrollDown(); })
      .subscribe();
  }

  // =====================================================================
  // LERNGRUPPEN (anlegen + Mitglieder verwalten)
  // =====================================================================
  async function loadGroups() {
    var res = await sb.from('groups').select('id,name,created_at').order('created_at', { ascending: true });
    groups = res.error ? [] : (res.data || []);
    renderGroupList();
    renderChatGroups();
  }

  function renderGroupList() {
    var wrap = document.getElementById('groupList');
    if (!wrap) return;
    if (!groups.length) { wrap.innerHTML = '<p class="empty-note">Noch keine Gruppen.</p>'; return; }
    wrap.innerHTML = '<table class="admin-table"><tbody>' + groups.map(function (g) {
      return '<tr data-group="' + esc(g.id) + '"><td>' + esc(g.name) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  async function createGroup(e) {
    e.preventDefault();
    var input = document.getElementById('groupName');
    var name = input.value.trim();
    if (!name) return;
    var res = await sb.from('groups').insert({ name: name }).select('id,name,created_at').single();
    if (res.error) { alert('Konnte Gruppe nicht anlegen: ' + res.error.message); return; }
    groups.push(res.data);
    input.value = '';
    renderGroupList(); renderChatGroups();
  }

  function groupBackToList() {
    document.getElementById('groupDetail').hidden = true;
    document.getElementById('groupListWrap').hidden = false;
  }

  async function openGroup(groupId) {
    var g = groups.filter(function (x) { return x.id === groupId; })[0];
    if (!g) return;
    var detail = document.getElementById('groupDetail');
    document.getElementById('groupListWrap').hidden = true;
    detail.hidden = false;
    detail.dataset.group = groupId;
    detail.innerHTML = '<p class="empty-note">Lädt …</p>';
    await refreshGroupDetail(groupId);
  }

  async function refreshGroupDetail(gid) {
    var g = groups.filter(function (x) { return x.id === gid; })[0];
    var mRes = await sb.from('group_members').select('user_id').eq('group_id', gid);
    var memberIds = (mRes.data || []).map(function (r) { return r.user_id; });
    document.getElementById('groupDetail').innerHTML = renderGroupDetail(g, memberIds);
  }

  function renderGroupDetail(g, memberIds) {
    var memberSet = {}; memberIds.forEach(function (id) { memberSet[id] = true; });
    var members = students.filter(function (p) { return memberSet[p.id]; });
    var nonMembers = students.filter(function (p) { return !memberSet[p.id] && !p.is_admin; });

    var memberRows = members.length ? members.map(function (p) {
      return '<div class="row-item"><span class="grow">' + esc(p.full_name || p.email || '—') + '</span>' +
        '<button class="icon-btn" data-remove="' + esc(p.id) + '" title="Entfernen">✕</button></div>';
    }).join('') : '<p class="empty-note">Noch keine Mitglieder.</p>';

    var addForm = nonMembers.length
      ? '<form class="add-row" id="addMemberForm" style="margin-top:18px"><select id="addMemberSelect" class="grow">' +
        nonMembers.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.full_name || p.email || '—') + '</option>';
        }).join('') +
        '</select><button type="submit" class="btn btn-primary">Hinzufügen</button></form>'
      : '<p class="empty-note" style="margin-top:18px">Alle Schüler sind bereits in dieser Gruppe.</p>';

    return '<button class="btn btn-ghost btn-sm" id="groupBack" style="margin-bottom:18px">← Zurück zu Gruppen</button>' +
      '<div class="panel-head"><h2>' + esc(g ? g.name : '') + '</h2><p>Mitglieder verwalten</p></div>' +
      '<div class="list-head">Mitglieder</div>' + memberRows + addForm;
  }

  function onGroupDetailClick(e) {
    if (e.target.closest('#groupBack')) { groupBackToList(); return; }
    var rm = e.target.closest('[data-remove]');
    if (rm) removeMember(rm.dataset.remove);
  }

  async function onGroupDetailSubmit(e) {
    if (!e.target.closest('#addMemberForm')) return;
    e.preventDefault();
    var sel = document.getElementById('addMemberSelect');
    if (sel && sel.value) await addMember(sel.value);
  }

  async function addMember(uid) {
    var gid = document.getElementById('groupDetail').dataset.group;
    var res = await sb.from('group_members').insert({ group_id: gid, user_id: uid });
    if (res.error) { alert('Konnte nicht hinzufügen: ' + res.error.message); return; }
    await refreshGroupDetail(gid);
  }

  async function removeMember(uid) {
    var gid = document.getElementById('groupDetail').dataset.group;
    var res = await sb.from('group_members').delete().eq('group_id', gid).eq('user_id', uid);
    if (res.error) { alert('Konnte nicht entfernen: ' + res.error.message); return; }
    await refreshGroupDetail(gid);
  }

  // =====================================================================
  // INHALTE (CMS) – Texte der öffentlichen Seiten bearbeiten
  // =====================================================================
  var CMS_PAGES = [
    { file: 'index.html',       label: 'Startseite' },
    { file: 'ueber.html',       label: 'Über' },
    { file: 'preise.html',      label: 'Preise' },
    { file: 'kontakt.html',     label: 'Kontakt' },
    { file: 'module.html',      label: 'Module (Übersicht)' },
    { file: 'm2.html',          label: 'Modul 2 – Statistik' },
    { file: 'r1.html',          label: 'R-Kurs 1' },
    { file: 'mm1.html',         label: 'Master-Modul 1' },
    { file: 'r2.html',          label: 'R-Kurs 2' },
    { file: 'impressum.html',   label: 'Impressum' },
    { file: 'datenschutz.html', label: 'Datenschutz' }
  ];

  function wireCms() {
    var sel = document.getElementById('cmsPage');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seite wählen —</option>' +
      CMS_PAGES.map(function (p) { return '<option value="' + esc(p.file) + '">' + esc(p.label) + '</option>'; }).join('');
    sel.addEventListener('change', function () {
      if (sel.value) loadCmsPage(sel.value);
      else document.getElementById('cmsFields').innerHTML = '<p class="empty-note">Wähle oben eine Seite.</p>';
    });
    document.getElementById('cmsFields').addEventListener('submit', saveCms);
  }

  async function loadCmsPage(file) {
    var wrap = document.getElementById('cmsFields');
    wrap.innerHTML = '<p class="empty-note">Lädt …</p>';

    var html;
    try {
      var resp = await fetch(file, { cache: 'no-store' });
      if (!resp.ok) throw new Error(resp.status);
      html = await resp.text();
    } catch (e) {
      wrap.innerHTML = '<p class="empty-note">Konnte die Seite nicht laden (' + esc(String(e.message || e)) + ').</p>';
      return;
    }

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var els = doc.querySelectorAll('[data-cms],[data-cms-html]');
    if (!els.length) {
      wrap.innerHTML = '<p class="empty-note">Diese Seite hat keine editierbaren Texte.</p>';
      return;
    }

    var dbRes = await sb.from('site_content').select('key,value');
    if (dbRes.error) {
      wrap.innerHTML = '<p class="empty-note">Konnte gespeicherte Inhalte nicht laden: ' + esc(dbRes.error.message) + '</p>';
      return;
    }
    var dbMap = {};
    (dbRes.data || []).forEach(function (r) { dbMap[r.key] = r.value; });

    var fields = [];
    els.forEach(function (el) {
      var htmlKey = el.getAttribute('data-cms-html');
      var key = htmlKey || el.getAttribute('data-cms');
      if (!key) return;
      var def = (htmlKey ? el.innerHTML : el.textContent).trim();
      var cur = dbMap[key] != null ? dbMap[key] : def;
      fields.push({ key: key, value: cur, html: !!htmlKey });
    });

    wrap.innerHTML = '<form id="cmsForm">' + fields.map(function (f) {
      var rows = f.value.length > 70 ? 3 : 2;
      return '<div class="cms-field"><label>' + esc(f.key) + (f.html ? ' · HTML erlaubt' : '') + '</label>' +
        '<textarea data-key="' + esc(f.key) + '" rows="' + rows + '">' + esc(f.value) + '</textarea></div>';
    }).join('') +
      '<button class="btn btn-primary" type="submit">Änderungen speichern</button>' +
      '<span id="cmsStatus" style="margin-left:14px;color:var(--muted)"></span></form>';
  }

  async function saveCms(e) {
    if (!e.target.closest('#cmsForm')) return;
    e.preventDefault();
    var status = document.getElementById('cmsStatus');
    var rows = [].slice.call(document.querySelectorAll('#cmsForm textarea')).map(function (t) {
      return { key: t.dataset.key, value: t.value };
    });
    status.textContent = 'Speichert …';
    var res = await sb.from('site_content').upsert(rows, { onConflict: 'key' });
    status.textContent = res.error ? ('Fehler: ' + res.error.message) : 'Gespeichert ✓';
  }

  // =====================================================================
  // KALENDER — alle Termine aller Schüler
  // =====================================================================
  async function loadAllTermine() {
    var res = await sb.from('termine')
      .select('id,user_id,date,time,end_time,title,status')
      .order('date', { ascending: true });
    allTermine = res.error ? [] : (res.data || []);
    renderAdminCalendar();
  }

  function wireCalendar() {
    var prev = document.getElementById('calPrev');
    if (!prev) return;
    prev.addEventListener('click', function () {
      calM--; if (calM < 0) { calM = 11; calY--; } renderAdminCalendar();
    });
    document.getElementById('calNext').addEventListener('click', function () {
      calM++; if (calM > 11) { calM = 0; calY++; } renderAdminCalendar();
    });
    document.getElementById('calToday').addEventListener('click', function () {
      var d = new Date(); calY = d.getFullYear(); calM = d.getMonth(); renderAdminCalendar();
    });
  }

  function renderAdminCalendar() {
    var grid = document.getElementById('calGrid');
    if (!grid) return;
    document.getElementById('calMonth').textContent = MONTHS[calM] + ' ' + calY;
    grid.innerHTML = '';

    DOW.forEach(function (d) {
      var h = document.createElement('div');
      h.className = 'cal-dow'; h.textContent = d; grid.appendChild(h);
    });

    var first = new Date(calY, calM, 1);
    var offset = (first.getDay() + 6) % 7; // Montag = 0
    var days = new Date(calY, calM + 1, 0).getDate();
    for (var i = 0; i < offset; i++) {
      var e = document.createElement('div');
      e.className = 'cal-cell empty'; grid.appendChild(e);
    }

    var today = todayStr();
    // nur aktive Termine im Raster (Abgesagte/Abgelehnte ausblenden)
    var active = allTermine.filter(function (t) { return t.status === 'confirmed' || t.status === 'proposed'; });

    for (var day = 1; day <= days; day++) {
      var dateStr = calY + '-' + pad(calM + 1) + '-' + pad(day);
      var cell = document.createElement('div');
      cell.className = 'cal-cell' + (dateStr === today ? ' today' : '');
      cell.dataset.date = dateStr;
      var html = '<span class="cal-date">' + day + '</span>';

      var evs = active.filter(function (t) { return t.date === dateStr; })
        .sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
      evs.slice(0, 2).forEach(function (ev) {
        var cls = 'cal-ev' + (ev.status === 'proposed' ? ' pending' : '');
        html += '<div class="' + cls + '">' + (ev.time ? esc(ev.time) + ' ' : '') + esc(studentName(ev.user_id)) + '</div>';
      });
      if (evs.length > 2) html += '<div class="cal-ev" style="background:var(--muted)">+' + (evs.length - 2) + '</div>';

      if (evs.length) {
        var d = new Date(dateStr + 'T00:00');
        var head = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
        var rows = evs.map(function (ev) {
          var range = ev.time ? (ev.end_time ? ev.time + '–' + ev.end_time : ev.time) : '';
          var badge = ev.status === 'proposed' ? ' <span class="cal-pop-badge">Vorschlag</span>' : '';
          return '<div class="cal-pop-row">' +
            '<span class="cal-pop-time">' + esc(range || 'ganztägig') + '</span>' +
            '<span class="cal-pop-title"><strong>' + esc(studentName(ev.user_id)) + '</strong> · ' + esc(ev.title) + badge + '</span></div>';
        }).join('');
        html += '<div class="cal-pop"><div class="cal-pop-head">' + esc(head) + '</div>' + rows + '</div>';
        cell.classList.add('has-events');
      }

      cell.innerHTML = html;
      grid.appendChild(cell);
    }
  }

  // =====================================================================
  // VERFÜGBARKEITEN — alle Schüler, sortiert nach Name
  // =====================================================================
  async function loadAllAvailabilities() {
    var wrap = document.getElementById('availAll');
    if (!wrap) return;
    var res = await sb.from('availabilities')
      .select('id,user_id,weekday,from_time,to_time')
      .order('weekday', { ascending: true });
    if (res.error) {
      wrap.innerHTML = '<p class="empty-note">Konnte Verfügbarkeiten nicht laden: ' + esc(res.error.message) + '</p>';
      return;
    }
    var rows = res.data || [];
    if (!rows.length) { wrap.innerHTML = '<p class="empty-note">Noch keine Verfügbarkeiten eingetragen.</p>'; return; }

    var byUser = {};
    rows.forEach(function (a) { (byUser[a.user_id] = byUser[a.user_id] || []).push(a); });

    var blocks = Object.keys(byUser)
      .map(function (uid) { return { uid: uid, name: studentName(uid), items: byUser[uid] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });

    wrap.innerHTML = blocks.map(function (b) {
      var items = b.items.slice().sort(function (x, y) {
        return x.weekday - y.weekday || (x.from_time < y.from_time ? -1 : 1);
      });
      var list = items.map(function (a) {
        return '<div class="row-item"><span class="when">' + esc(WEEKDAYS[a.weekday] || '—') + '</span>' +
          '<span class="grow">' + esc(a.from_time) + '–' + esc(a.to_time) + ' Uhr</span></div>';
      }).join('');
      return '<div class="avail-block"><div class="list-head">' + esc(b.name) + '</div>' + list + '</div>';
    }).join('');
  }

  // =====================================================================
  // MATERIALIEN — hochladen + gezielt teilen
  // =====================================================================
  function safeName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80); }

  function wireMaterials() {
    var form = document.getElementById('materialForm');
    if (!form) return;
    var fileInput = document.getElementById('materialFile');
    var drop = document.getElementById('materialDrop');
    var nameLbl = document.getElementById('materialFileName');

    function pick(file) {
      pickedMaterialFile = file || null;
      nameLbl.textContent = file ? (file.name + ' · ' + fmtSize(file.size)) : 'Bis 25 MB pro Datei.';
    }
    fileInput.addEventListener('change', function () { pick(fileInput.files[0]); });
    ['dragover', 'dragenter'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });

    form.addEventListener('submit', uploadMaterial);

    document.getElementById('materialList').addEventListener('click', async function (e) {
      var dl = e.target.closest('[data-mat-dl]');
      if (dl) {
        e.preventDefault();
        var m = materials.filter(function (x) { return x.id === dl.dataset.matDl; })[0];
        if (!m) return;
        var s = await sb.storage.from('materials').createSignedUrl(m.storage_path, 120, { download: m.name });
        if (s.error) { alert('Download fehlgeschlagen: ' + s.error.message); return; }
        window.open(s.data.signedUrl, '_blank');
        return;
      }
      var del = e.target.closest('[data-mat-del]');
      if (del) {
        var mm = materials.filter(function (x) { return x.id === del.dataset.matDel; })[0];
        if (!mm) return;
        if (!confirm('„' + mm.name + '" wirklich löschen?')) return;
        await sb.storage.from('materials').remove([mm.storage_path]);
        var dr = await sb.from('materials').delete().eq('id', mm.id);
        if (dr.error) { alert('Löschen fehlgeschlagen: ' + dr.error.message); return; }
        await loadMaterials();
      }
    });
  }

  function renderMaterialTargets() {
    var wrap = document.getElementById('materialTargets');
    if (!wrap) return;
    var realStudents = students.filter(function (p) { return !p.is_admin; });
    var html = '';
    if (realStudents.length) {
      html += '<div class="share-group"><span class="share-label">Schüler</span>' +
        realStudents.map(function (p) {
          return '<label class="share-opt"><input type="checkbox" data-share-student="' + esc(p.id) + '" /> ' +
            esc(p.full_name || p.email || '—') + '</label>';
        }).join('') + '</div>';
    }
    if (groups.length) {
      html += '<div class="share-group"><span class="share-label">Gruppen</span>' +
        groups.map(function (g) {
          return '<label class="share-opt"><input type="checkbox" data-share-group="' + esc(g.id) + '" /> ' +
            esc(g.name) + '</label>';
        }).join('') + '</div>';
    }
    wrap.innerHTML = html || '<p class="empty-note">Noch keine Schüler oder Gruppen.</p>';
  }

  async function uploadMaterial(e) {
    e.preventDefault();
    var status = document.getElementById('materialStatus');
    if (!pickedMaterialFile) { status.textContent = 'Bitte zuerst eine Datei wählen.'; return; }
    if (pickedMaterialFile.size > MAX_MATERIAL) { status.textContent = 'Datei größer als 25 MB.'; return; }

    var studentIds = [].slice.call(document.querySelectorAll('[data-share-student]:checked'))
      .map(function (c) { return c.dataset.shareStudent; });
    var groupIds = [].slice.call(document.querySelectorAll('[data-share-group]:checked'))
      .map(function (c) { return c.dataset.shareGroup; });
    if (!studentIds.length && !groupIds.length) { status.textContent = 'Bitte mindestens einen Empfänger wählen.'; return; }

    var file = pickedMaterialFile;
    var id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
    var path = id + '/' + safeName(file.name);
    status.textContent = 'Lädt hoch …';

    var up = await sb.storage.from('materials').upload(path, file, {
      contentType: file.type || 'application/octet-stream', upsert: false
    });
    if (up.error) { status.textContent = 'Upload fehlgeschlagen: ' + up.error.message; return; }

    var mRes = await sb.from('materials').insert({
      id: id, name: file.name, size: file.size, type: file.type, storage_path: path
    }).select('id').single();
    if (mRes.error) {
      await sb.storage.from('materials').remove([path]);
      status.textContent = 'Fehler: ' + mRes.error.message; return;
    }

    var shares = studentIds.map(function (sid) { return { material_id: id, student_id: sid }; })
      .concat(groupIds.map(function (gid) { return { material_id: id, group_id: gid }; }));
    var sRes = await sb.from('material_shares').insert(shares);
    if (sRes.error) {
      await sb.from('materials').delete().eq('id', id);
      await sb.storage.from('materials').remove([path]);
      status.textContent = 'Teilen fehlgeschlagen: ' + sRes.error.message; return;
    }

    status.textContent = 'Hochgeladen ✓';
    pickedMaterialFile = null;
    document.getElementById('materialForm').reset();
    document.getElementById('materialFileName').textContent = 'Bis 25 MB pro Datei.';
    await loadMaterials();
  }

  async function loadMaterials() {
    renderMaterialTargets();
    var list = document.getElementById('materialList');
    if (!list) return;
    var mRes = await sb.from('materials').select('id,name,size,type,storage_path,created_at')
      .order('created_at', { ascending: false });
    if (mRes.error) { list.innerHTML = '<p class="empty-note">Konnte Materialien nicht laden: ' + esc(mRes.error.message) + '</p>'; return; }
    materials = mRes.data || [];

    var sRes = await sb.from('material_shares').select('material_id,student_id,group_id');
    var byMat = {};
    (sRes.data || []).forEach(function (s) { (byMat[s.material_id] = byMat[s.material_id] || []).push(s); });

    if (!materials.length) { list.innerHTML = '<p class="empty-note">Noch keine Materialien geteilt.</p>'; return; }

    list.innerHTML = materials.map(function (m) {
      var targets = (byMat[m.id] || []).map(function (s) {
        if (s.student_id) return studentName(s.student_id);
        var g = groups.filter(function (x) { return x.id === s.group_id; })[0];
        return g ? ('Gruppe: ' + g.name) : 'Gruppe';
      });
      var shared = targets.length ? targets.join(', ') : '—';
      return '<div class="row-item"><span class="d-ico">' + esc(extIco(m.name)) + '</span>' +
        '<span class="d-meta"><strong>' + esc(m.name) + '</strong>' +
        '<small>' + fmtSize(m.size) + ' · ' + esc(fmtDay(m.created_at)) + ' · geteilt mit ' + esc(shared) + '</small></span>' +
        '<a class="d-dl" href="#" data-mat-dl="' + esc(m.id) + '">Download</a>' +
        '<button class="icon-btn" data-mat-del="' + esc(m.id) + '" title="Löschen">✕</button></div>';
    }).join('');
  }

  // =====================================================================
  // BENACHRICHTIGUNGEN (Glocke)
  // =====================================================================
  function wireNotifications() {
    var bell = document.getElementById('notifBell');
    var menu = document.getElementById('notifMenu');
    if (!bell || !menu) return;
    bell.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      if (open) markNotifsRead();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== bell) menu.hidden = true;
    });
  }

  async function loadNotifications() {
    if (!myId) return;
    var res = await sb.from('notifications')
      .select('id,type,title,body,read,created_at')
      .order('created_at', { ascending: false }).limit(30);
    notifs = res.error ? [] : (res.data || []);
    renderNotifs();

    if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
    notifChannel = sb.channel('admin-notif-' + myId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + myId },
        function (payload) {
          notifs.unshift(payload.new);
          if (notifs.length > 30) notifs.pop();
          renderNotifs();
          loadAllTermine();
        })
      .subscribe();
  }

  function renderNotifs() {
    var list = document.getElementById('notifList');
    var count = document.getElementById('notifCount');
    var unread = notifs.filter(function (n) { return !n.read; }).length;
    if (count) {
      count.textContent = unread;
      count.hidden = unread === 0;
    }
    if (!list) return;
    if (!notifs.length) { list.innerHTML = '<p class="empty-note">Noch nichts Neues.</p>'; return; }
    list.innerHTML = notifs.map(function (n) {
      var when = new Date(n.created_at).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return '<div class="notif-item' + (n.read ? '' : ' unread') + '">' +
        '<strong>' + esc(n.title) + '</strong>' +
        (n.body ? '<span>' + esc(n.body) + '</span>' : '') +
        '<small>' + esc(when) + '</small></div>';
    }).join('');
  }

  async function markNotifsRead() {
    var unread = notifs.filter(function (n) { return !n.read; });
    if (!unread.length) return;
    notifs.forEach(function (n) { n.read = true; });
    renderNotifs();
    await sb.from('notifications').update({ read: true }).eq('user_id', myId).eq('read', false);
  }
})();
