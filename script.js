// Mobile-Menü öffnen / schließen
const toggle = document.querySelector('.nav-toggle');
const mobileNav = document.getElementById('mobile-nav');

if (toggle && mobileNav) {
  toggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Menü schließen' : 'Menü öffnen');
  });

  // Menü nach Klick auf einen Link schließen
  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Aktuelles Jahr im Footer
const yearEl = document.getElementById('year');
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

// Preis-Umschalter: Einzelunterricht <-> Kleingruppe
const priceToggle = document.getElementById('priceToggle');
if (priceToggle) {
  const modeDesc = document.getElementById('modeDesc');
  const texts = {
    einzel: '1:1 online — volle Aufmerksamkeit, ganz in deinem Tempo.',
    gruppe: 'Kleingruppe (2–4 Personen) — gemeinsam lernen, günstiger pro Person.',
  };
  priceToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      priceToggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      if (modeDesc) modeDesc.textContent = texts[mode];
      document.querySelectorAll('.per-person').forEach((el) => {
        el.style.display = mode === 'gruppe' ? 'inline' : 'none';
      });
      document.querySelectorAll('.amount').forEach((el) => {
        const val = el.dataset[mode];
        if (val) el.textContent = val;
      });
    });
  });
}

// Kontaktformular: öffnet das E-Mail-Programm mit vorausgefüllter Nachricht
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const to = contactForm.dataset.mailto || '';
    const get = (id) => (document.getElementById(id)?.value || '').trim();
    const name = get('name');
    const email = get('email');
    const modul = get('modul');
    const nachricht = get('nachricht');

    const subject = `Nachhilfe-Anfrage${modul ? ' — ' + modul : ''}`;
    const body =
      `Name: ${name}\n` +
      `E-Mail: ${email}\n` +
      (modul ? `Modul/Thema: ${modul}\n` : '') +
      `\n${nachricht}\n`;

    window.location.href =
      `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    const note = document.getElementById('formNote');
    if (note) note.textContent = 'Dein E-Mail-Programm sollte sich jetzt geöffnet haben.';
  });
}

// Header: „Anmelden" wird zu „Mein Bereich", wenn man eingeloggt ist
if (localStorage.getItem('studiumm_session')) {
  document.querySelectorAll('a[href="anmelden.html"]').forEach((a) => {
    a.setAttribute('href', 'dashboard.html');
    a.textContent = 'Mein Bereich';
  });
}
