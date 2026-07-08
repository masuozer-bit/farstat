/* =====================================================================
   Studiumm – Auth + Dashboard mit Supabase
   Echte Accounts: Registrierung (mit E-Mail-Bestätigung), Anmeldung,
   Terminkalender, Lernplan und Dokumente liegen serverseitig in
   Supabase (PostgreSQL + Storage), abgesichert über Row-Level-Security.
   ===================================================================== */

(function () {
  'use strict';

  // ---------- Supabase-Client ----------
  var cfg = window.STUDIUMM_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf('YOUR-') === -1;
  if (!configured) {
    console.error('Supabase ist noch nicht konfiguriert — bitte config.js mit Project URL und anon-Key ausfüllen.');
  }
  var sb = (window.supabase && configured)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  // ---------- Helfer ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uebersetzeFehler(msg) {
    msg = msg || '';
    if (/already registered|already been registered|User already/i.test(msg))
      return 'Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.';
    if (/Email not confirmed/i.test(msg))
      return 'Bitte bestätige zuerst deine E-Mail. Schau in dein Postfach (auch im Spam-Ordner).';
    if (/Invalid login credentials/i.test(msg))
      return 'E-Mail oder Passwort ist nicht korrekt.';
    if (/rate limit|too many|429/i.test(msg))
      return 'Zu viele Versuche. Bitte versuche es in einigen Minuten erneut.';
    if (/Password should be/i.test(msg))
      return 'Das Passwort muss mindestens 6 Zeichen haben.';
    return msg;
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  // ---------- Jahr im Footer ----------
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // =====================================================================
  // REGISTRIERUNG
  // =====================================================================
  var registerForm = document.getElementById('registerForm');
  if (registerForm) {
    var regErr = document.getElementById('formError');
    function regMsg(msg, ok) {
      regErr.textContent = msg;
      regErr.classList.add('show');
      regErr.style.color = ok ? '#1f6f54' : '';
    }
    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = val('name').trim();
      var email = val('email').trim().toLowerCase();
      var pw = val('password');
      var pw2 = val('password2');

      if (!name) return regMsg('Bitte gib deinen Namen ein.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return regMsg('Bitte gib eine gültige E-Mail-Adresse ein.');
      if (pw.length < 6) return regMsg('Das Passwort muss mindestens 6 Zeichen haben.');
      if (pw !== pw2) return regMsg('Die Passwörter stimmen nicht überein.');
      if (!sb) return regMsg('Der Server ist gerade nicht erreichbar. Bitte später erneut versuchen.');

      var btn = registerForm.querySelector('button[type=submit]');
      btn.disabled = true;
      var res = await sb.auth.signUp({
        email: email,
        password: pw,
        options: {
          data: { full_name: name },
          emailRedirectTo: location.origin + '/anmelden.html'
        }
      });
      btn.disabled = false;
      if (res.error) return regMsg(uebersetzeFehler(res.error.message));

      // E-Mail-Bestätigung ist aktiv → noch keine Session, Hinweis anzeigen.
      registerForm.reset();
      regMsg('Fast geschafft! Wir haben dir eine Bestätigungs-Mail an ' + email +
        ' geschickt. Bitte klicke den Link darin – danach kannst du dich anmelden.', true);
    });
  }

  // =====================================================================
  // ANMELDUNG
  // =====================================================================
  var loginForm = document.getElementById('loginForm');
  if (loginForm) {
    var logErr = document.getElementById('formError');

    // Falls die Session gerade per E-Mail-Bestätigungslink gesetzt wird,
    // direkt ins Dashboard weiterleiten.
    if (sb) {
      sb.auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_IN' && session) window.location.replace('dashboard.html');
      });
    }

    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = val('email').trim().toLowerCase();
      var pw = val('password');
      function fail(msg) { logErr.textContent = msg; logErr.classList.add('show'); }
      if (!sb) return fail('Der Server ist gerade nicht erreichbar. Bitte später erneut versuchen.');

      var btn = loginForm.querySelector('button[type=submit]');
      btn.disabled = true;
      var res = await sb.auth.signInWithPassword({ email: email, password: pw });
      btn.disabled = false;
      if (res.error) return fail(uebersetzeFehler(res.error.message));
      window.location.href = 'dashboard.html';
    });
  }

  // =====================================================================
  // PASSWORT VERGESSEN — Reset-Link anfordern (auf anmelden.html)
  // =====================================================================
  var forgotLink = document.getElementById('forgotLink');
  var forgotForm = document.getElementById('forgotForm');
  if (forgotLink && forgotForm) {
    var fgErr = document.getElementById('formError');
    function fgMsg(msg, ok) {
      if (!fgErr) return;
      fgErr.textContent = msg; fgErr.classList.add('show');
      fgErr.style.color = ok ? '#1f6f54' : '';
    }
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      forgotForm.hidden = !forgotForm.hidden;
      if (!forgotForm.hidden) {
        var pre = val('email').trim();
        if (pre) document.getElementById('forgotEmail').value = pre;
        document.getElementById('forgotEmail').focus();
      }
    });
    forgotForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = val('forgotEmail').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fgMsg('Bitte gib eine gültige E-Mail-Adresse ein.');
      if (!sb) return fgMsg('Der Server ist gerade nicht erreichbar. Bitte später erneut versuchen.');
      var btn = forgotForm.querySelector('button[type=submit]');
      btn.disabled = true;
      var res = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/passwort-neu.html'
      });
      btn.disabled = false;
      if (res.error) return fgMsg(uebersetzeFehler(res.error.message));
      forgotForm.reset(); forgotForm.hidden = true;
      fgMsg('Wenn ein Konto mit ' + email + ' existiert, haben wir dir einen Link zum ' +
        'Zurücksetzen geschickt. Bitte schau in dein Postfach (auch Spam).', true);
    });
  }

  // =====================================================================
  // NEUES PASSWORT SETZEN (auf passwort-neu.html, nach dem Reset-Link)
  // =====================================================================
  var newPwForm = document.getElementById('newPwForm');
  if (newPwForm) {
    var npErr = document.getElementById('formError');
    var recoveryReady = false;
    function npMsg(msg, ok) {
      if (!npErr) return;
      npErr.textContent = msg; npErr.classList.add('show');
      npErr.style.color = ok ? '#1f6f54' : '';
    }
    if (sb) {
      // Supabase setzt aus dem Link automatisch eine Recovery-Session.
      sb.auth.onAuthStateChange(function (event) {
        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') recoveryReady = true;
      });
      sb.auth.getSession().then(function (r) {
        if (r.data && r.data.session) recoveryReady = true;
      });
    }
    newPwForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = val('newpw');
      var pw2 = val('newpw2');
      if (pw.length < 6) return npMsg('Das Passwort muss mindestens 6 Zeichen haben.');
      if (pw !== pw2) return npMsg('Die Passwörter stimmen nicht überein.');
      if (!sb) return npMsg('Der Server ist gerade nicht erreichbar. Bitte später erneut versuchen.');
      if (!recoveryReady) return npMsg('Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.');
      var btn = newPwForm.querySelector('button[type=submit]');
      btn.disabled = true;
      var res = await sb.auth.updateUser({ password: pw });
      btn.disabled = false;
      if (res.error) return npMsg(uebersetzeFehler(res.error.message));
      npMsg('Passwort geändert ✓ Du wirst weitergeleitet …', true);
      setTimeout(function () { window.location.href = 'dashboard.html'; }, 1200);
    });
  }

  // =====================================================================
  // DASHBOARD
  // =====================================================================
  var appShell = document.getElementById('appShell');
  if (!appShell) return; // keine Dashboard-Seite -> fertig

  var user = null;
  var data = { termine: [], plan: [], docs: [], avail: [], materials: [], decks: [] };

  (async function initDashboard() {
    if (!sb) { window.location.href = 'anmelden.html'; return; }
    var sess = await sb.auth.getSession();
    user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.href = 'anmelden.html'; return; }

    var meta = user.user_metadata || {};
    var firstName = (meta.full_name || user.email || '').split(' ')[0] || user.email;
    var who = document.getElementById('whoami');
    if (who) who.textContent = 'Hallo, ' + firstName;
    var greeting = document.getElementById('greeting');
    if (greeting) greeting.textContent = 'Hallo, ' + firstName + ' 👋';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
      await sb.auth.signOut();
      window.location.href = 'index.html';
    });

    // Admin-Bereich-Link einblenden, falls dieses Konto Admin ist
    sb.from('profiles').select('is_admin').eq('id', user.id).single().then(function (r) {
      if (!r || !r.data || !r.data.is_admin) return;
      var side = document.querySelector('.app-side');
      if (!side) return;
      var back = side.querySelector('a[href="index.html"]');
      var a = document.createElement('a');
      a.className = 'side-link';
      a.href = 'admin.html';
      a.innerHTML = '<span class="ico">★</span> Admin-Bereich';
      side.insertBefore(a, back);
    });

    wirePanels();
    wireTermine();
    wireAvail();
    wirePlan();
    wireDecks();
    wireDocs();
    wireNotifications();
    initChat(user.id);

    await loadAll();
    renderCalendar(); renderTermine(); renderProposals(); renderCancelled(); renderAvail();
    renderPlan(); renderDecks(); renderDocs(); renderMaterials(); updateOverview();
    loadNotifications(user.id);
  })();

  async function loadAll() {
    var t = await sb.from('termine').select('id,date,time,end_time,title,status,proposed_by,cancelled_at,cancelled_by,series_id').order('date', { ascending: true });
    data.termine = (t.data || []).map(function (r) {
      return {
        id: r.id, date: r.date, time: r.time || '', endTime: r.end_time || '', title: r.title,
        status: r.status || 'confirmed', proposedBy: r.proposed_by,
        cancelledAt: r.cancelled_at, cancelledBy: r.cancelled_by, seriesId: r.series_id
      };
    });

    var av = await sb.from('availabilities').select('id,weekday,from_time,to_time').order('weekday', { ascending: true });
    data.avail = (av.data || []).map(function (r) {
      return { id: r.id, weekday: r.weekday, from: r.from_time, to: r.to_time };
    });

    var lists = await sb.from('plan_lists').select('id,title,created_at').order('created_at', { ascending: true });
    var tasks = await sb.from('plan_tasks').select('id,list_id,text,done,created_at').order('created_at', { ascending: true });
    var byList = {};
    (tasks.data || []).forEach(function (t) {
      (byList[t.list_id] = byList[t.list_id] || []).push({ id: t.id, text: t.text, done: t.done });
    });
    data.plan = (lists.data || []).map(function (l) {
      return { id: l.id, title: l.title, tasks: byList[l.id] || [] };
    });

    var d = await sb.from('docs').select('id,name,size,type,storage_path,created_at').order('created_at', { ascending: false });
    data.docs = (d.data || []).map(function (r) {
      return { id: r.id, name: r.name, size: r.size, type: r.type, date: r.created_at, path: r.storage_path };
    });

    var mat = await sb.from('materials').select('id,name,size,type,storage_path,created_at').order('created_at', { ascending: false });
    data.materials = (mat.data || []).map(function (r) {
      return { id: r.id, name: r.name, size: r.size, type: r.type, date: r.created_at, path: r.storage_path };
    });

    var decks = await sb.from('decks').select('id,name,deadline,retention,new_per_day,created_at').order('created_at', { ascending: true });
    var cards = await sb.from('cards').select('id,deck_id,front,back,state,difficulty,stability,due,last_review,reps,lapses,created_at').order('created_at', { ascending: true });
    var byDeck = {};
    (cards.data || []).forEach(function (c) {
      (byDeck[c.deck_id] = byDeck[c.deck_id] || []).push({
        id: c.id, front: c.front, back: c.back,
        state: c.state || 'new', difficulty: c.difficulty || 0, stability: c.stability || 0,
        due: c.due, last_review: c.last_review, reps: c.reps || 0, lapses: c.lapses || 0
      });
    });
    data.decks = (decks.data || []).map(function (d) {
      return {
        id: d.id, name: d.name, cards: byDeck[d.id] || [],
        deadline: d.deadline || '', retention: d.retention || 0.9, newPerDay: (d.new_per_day == null ? 10 : d.new_per_day)
      };
    });
  }

  function renderMaterials() {
    var list = document.getElementById('sharedMaterials');
    if (!list) return;
    var items = data.materials || [];
    if (!items.length) { list.innerHTML = '<p class="empty-note">Noch keine geteilten Materialien.</p>'; return; }
    list.innerHTML = items.map(function (m) {
      var when = new Date(m.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
      return '<div class="row-item"><span class="d-ico">' + esc(extIco(m.name)) + '</span>' +
        '<span class="d-meta"><strong>' + esc(m.name) + '</strong>' +
        '<small>' + fmtSize(m.size) + ' · ' + when + '</small></span>' +
        '<a class="d-dl" href="#" data-dl-material="' + m.id + '">Download</a></div>';
    }).join('');
  }

  function dbError(action, error) {
    console.error(action, error);
    alert('Konnte ' + action + ' nicht speichern.\n' + (error && error.message ? error.message : ''));
  }

  // ---------- Panel-Umschaltung ----------
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

  // ---------- Übersicht ----------
  function updateOverview() {
    var today = todayStr();
    var upcoming = data.termine.filter(function (t) { return t.status === 'confirmed' && t.date >= today; }).length;
    var openTasks = data.plan.reduce(function (n, l) {
      return n + l.tasks.filter(function (t) { return !t.done; }).length;
    }, 0);
    var dueCards = data.decks.reduce(function (n, d) { return n + deckStats(d).todayTotal; }, 0);
    setText('ovTermine', upcoming);
    setText('ovTasks', openTasks);
    setText('ovDue', dueCards);
    setText('ovDocs', data.docs.length);
  }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

  // =====================================================================
  // TERMINKALENDER
  // =====================================================================
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];
  var DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  var calRef = new Date();
  var calY = calRef.getFullYear(), calM = calRef.getMonth();

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // 'YYYY-MM-DD' um n Tage verschieben (UTC, damit Sommerzeit nicht stört).
  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // Zeitspanne formatieren: '14:00–15:30', '14:00' oder '' (ganztägig).
  function fmtRange(t) {
    if (!t.time) return '';
    return t.endTime ? t.time + '–' + t.endTime : t.time;
  }

  function renderCalendar() {
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
    for (var day = 1; day <= days; day++) {
      var dateStr = calY + '-' + pad(calM + 1) + '-' + pad(day);
      var cell = document.createElement('div');
      cell.className = 'cal-cell' + (dateStr === today ? ' today' : '');
      cell.dataset.date = dateStr;
      var html = '<span class="cal-date">' + day + '</span>';
      var evs = data.termine.filter(function (t) {
        return t.date === dateStr && (t.status === 'confirmed' || t.status === 'proposed');
      }).sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
      evs.slice(0, 2).forEach(function (ev) {
        var cls = 'cal-ev' + (ev.status === 'proposed' ? ' pending' : '');
        html += '<div class="' + cls + '">' + (ev.time ? esc(ev.time) + ' ' : '') + esc(ev.title) + '</div>';
      });
      if (evs.length > 2) html += '<div class="cal-ev" style="background:var(--muted)">+' + (evs.length - 2) + '</div>';

      // Hover-Detailfenster: zeigt alle Termine des Tages mit voller Zeitspanne.
      if (evs.length) {
        var d = new Date(dateStr + 'T00:00');
        var head = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
        var rows = evs.map(function (ev) {
          var range = fmtRange(ev);
          var badge = ev.status === 'proposed'
            ? ' <span class="cal-pop-badge">Vorschlag</span>' : '';
          return '<div class="cal-pop-row">' +
            '<span class="cal-pop-time">' + esc(range || 'ganztägig') + '</span>' +
            '<span class="cal-pop-title">' + esc(ev.title) + badge + '</span></div>';
        }).join('');
        html += '<div class="cal-pop"><div class="cal-pop-head">' + esc(head) + '</div>' + rows + '</div>';
        cell.classList.add('has-events');
      }

      cell.innerHTML = html;
      grid.appendChild(cell);
    }
  }

  function renderTermine() {
    var list = document.getElementById('terminList');
    if (!list) return;
    var today = todayStr();
    var items = data.termine.filter(function (t) { return t.status === 'confirmed' && t.date >= today; })
      .sort(function (a, b) {
        return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1;
      });
    if (!items.length) { list.innerHTML = '<p class="empty-note">Noch keine anstehenden Termine.</p>'; return; }
    list.innerHTML = items.map(function (t) {
      var d = new Date(t.date + 'T00:00');
      var when = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
      var range = fmtRange(t);
      if (range) when += ' · ' + range;
      var badge = t.seriesId ? ' <span class="badge badge-confirmed">Serie</span>' : '';
      var seriesBtn = t.seriesId
        ? '<button class="btn btn-ghost btn-sm" data-cancel-series="' + t.seriesId + '">Serie absagen</button>' : '';
      return '<div class="row-item"><span class="when">' + esc(when) + '</span>' +
        '<span class="grow">' + esc(t.title) + badge + '</span>' +
        '<button class="btn btn-ghost btn-sm" data-cancel-termin="' + t.id + '">Absagen</button>' + seriesBtn + '</div>';
    }).join('');
  }

  function fmtDay(iso) {
    return iso ? new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  function renderCancelled() {
    var head = document.getElementById('cancelledHead');
    var list = document.getElementById('cancelledList');
    if (!list) return;
    var items = data.termine.filter(function (t) { return t.status === 'cancelled'; })
      .sort(function (a, b) { return (a.date + (a.time || '')) > (b.date + (b.time || '')) ? -1 : 1; });
    if (head) head.hidden = !items.length;
    if (!items.length) { list.innerHTML = ''; return; }
    list.innerHTML = items.map(function (t) {
      var d = new Date(t.date + 'T00:00');
      var when = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
      var range = fmtRange(t);
      if (range) when += ' · ' + range;
      var who = t.cancelledBy === 'student' ? 'dir' : 'dem Tutor';
      var note = t.cancelledAt ? '<small class="cancel-note">abgesagt am ' + esc(fmtDay(t.cancelledAt)) + ' von ' + who + '</small>' : '';
      return '<div class="row-item"><span class="when">' + esc(when) + '</span>' +
        '<span class="grow">' + esc(t.title) + ' <span class="badge badge-cancelled">Abgesagt</span> ' + note + '</span></div>';
    }).join('');
  }

  function wireTermine() {
    var terminForm = document.getElementById('terminForm');
    if (!terminForm) return;

    terminForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var date = val('terminDate');
      var time = val('terminTime');
      var endTime = val('terminTimeEnd');
      var title = val('terminTitle').trim();
      if (!date || !title) return;
      if (time && endTime && endTime <= time) { alert('Die Endzeit muss nach der Startzeit liegen.'); return; }

      // Wiederholung: alle N Tage bis zu einem Enddatum (erzeugt Einzeltermine).
      var every = parseInt(val('terminRepeatEvery'), 10);
      var until = val('terminRepeatUntil');
      var dates = [date];
      if (!isNaN(every) && every > 0) {
        if (!until) { alert('Bitte ein Enddatum für die Wiederholung angeben.'); return; }
        if (until < date) { alert('Das Enddatum der Wiederholung muss nach dem Starttermin liegen.'); return; }
        var cur = date;
        while (dates.length < 366) {
          cur = addDays(cur, every);
          if (cur > until) break;
          dates.push(cur);
        }
      }

      // Button entscheidet: eigener (bestätigter) Eintrag oder Vorschlag an den Tutor.
      var propose = e.submitter && e.submitter.dataset.mode === 'propose';
      var status = propose ? 'proposed' : 'confirmed';
      var proposedBy = propose ? 'student' : null;
      var rows = dates.map(function (dt) {
        return { date: dt, time: time || null, end_time: endTime || null, title: title, status: status, proposed_by: proposedBy };
      });
      var res = await sb.from('termine').insert(rows)
        .select('id,date,time,end_time,title,status,proposed_by');
      if (res.error) return dbError(rows.length > 1 ? 'die Termine' : 'den Termin', res.error);
      (res.data || []).forEach(function (r) {
        data.termine.push({
          id: r.id, date: r.date, time: r.time || '', endTime: r.end_time || '',
          title: r.title, status: r.status, proposedBy: r.proposed_by
        });
      });
      terminForm.reset();
      renderCalendar(); renderTermine(); renderProposals(); updateOverview();
    });

    document.getElementById('terminProposals').addEventListener('click', async function (e) {
      var sBtn = e.target.closest('[data-series][data-sact]');
      if (sBtn) {
        var sid = sBtn.dataset.series;
        var sact = sBtn.dataset.sact; // accept | decline
        if (sact === 'decline' && !confirm('Die ganze Terminserie ablehnen?')) return;
        var r = await sb.rpc('update_series', { p_series: sid, p_action: sact, p_date: null });
        if (r.error) return dbError('die Serie', r.error);
        await loadAll();
        renderCalendar(); renderTermine(); renderProposals(); renderCancelled(); updateOverview();
        return;
      }
      var btn = e.target.closest('[data-prop]');
      if (!btn) return;
      var id = btn.dataset.prop;
      var act = btn.dataset.act; // accept | decline | remove
      var item = data.termine.filter(function (t) { return t.id === id; })[0];
      if (!item) return;
      if (act === 'remove') {
        // Schüler dürfen nicht löschen — eigenen Vorschlag zurückziehen = absagen.
        var del = await sb.from('termine').update({
          status: 'cancelled', cancelled_by: 'student', cancelled_at: new Date().toISOString()
        }).eq('id', id).select('id,cancelled_at,cancelled_by').single();
        if (del.error) return dbError('den Vorschlag', del.error);
        item.status = 'cancelled'; item.cancelledAt = del.data.cancelled_at; item.cancelledBy = del.data.cancelled_by;
      } else {
        var newStatus = act === 'accept' ? 'confirmed' : 'declined';
        var upd = await sb.from('termine').update({ status: newStatus }).eq('id', id)
          .select('id,status').single();
        if (upd.error) return dbError('den Vorschlag', upd.error);
        item.status = newStatus;
      }
      renderCalendar(); renderTermine(); renderProposals(); renderCancelled(); updateOverview();
    });

    // Lernplan-Dropdown: Auswahl übernimmt den Eintrag als Termintitel.
    document.getElementById('terminTask').addEventListener('change', function () {
      if (!this.value) return;
      document.getElementById('terminTitle').value = this.value;
      this.selectedIndex = 0;
    });

    document.getElementById('calPrev').addEventListener('click', function () {
      calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', function () {
      calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar();
    });
    document.getElementById('calToday').addEventListener('click', function () {
      var d = new Date(); calY = d.getFullYear(); calM = d.getMonth(); renderCalendar();
    });
    document.getElementById('calGrid').addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (!cell || cell.classList.contains('empty')) return;
      document.getElementById('terminDate').value = cell.dataset.date;
      document.getElementById('terminTitle').focus();
    });

    document.getElementById('terminList').addEventListener('click', async function (e) {
      // Ganze Serie absagen
      var sBtn = e.target.closest('[data-cancel-series]');
      if (sBtn) {
        if (!confirm('Die ganze Serie (alle zukünftigen Termine) absagen?')) return;
        var rs = await sb.rpc('update_series', { p_series: sBtn.dataset.cancelSeries, p_action: 'cancel', p_date: null });
        if (rs.error) return dbError('die Serie', rs.error);
        await loadAll();
        renderCalendar(); renderTermine(); renderProposals(); renderCancelled(); updateOverview();
        return;
      }
      var btn = e.target.closest('[data-cancel-termin]');
      if (!btn) return;
      var id = btn.dataset.cancelTermin;
      if (!confirm('Diesen Termin absagen?')) return;
      var item = data.termine.filter(function (t) { return t.id === id; })[0];
      // Einzeltermin einer Serie → über RPC (genau eine Benachrichtigung)
      if (item && item.seriesId) {
        var rc = await sb.rpc('update_series', { p_series: item.seriesId, p_action: 'cancel', p_date: item.date });
        if (rc.error) return dbError('die Absage', rc.error);
        await loadAll();
        renderCalendar(); renderTermine(); renderProposals(); renderCancelled(); updateOverview();
        return;
      }
      var res = await sb.from('termine').update({
        status: 'cancelled', cancelled_by: 'student', cancelled_at: new Date().toISOString()
      }).eq('id', id).select('id,cancelled_at,cancelled_by').single();
      if (res.error) return dbError('die Absage', res.error);
      if (item) { item.status = 'cancelled'; item.cancelledAt = res.data.cancelled_at; item.cancelledBy = res.data.cancelled_by; }
      renderCalendar(); renderTermine(); renderCancelled(); updateOverview();
    });
  }

  // ---------- Vorschläge (offene Terminvorschläge) ----------
  function renderProposals() {
    var wrap = document.getElementById('terminProposals');
    if (!wrap) return;
    var all = data.termine.filter(function (t) {
      return t.status === 'proposed' || (t.status === 'declined' && t.proposedBy === 'student');
    });

    // Serien-Vorschläge (vom Tutor) zu EINEM Eintrag gruppieren.
    var seriesMap = {}, singles = [];
    all.forEach(function (t) {
      if (t.seriesId && t.status === 'proposed') (seriesMap[t.seriesId] = seriesMap[t.seriesId] || []).push(t);
      else singles.push(t);
    });

    var rows = [];

    Object.keys(seriesMap).forEach(function (sid) {
      var grp = seriesMap[sid].slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var first = grp[0], last = grp[grp.length - 1];
      var range = fmtDay(first.date) + ' – ' + fmtDay(last.date);
      var timeTxt = first.time ? ' · ' + fmtRange(first) + ' Uhr' : '';
      rows.push({ sort: first.date, html:
        '<div class="row-item"><span class="when">Serie</span>' +
        '<span class="grow">' + esc(first.title) + ' <span class="badge badge-pending">Vom Tutor</span>' +
        '<small class="muted-note"> ' + grp.length + ' Termine · ' + esc(range) + esc(timeTxt) + '</small></span>' +
        '<button class="btn-confirm" data-series="' + esc(sid) + '" data-sact="accept">Serie annehmen</button>' +
        '<button class="btn btn-ghost btn-sm" data-series="' + esc(sid) + '" data-sact="decline">Ablehnen</button></div>' });
    });

    singles.forEach(function (t) {
      var d = new Date(t.date + 'T00:00');
      var when = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
      var range = fmtRange(t);
      if (range) when += ' · ' + range;
      var info, actions;
      if (t.status === 'declined') {
        info = '<span class="badge badge-declined">Abgelehnt</span>';
        actions = '<button class="icon-btn" data-prop="' + t.id + '" data-act="remove" title="Entfernen">✕</button>';
      } else if (t.proposedBy === 'tutor') {
        info = '<span class="badge badge-pending">Vom Tutor</span>';
        actions = '<button class="btn-confirm" data-prop="' + t.id + '" data-act="accept">Annehmen</button>' +
          '<button class="btn btn-ghost btn-sm" data-prop="' + t.id + '" data-act="decline">Ablehnen</button>';
      } else {
        info = '<span class="badge badge-pending">Gesendet</span>';
        actions = '<button class="btn btn-ghost btn-sm" data-prop="' + t.id + '" data-act="remove">Zurückziehen</button>';
      }
      rows.push({ sort: t.date, html: '<div class="row-item"><span class="when">' + esc(when) + '</span>' +
        '<span class="grow">' + esc(t.title) + ' ' + info + '</span>' + actions + '</div>' });
    });

    if (!rows.length) { wrap.innerHTML = '<p class="empty-note">Keine offenen Vorschläge.</p>'; return; }
    rows.sort(function (a, b) { return a.sort < b.sort ? -1 : 1; });
    wrap.innerHTML = rows.map(function (r) { return r.html; }).join('');
  }

  // ---------- Verfügbarkeiten ----------
  var WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  function renderAvail() {
    var wrap = document.getElementById('availList');
    if (!wrap) return;
    if (!data.avail.length) { wrap.innerHTML = '<p class="empty-note">Noch keine Verfügbarkeiten eingetragen.</p>'; return; }
    var items = data.avail.slice().sort(function (a, b) {
      return a.weekday - b.weekday || (a.from < b.from ? -1 : 1);
    });
    wrap.innerHTML = items.map(function (a) {
      return '<div class="row-item"><span class="when">' + esc(WEEKDAYS[a.weekday] || '—') + '</span>' +
        '<span class="grow">' + esc(a.from) + '–' + esc(a.to) + ' Uhr</span>' +
        '<button class="icon-btn" data-del-avail="' + a.id + '" title="Löschen">✕</button></div>';
    }).join('');
  }

  function wireAvail() {
    var form = document.getElementById('availForm');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var weekday = parseInt(val('availDay'), 10);
      var from = val('availFrom');
      var to = val('availTo');
      if (isNaN(weekday) || !from || !to) return;
      if (to <= from) { alert('Die Endzeit muss nach der Startzeit liegen.'); return; }
      var res = await sb.from('availabilities').insert({ weekday: weekday, from_time: from, to_time: to })
        .select('id,weekday,from_time,to_time').single();
      if (res.error) return dbError('die Verfügbarkeit', res.error);
      data.avail.push({ id: res.data.id, weekday: res.data.weekday, from: res.data.from_time, to: res.data.to_time });
      form.reset();
      renderAvail();
    });
    document.getElementById('availList').addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-del-avail]');
      if (!btn) return;
      var id = btn.dataset.delAvail;
      var res = await sb.from('availabilities').delete().eq('id', id);
      if (res.error) return dbError('die Verfügbarkeit', res.error);
      data.avail = data.avail.filter(function (a) { return a.id !== id; });
      renderAvail();
    });
  }

  // =====================================================================
  // LERNPLAN (strukturierbare To-do-Liste)
  // =====================================================================
  // Dropdown im Terminformular: nur offene (nicht abgehakte) Lernplan-Einträge.
  function renderTaskOptions() {
    var sel = document.getElementById('terminTask');
    if (!sel) return;
    var html = '<option value="">Aus Lernplan wählen…</option>';
    var count = 0;
    data.plan.forEach(function (l) {
      l.tasks.forEach(function (t) {
        if (t.done) return;
        count++;
        html += '<option value="' + esc(t.text) + '">' + esc(t.text) + ' · ' + esc(l.title) + '</option>';
      });
    });
    sel.innerHTML = html;
    sel.disabled = count === 0;
  }

  function renderPlan() {
    var wrap = document.getElementById('planList');
    if (!wrap) { renderTaskOptions(); return; }
    if (!data.plan.length) {
      wrap.innerHTML = '<p class="empty-note">Noch keine Listen. Lege oben deine erste an.</p>';
      renderTaskOptions();
      return;
    }
    wrap.innerHTML = data.plan.map(function (l) {
      var done = l.tasks.filter(function (t) { return t.done; }).length;
      var tasks = l.tasks.map(function (t) {
        return '<div class="task' + (t.done ? ' done' : '') + '">' +
          '<input type="checkbox" data-toggle="' + l.id + '|' + t.id + '"' + (t.done ? ' checked' : '') + ' />' +
          '<label>' + esc(t.text) + '</label>' +
          '<button class="icon-btn" data-del-task="' + l.id + '|' + t.id + '" title="Löschen">✕</button></div>';
      }).join('');
      return '<div class="plan-section">' +
        '<div class="plan-section-head"><h3>' + esc(l.title) + '</h3>' +
        '<span class="plan-progress">' + done + '/' + l.tasks.length + ' erledigt' +
        ' <button class="icon-btn" data-del-list="' + l.id + '" title="Liste löschen">🗑</button></span></div>' +
        tasks +
        '<form class="task-add" data-add-task="' + l.id + '">' +
        '<input type="text" placeholder="Aufgabe hinzufügen…" />' +
        '<button type="submit" class="btn btn-ghost btn-sm">+</button></form>' +
        '</div>';
    }).join('');
    renderTaskOptions();
  }

  function wirePlan() {
    var listForm = document.getElementById('listForm');
    if (!listForm) return;

    listForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var title = val('listTitle').trim();
      if (!title) return;
      var res = await sb.from('plan_lists').insert({ title: title }).select('id,title').single();
      if (res.error) return dbError('die Liste', res.error);
      data.plan.push({ id: res.data.id, title: res.data.title, tasks: [] });
      listForm.reset(); renderPlan();
    });

    var planWrap = document.getElementById('planList');
    planWrap.addEventListener('submit', async function (e) {
      var form = e.target.closest('[data-add-task]');
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector('input');
      var text = input.value.trim();
      if (!text) return;
      var listId = form.dataset.addTask;
      var res = await sb.from('plan_tasks').insert({ list_id: listId, text: text, done: false })
        .select('id,text,done').single();
      if (res.error) return dbError('die Aufgabe', res.error);
      var list = data.plan.filter(function (l) { return l.id === listId; })[0];
      if (list) { list.tasks.push({ id: res.data.id, text: res.data.text, done: res.data.done }); renderPlan(); updateOverview(); }
    });

    planWrap.addEventListener('change', async function (e) {
      var cb = e.target.closest('[data-toggle]');
      if (!cb) return;
      var ids = cb.dataset.toggle.split('|');
      var res = await sb.from('plan_tasks').update({ done: cb.checked }).eq('id', ids[1]);
      if (res.error) { cb.checked = !cb.checked; return dbError('die Aufgabe', res.error); }
      var list = data.plan.filter(function (l) { return l.id === ids[0]; })[0];
      var task = list && list.tasks.filter(function (t) { return t.id === ids[1]; })[0];
      if (task) { task.done = cb.checked; renderPlan(); updateOverview(); }
    });

    planWrap.addEventListener('click', async function (e) {
      var delTask = e.target.closest('[data-del-task]');
      var delList = e.target.closest('[data-del-list]');
      if (delTask) {
        var ids = delTask.dataset.delTask.split('|');
        var res = await sb.from('plan_tasks').delete().eq('id', ids[1]);
        if (res.error) return dbError('die Aufgabe', res.error);
        var list = data.plan.filter(function (l) { return l.id === ids[0]; })[0];
        if (list) { list.tasks = list.tasks.filter(function (t) { return t.id !== ids[1]; }); renderPlan(); updateOverview(); }
      } else if (delList) {
        var listId = delList.dataset.delList;
        var res2 = await sb.from('plan_lists').delete().eq('id', listId);
        if (res2.error) return dbError('die Liste', res2.error);
        data.plan = data.plan.filter(function (l) { return l.id !== listId; });
        renderPlan(); updateOverview();
      }
    });
  }

  // =====================================================================
  // KARTEIKARTEN — Anki-artig mit FSRS-Scheduler (DSR-Modell)
  // ---------------------------------------------------------------------
  // FSRS 4.5 (Free Spaced Repetition Scheduler): statt starrer Multiplikatoren
  // modelliert der Algorithmus für jede Karte Difficulty (D) und Stability (S)
  // und berechnet das Intervall so, dass die Merkwahrscheinlichkeit auf die
  // gewünschte Ziel-Merkrate (retention) fällt. Transparenz: vor jeder Antwort
  // sieht der Nutzer, wann jede Bewertung die Karte erneut fällig macht.
  // =====================================================================

  // Standard-Parameter von FSRS 4.5 (17 Gewichte, w0..w16).
  var FSRS_W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234,
    1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466];
  var FSRS_DECAY = -0.5;
  var FSRS_FACTOR = 19 / 81; // = 0.9^(1/DECAY) − 1  → Stability = Intervall bei 90 %

  function clampD(d) { return Math.min(Math.max(d, 1), 10); }
  function initStability(g) { return Math.max(FSRS_W[g - 1], 0.1); }
  function initDifficulty(g) { return clampD(FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1); }
  function nextDifficulty(d, g) {
    var nd = d - FSRS_W[6] * (g - 3);
    return clampD(FSRS_W[7] * FSRS_W[4] + (1 - FSRS_W[7]) * nd); // Rückkehr zum Mittelwert
  }
  // Merkwahrscheinlichkeit nach t Tagen bei Stabilität S.
  function retrievability(t, s) { return Math.pow(1 + FSRS_FACTOR * t / s, FSRS_DECAY); }
  // Intervall (Tage), damit die Merkrate genau auf r fällt.
  function intervalForRetention(s, r) { return (s / FSRS_FACTOR) * (Math.pow(r, 1 / FSRS_DECAY) - 1); }
  function nextStabilityRecall(d, s, r, g) {
    var hard = g === 2 ? FSRS_W[15] : 1;
    var easy = g === 4 ? FSRS_W[16] : 1;
    return s * (1 + Math.exp(FSRS_W[8]) * (11 - d) * Math.pow(s, -FSRS_W[9]) *
      (Math.exp((1 - r) * FSRS_W[10]) - 1) * hard * easy);
  }
  function nextStabilityForget(d, s, r) {
    return FSRS_W[11] * Math.pow(d, -FSRS_W[12]) * (Math.pow(s + 1, FSRS_W[13]) - 1) *
      Math.exp((1 - r) * FSRS_W[14]);
  }

  // Datum-Helfer.
  function parseDate(s) { var p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Berechnet (ohne die Karte zu verändern) die neue Planung für eine Bewertung g (1–4).
  function fsrsCompute(card, deck, g) {
    var ret = deck.retention || 0.9;
    var isNew = card.state === 'new' || !card.stability;
    var S, D;
    if (isNew) {
      S = initStability(g);
      D = initDifficulty(g);
    } else {
      var elapsed = card.last_review ? Math.max(0, diffDays(card.last_review, todayStr())) : 0;
      var R = retrievability(elapsed, card.stability);
      D = nextDifficulty(card.difficulty, g);
      S = (g === 1)
        ? Math.max(0.1, Math.min(nextStabilityForget(card.difficulty, card.stability, R), card.stability))
        : nextStabilityRecall(card.difficulty, card.stability, R, g);
    }
    var ivl = intervalForRetention(S, ret);
    // „Nochmal" wird immer in derselben Sitzung wiederholt.
    var requeue = (g === 1) || ivl < 1;
    var days = Math.max(1, Math.round(ivl));
    return { S: round2(S), D: round2(D), days: days, requeue: requeue,
      due: requeue ? todayStr() : addDays(todayStr(), days) };
  }

  // Intervall menschenlesbar machen.
  function fmtInterval(days) {
    if (days < 1) return 'gleich';
    if (days === 1) return '1 Tag';
    if (days < 30) return days + ' Tage';
    if (days < 365) return Math.round(days / 30) + ' Mon.';
    return (Math.round(days / 36.5) / 10).toString().replace('.', ',') + ' J.';
  }

  // Zähler pro Stapel: fällige Wiederholungen + heute erlaubte neue Karten.
  function deckStats(deck) {
    var today = todayStr();
    var reviews = deck.cards.filter(function (c) { return c.state !== 'new' && (c.due || today) <= today; }).length;
    var newAvail = deck.cards.filter(function (c) { return c.state === 'new'; }).length;
    var newToday = Math.min(newAvail, deck.newPerDay || 0);
    return { reviews: reviews, newAvail: newAvail, newToday: newToday, todayTotal: reviews + newToday, total: deck.cards.length };
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Lernpensum bis zur Deadline berechnen.
  function planSummary(deck) {
    var st = deckStats(deck);
    var parts = [];
    parts.push('<strong>' + st.newAvail + '</strong> neue Karte' + (st.newAvail === 1 ? '' : 'n') + ' übrig · ' +
      '<strong>' + st.reviews + '</strong> Wiederholung' + (st.reviews === 1 ? '' : 'en') + ' heute fällig.');
    if (deck.deadline) {
      var daysLeft = diffDays(todayStr(), deck.deadline);
      if (daysLeft < 0) {
        parts.push('<span class="plan-warn">Der Prüfungstermin liegt in der Vergangenheit.</span>');
      } else if (st.newAvail === 0) {
        parts.push('Alle Karten sind eingeführt — noch <strong>' + daysLeft + '</strong> Tage bis zur Prüfung.');
      } else {
        var recommended = Math.ceil(st.newAvail / Math.max(1, daysLeft));
        var finishIn = Math.ceil(st.newAvail / Math.max(1, deck.newPerDay || 1));
        var onTrack = (deck.newPerDay || 0) >= recommended;
        parts.push('Noch <strong>' + daysLeft + '</strong> Tage. Um alle neuen Karten rechtzeitig einzuführen: ' +
          'mind. <strong>' + recommended + '</strong> neue/Tag. ' +
          'Bei ' + (deck.newPerDay || 0) + '/Tag bist du in <strong>' + finishIn + '</strong> Tagen durch — ' +
          (onTrack ? '<span class="plan-ok">rechtzeitig ✓</span>' : '<span class="plan-warn">zu langsam ⚠ Tempo erhöhen</span>') + '.');
      }
    } else {
      parts.push('<span class="plan-muted">Trage einen Prüfungstermin ein, um dein Lernpensum zu berechnen.</span>');
    }
    return parts.join(' ');
  }

  function renderDecks() {
    var wrap = document.getElementById('deckList');
    if (!wrap) return;
    if (!data.decks.length) {
      wrap.innerHTML = '<p class="empty-note">Noch keine Stapel. Lege oben deinen ersten an.</p>';
      return;
    }
    wrap.innerHTML = data.decks.map(function (d) {
      var st = deckStats(d);
      var cardsHtml = d.cards.map(function (c) {
        var tag = c.state === 'new' ? '<span class="fc-tag fc-tag-new">neu</span>'
          : '<span class="fc-tag" title="fällig ' + esc(c.due || '') + '">' + fmtInterval(diffDays(todayStr(), c.due || todayStr())) + '</span>';
        return '<div class="fc-row">' +
          '<span class="fc-q"><strong>' + esc(c.front) + '</strong><small>' + esc(c.back) + '</small></span>' +
          tag +
          '<button class="icon-btn" data-del-card="' + d.id + '|' + c.id + '" title="Karte löschen">✕</button></div>';
      }).join('');
      var meta = st.total + ' Karte' + (st.total === 1 ? '' : 'n') +
        (st.reviews ? ' · <span class="deck-due">' + st.reviews + ' fällig</span>' : '') +
        (st.newToday ? ' · <span class="deck-new">' + st.newToday + ' neu</span>' : '');
      return '<div class="deck">' +
        '<div class="deck-head">' +
          '<div class="deck-title"><h3>' + esc(d.name) + '</h3><span class="deck-meta">' + meta + '</span></div>' +
          '<div class="deck-btns">' +
            '<button class="btn btn-primary btn-sm" data-study="' + d.id + '"' + (st.todayTotal ? '' : ' disabled') + '>Lernen' + (st.todayTotal ? ' (' + st.todayTotal + ')' : '') + '</button>' +
            '<button class="btn btn-ghost btn-sm" data-toggle-plan="' + d.id + '">Plan</button>' +
            '<button class="btn btn-ghost btn-sm" data-toggle-cards="' + d.id + '">Karten</button>' +
            '<button class="icon-btn" data-del-deck="' + d.id + '" title="Stapel löschen">🗑</button>' +
          '</div>' +
        '</div>' +
        // Plan & Einstellungen
        '<div class="deck-plan" id="deckPlan-' + d.id + '" hidden>' +
          '<div class="plan-controls">' +
            '<label>Prüfungstermin<input type="date" data-deadline="' + d.id + '" value="' + esc(d.deadline || '') + '" /></label>' +
            '<label>Neue Karten / Tag<input type="number" min="0" max="200" data-newperday="' + d.id + '" value="' + (d.newPerDay || 0) + '" /></label>' +
            '<label>Ziel-Merkrate<span class="ret-line"><input type="range" min="80" max="97" step="1" data-retention="' + d.id + '" value="' + Math.round((d.retention || 0.9) * 100) + '" /><span class="ret-val" id="retVal-' + d.id + '">' + Math.round((d.retention || 0.9) * 100) + ' %</span></span></label>' +
          '</div>' +
          '<p class="plan-summary" id="planSummary-' + d.id + '">' + planSummary(d) + '</p>' +
          '<p class="plan-hint">Höhere Merkrate = kürzere Abstände & mehr Wiederholungen (sicherer). Niedrigere = weniger Aufwand, aber du vergisst öfter.</p>' +
        '</div>' +
        // Karten
        '<div class="deck-cards" id="deckCards-' + d.id + '" hidden>' +
          '<form class="fc-add" data-add-card="' + d.id + '">' +
            '<input type="text" name="front" placeholder="Vorderseite (Frage)" required />' +
            '<input type="text" name="back" placeholder="Rückseite (Antwort)" required />' +
            '<button type="submit" class="btn btn-ghost btn-sm">+ Karte</button>' +
          '</form>' +
          (st.total ? cardsHtml : '<p class="empty-note">Noch keine Karten in diesem Stapel.</p>') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function refreshPlanSummary(deckId) {
    var deck = data.decks.filter(function (d) { return d.id === deckId; })[0];
    var el = document.getElementById('planSummary-' + deckId);
    if (deck && el) el.innerHTML = planSummary(deck);
  }

  function wireDecks() {
    var deckForm = document.getElementById('deckForm');
    if (!deckForm) return;

    deckForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = val('deckName').trim();
      if (!name) return;
      var res = await sb.from('decks').insert({ name: name })
        .select('id,name,deadline,retention,new_per_day').single();
      if (res.error) return dbError('den Stapel', res.error);
      var r = res.data;
      data.decks.push({ id: r.id, name: r.name, cards: [], deadline: r.deadline || '', retention: r.retention || 0.9, newPerDay: (r.new_per_day == null ? 10 : r.new_per_day) });
      deckForm.reset(); renderDecks(); updateOverview();
    });

    var wrap = document.getElementById('deckList');

    // Karte hinzufügen
    wrap.addEventListener('submit', async function (e) {
      var form = e.target.closest('[data-add-card]');
      if (!form) return;
      e.preventDefault();
      var deckId = form.dataset.addCard;
      var front = form.front.value.trim();
      var back = form.back.value.trim();
      if (!front || !back) return;
      var res = await sb.from('cards')
        .insert({ deck_id: deckId, front: front, back: back })
        .select('id,front,back,state,difficulty,stability,due,last_review,reps,lapses').single();
      if (res.error) return dbError('die Karte', res.error);
      var deck = data.decks.filter(function (d) { return d.id === deckId; })[0];
      if (deck) {
        var c = res.data;
        deck.cards.push({ id: c.id, front: c.front, back: c.back, state: c.state || 'new',
          difficulty: c.difficulty || 0, stability: c.stability || 0, due: c.due, last_review: c.last_review, reps: c.reps || 0, lapses: c.lapses || 0 });
        renderDecks(); updateOverview();
        var open = document.getElementById('deckCards-' + deckId);
        if (open) { open.hidden = false; var fi = open.querySelector('input[name=front]'); if (fi) fi.focus(); }
      }
    });

    // Plan-Einstellungen ändern (live Vorschau + speichern)
    wrap.addEventListener('input', function (e) {
      var ret = e.target.closest('[data-retention]');
      if (ret) {
        var lbl = document.getElementById('retVal-' + ret.dataset.retention);
        if (lbl) lbl.textContent = ret.value + ' %';
      }
    });
    wrap.addEventListener('change', async function (e) {
      var dl = e.target.closest('[data-deadline]');
      var np = e.target.closest('[data-newperday]');
      var rt = e.target.closest('[data-retention]');
      var target = dl || np || rt;
      if (!target) return;
      var deckId = target.dataset.deadline || target.dataset.newperday || target.dataset.retention;
      var deck = data.decks.filter(function (d) { return d.id === deckId; })[0];
      if (!deck) return;
      var patch = {};
      if (dl) { deck.deadline = dl.value || ''; patch.deadline = dl.value || null; }
      if (np) { deck.newPerDay = Math.max(0, parseInt(np.value, 10) || 0); patch.new_per_day = deck.newPerDay; }
      if (rt) { deck.retention = (parseInt(rt.value, 10) || 90) / 100; patch.retention = deck.retention; }
      refreshPlanSummary(deckId);
      // Zähler auf der Stapel-Kopfzeile aktualisieren (neue Karten/Tag kann sich ändern).
      var head = document.querySelector('[data-study="' + deckId + '"]');
      if (head) {
        var st = deckStats(deck);
        head.disabled = !st.todayTotal;
        head.textContent = 'Lernen' + (st.todayTotal ? ' (' + st.todayTotal + ')' : '');
      }
      updateOverview();
      var res = await sb.from('decks').update(patch).eq('id', deckId);
      if (res.error) dbError('die Einstellungen', res.error);
    });

    // Buttons: Lernen / Plan / Karten / löschen
    wrap.addEventListener('click', async function (e) {
      var studyBtn = e.target.closest('[data-study]');
      var togglePlan = e.target.closest('[data-toggle-plan]');
      var toggle = e.target.closest('[data-toggle-cards]');
      var delCard = e.target.closest('[data-del-card]');
      var delDeck = e.target.closest('[data-del-deck]');

      if (studyBtn) {
        startStudy(studyBtn.dataset.study);
      } else if (togglePlan) {
        var pbox = document.getElementById('deckPlan-' + togglePlan.dataset.togglePlan);
        if (pbox) pbox.hidden = !pbox.hidden;
      } else if (toggle) {
        var box = document.getElementById('deckCards-' + toggle.dataset.toggleCards);
        if (box) box.hidden = !box.hidden;
      } else if (delCard) {
        var ids = delCard.dataset.delCard.split('|');
        var res = await sb.from('cards').delete().eq('id', ids[1]);
        if (res.error) return dbError('die Karte', res.error);
        var deck = data.decks.filter(function (d) { return d.id === ids[0]; })[0];
        if (deck) { deck.cards = deck.cards.filter(function (c) { return c.id !== ids[1]; }); }
        renderDecks(); updateOverview();
      } else if (delDeck) {
        var deckId = delDeck.dataset.delDeck;
        var deck2 = data.decks.filter(function (d) { return d.id === deckId; })[0];
        var label = deck2 ? deck2.name : 'diesen Stapel';
        if (!confirm('Stapel „' + label + '" mit allen Karten löschen?')) return;
        var res2 = await sb.from('decks').delete().eq('id', deckId);
        if (res2.error) return dbError('den Stapel', res2.error);
        data.decks = data.decks.filter(function (d) { return d.id !== deckId; });
        renderDecks(); updateOverview();
      }
    });

    wireStudy();
  }

  // ---------- Lern-Modus mit FSRS ----------
  var study = { deckId: null, queue: [], current: null, done: 0 };

  function currentDeck() { return data.decks.filter(function (d) { return d.id === study.deckId; })[0]; }

  function startStudy(deckId) {
    var deck = data.decks.filter(function (d) { return d.id === deckId; })[0];
    if (!deck) return;
    var today = todayStr();
    study.deckId = deckId;
    study.done = 0;
    var dueReviews = deck.cards.filter(function (c) { return c.state !== 'new' && (c.due || today) <= today; });
    var newCards = deck.cards.filter(function (c) { return c.state === 'new'; }).slice(0, deck.newPerDay || 0);
    // Neue Karten unter die Wiederholungen mischen (etwas Interleaving im Stapel).
    study.queue = shuffle(dueReviews.concat(newCards));
    study.current = null;
    document.getElementById('studyDone').hidden = true;
    document.getElementById('studyOverlay').hidden = false;
    document.body.classList.add('modal-open');
    nextCard();
  }

  function closeStudy() {
    document.getElementById('studyOverlay').hidden = true;
    document.body.classList.remove('modal-open');
    study.deckId = null; study.queue = []; study.current = null;
    renderDecks(); updateOverview();
  }

  function nextCard() {
    var box = document.getElementById('flashcard');
    var actions = document.querySelector('.study-actions');
    if (!study.queue.length) {
      study.current = null;
      box.parentElement.hidden = true;
      actions.hidden = true;
      document.getElementById('studyProgress').textContent = 'fertig';
      document.getElementById('studyDone').hidden = false;
      return;
    }
    box.parentElement.hidden = false;
    actions.hidden = false;
    study.current = study.queue.shift();
    document.getElementById('fcFront').innerHTML = esc(study.current.front);
    document.getElementById('fcBack').innerHTML = esc(study.current.back);
    document.getElementById('fcBack').hidden = true;
    document.getElementById('fcDivider').hidden = true;
    document.getElementById('fcShow').hidden = false;
    document.getElementById('fcRate').hidden = true;
    document.getElementById('fcExplain').hidden = true;
    document.getElementById('studyProgress').textContent = (study.queue.length + 1) + ' übrig' +
      (study.done ? ' · ' + study.done + ' gelernt' : '');
  }

  function revealAnswer() {
    document.getElementById('fcBack').hidden = false;
    document.getElementById('fcDivider').hidden = false;
    document.getElementById('fcShow').hidden = true;
    document.getElementById('fcRate').hidden = false;
    // Transparenz: für jede Bewertung das resultierende Intervall anzeigen.
    var deck = currentDeck(), card = study.current;
    if (deck && card) {
      var map = { again: 1, hard: 2, good: 3, easy: 4 };
      Object.keys(map).forEach(function (k) {
        var r = fsrsCompute(card, deck, map[k]);
        var el = document.querySelector('[data-ivl="' + k + '"]');
        if (el) el.textContent = (k === 'again') ? 'gleich' : fmtInterval(r.requeue ? 0 : r.days);
      });
      var ex = document.getElementById('fcExplain');
      ex.textContent = 'Der Zeitpunkt zeigt, wann die Karte wieder abgefragt wird. ' +
        '„Nochmal" = vergessen (kommt gleich noch mal) · „Gut" = gewusst. Ziel-Merkrate: ' +
        Math.round((deck.retention || 0.9) * 100) + ' %.';
      ex.hidden = false;
    }
  }

  async function rateCard(rating) {
    var card = study.current;
    var deck = currentDeck();
    if (!card || !deck) return;
    var g = { again: 1, hard: 2, good: 3, easy: 4 }[rating];
    var r = fsrsCompute(card, deck, g);
    card.difficulty = r.D;
    card.stability = r.S;
    card.state = 'review';
    card.reps = (card.reps || 0) + 1;
    card.last_review = todayStr();
    if (g === 1) card.lapses = (card.lapses || 0) + 1;
    card.due = r.due;
    study.done++;
    if (r.requeue) study.queue.push(card); // in dieser Sitzung erneut zeigen
    nextCard();
    var res = await sb.from('cards').update({
      state: card.state, difficulty: card.difficulty, stability: card.stability,
      due: card.due, last_review: card.last_review, reps: card.reps, lapses: card.lapses
    }).eq('id', card.id);
    if (res.error) console.error('Karten-Fortschritt speichern', res.error);
  }

  function wireStudy() {
    var overlay = document.getElementById('studyOverlay');
    if (!overlay) return;
    document.getElementById('fcShow').addEventListener('click', revealAnswer);
    document.getElementById('studyClose').addEventListener('click', closeStudy);
    document.getElementById('studyFinish').addEventListener('click', closeStudy);
    document.getElementById('fcRate').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rate]');
      if (b) rateCard(b.dataset.rate);
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeStudy(); });
    // Tastatur: Leertaste = Antwort zeigen, 1–4 = bewerten, Esc = schließen.
    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') { closeStudy(); return; }
      var rating = document.getElementById('fcRate');
      if (!rating.hidden) {
        if (e.key === '1') rateCard('again');
        else if (e.key === '2') rateCard('hard');
        else if (e.key === '3') rateCard('good');
        else if (e.key === '4') rateCard('easy');
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (!document.getElementById('fcShow').hidden) { e.preventDefault(); revealAnswer(); }
      }
    });
  }

  // =====================================================================
  // DOKUMENTE
  // =====================================================================
  var MAX_DOC = 25 * 1024 * 1024; // 25 MB

  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function extIco(name) {
    var ext = (name.split('.').pop() || '').toUpperCase().slice(0, 4);
    return ext || '•';
  }
  function safeName(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  }
  function renderDocs() {
    var list = document.getElementById('docList');
    if (!list) return;
    if (!data.docs.length) { list.innerHTML = '<p class="empty-note">Noch keine Dokumente.</p>'; return; }
    list.innerHTML = data.docs.map(function (d) {
      var when = new Date(d.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
      return '<div class="row-item"><span class="d-ico">' + esc(extIco(d.name)) + '</span>' +
        '<span class="d-meta"><strong>' + esc(d.name) + '</strong>' +
        '<small>' + fmtSize(d.size) + ' · ' + when + '</small></span>' +
        '<a class="d-dl" href="#" data-dl-doc="' + d.id + '">Download</a>' +
        '<button class="icon-btn" data-del-doc="' + d.id + '" title="Löschen">✕</button></div>';
    }).join('');
  }

  function wireDocs() {
    var fileInput = document.getElementById('fileInput');
    var dropzone = document.getElementById('dropzone');
    if (!fileInput || !dropzone) return;

    async function addFiles(files) {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (file.size > MAX_DOC) {
          alert('„' + file.name + '" ist größer als 25 MB und kann nicht hochgeladen werden.');
          continue;
        }
        var path = user.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + safeName(file.name);
        var up = await sb.storage.from('documents').upload(path, file, {
          contentType: file.type || 'application/octet-stream', upsert: false
        });
        if (up.error) { dbError('die Datei', up.error); continue; }
        var res = await sb.from('docs').insert({
          name: file.name, size: file.size, type: file.type, storage_path: path
        }).select('id,name,size,type,storage_path,created_at').single();
        if (res.error) {
          await sb.storage.from('documents').remove([path]); // Upload zurückrollen
          dbError('die Datei', res.error); continue;
        }
        data.docs.unshift({
          id: res.data.id, name: res.data.name, size: res.data.size,
          type: res.data.type, date: res.data.created_at, path: res.data.storage_path
        });
        renderDocs(); updateOverview();
      }
    }

    fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('drag'); });
    });
    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    document.getElementById('docList').addEventListener('click', async function (e) {
      var dl = e.target.closest('[data-dl-doc]');
      var del = e.target.closest('[data-del-doc]');
      if (dl) {
        e.preventDefault();
        var doc = data.docs.filter(function (d) { return d.id === dl.dataset.dlDoc; })[0];
        if (!doc) return;
        var s = await sb.storage.from('documents').createSignedUrl(doc.path, 120, { download: doc.name });
        if (s.error) return dbError('den Download', s.error);
        window.open(s.data.signedUrl, '_blank');
      } else if (del) {
        var d2 = data.docs.filter(function (d) { return d.id === del.dataset.delDoc; })[0];
        if (!d2) return;
        await sb.storage.from('documents').remove([d2.path]);
        var res = await sb.from('docs').delete().eq('id', d2.id);
        if (res.error) return dbError('das Dokument', res.error);
        data.docs = data.docs.filter(function (d) { return d.id !== d2.id; });
        renderDocs(); updateOverview();
      }
    });

    var shared = document.getElementById('sharedMaterials');
    if (shared) shared.addEventListener('click', async function (e) {
      var dl = e.target.closest('[data-dl-material]');
      if (!dl) return;
      e.preventDefault();
      var m = (data.materials || []).filter(function (x) { return x.id === dl.dataset.dlMaterial; })[0];
      if (!m) return;
      var s = await sb.storage.from('materials').createSignedUrl(m.path, 120, { download: m.name });
      if (s.error) return dbError('den Download', s.error);
      window.open(s.data.signedUrl, '_blank');
    });
  }

  // =====================================================================
  // NACHRICHTEN (Chat mit Tutor + Lerngruppen)
  // =====================================================================
  function initChat(uid) {
    var convList = document.getElementById('convList');
    var pick = document.getElementById('convPick');
    var threadWrap = document.getElementById('convThreadWrap');
    var thread = document.getElementById('chatThread');
    var form = document.getElementById('chatForm');
    if (!convList || !thread || !form) return;

    var channel = null;

    document.getElementById('convBack').addEventListener('click', function () {
      threadWrap.hidden = true; pick.hidden = false;
      if (channel) { sb.removeChannel(channel); channel = null; }
    });

    convList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-conv-kind]');
      if (row) openConv(row.dataset.convKind, row.dataset.convId, row.dataset.convName);
    });

    function openConv(kind, id, name) {
      var col = kind === 'group' ? 'group_id' : 'student_id';
      pick.hidden = true; threadWrap.hidden = false;
      document.getElementById('convTitle').textContent = name || '';
      var seen = {};
      thread.innerHTML = '<p class="empty-note">Lädt …</p>';

      function add(m) {
        if (seen[m.id]) return; seen[m.id] = true;
        var mine = m.sender_id === uid;
        var time = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        var el = document.createElement('div');
        el.className = 'msg ' + (mine ? 'me' : 'them');
        el.innerHTML = (mine ? '' : '<span class="msg-from">' + esc(m.sender_name || 'Tutor') + '</span>') +
          '<div class="bubble">' + esc(m.body) + '</div><span class="msg-meta">' + esc(time) + '</span>';
        thread.appendChild(el);
      }
      function clearEmpty() { var n = thread.querySelector('.empty-note'); if (n) thread.innerHTML = ''; }
      function scrollDown() { thread.scrollTop = thread.scrollHeight; }

      (async function () {
        var res = await sb.from('messages').select('id,sender_id,sender_name,body,created_at')
          .eq(col, id).order('created_at', { ascending: true });
        thread.innerHTML = '';
        var rows = res.data || [];
        if (!rows.length) thread.innerHTML = '<p class="empty-note">Noch keine Nachrichten. Schreib die erste!</p>';
        else rows.forEach(add);
        scrollDown();
      })();

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

      if (channel) { sb.removeChannel(channel); channel = null; }
      channel = sb.channel('chat-' + kind + '-' + id)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: col + '=eq.' + id },
          function (payload) { clearEmpty(); add(payload.new); scrollDown(); })
        .subscribe();
    }

    (async function () {
      var convs = [{ kind: 'student', id: uid, name: 'Mein Tutor' }];
      var gRes = await sb.from('groups').select('id,name').order('name', { ascending: true });
      (gRes.data || []).forEach(function (g) { convs.push({ kind: 'group', id: g.id, name: g.name }); });
      convList.innerHTML = convs.map(function (c) {
        return '<div class="row-item" data-conv-kind="' + c.kind + '" data-conv-id="' + esc(c.id) +
          '" data-conv-name="' + esc(c.name) + '" style="cursor:pointer">' +
          '<span class="grow">' + (c.kind === 'group' ? '⬡ ' : '✉ ') + esc(c.name) + '</span>' +
          '<span style="color:var(--muted)">›</span></div>';
      }).join('');
    })();
  }

  // =====================================================================
  // BENACHRICHTIGUNGEN (Glocke)
  // =====================================================================
  var notifs = [];
  var notifChannel = null;
  var notifUid = null;

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

  async function loadNotifications(uid) {
    notifUid = uid;
    var res = await sb.from('notifications')
      .select('id,type,title,body,read,created_at')
      .order('created_at', { ascending: false }).limit(30);
    notifs = res.error ? [] : (res.data || []);
    renderNotifs();

    if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
    notifChannel = sb.channel('notif-' + uid)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + uid },
        async function (payload) {
          notifs.unshift(payload.new);
          if (notifs.length > 30) notifs.pop();
          renderNotifs();
          // Termine könnten sich geändert haben (z. B. Tutor hat angenommen)
          await loadAll();
          renderCalendar(); renderTermine(); renderProposals(); renderCancelled(); updateOverview();
        })
      .subscribe();
  }

  function renderNotifs() {
    var list = document.getElementById('notifList');
    var count = document.getElementById('notifCount');
    var unread = notifs.filter(function (n) { return !n.read; }).length;
    if (count) { count.textContent = unread; count.hidden = unread === 0; }
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
    if (!unread.length || !notifUid) return;
    notifs.forEach(function (n) { n.read = true; });
    renderNotifs();
    await sb.from('notifications').update({ read: true }).eq('user_id', notifUid).eq('read', false);
  }
})();
