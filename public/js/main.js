import { h, raw, api, state, actions, forms, $, toast, field } from './core.js';
import { dashboard } from './dashboard.js';
import { employees, employee, employeeNew, leaves, absences } from './people.js';
import { promotions, trainings, trainingDetail, recruitments, eservices, notifications } from './hr.js';

const NAV = {
  wali: [['dashboard', 'Tableau de bord', '📊']],
  drh: [['dashboard', 'Tableau de bord', '📊'], ['fonctionnaires', 'Fonctionnaires', '👥'], ['recrutements', 'Recrutements', '🧑‍💼'], ['conges', 'Congés', '🏖️'], ['absences', 'Absences', '🕒'], ['avancements', 'Avancements', '📈'], ['formations', 'Formation', '🎓'], ['eservices', 'E-services', '📄']],
  chef: [['fonctionnaires', 'Mon équipe', '👥'], ['conges', 'Congés', '🏖️'], ['absences', 'Absences', '🕒'], ['avancements', 'Avancements', '📈'], ['formations', 'Formation', '🎓'], ['eservices', 'E-services', '📄'], ['mon-dossier', 'Mon dossier', '🗂️']],
  fonctionnaire: [['mon-dossier', 'Mon dossier', '🗂️'], ['conges', 'Congés', '🏖️'], ['absences', 'Absences', '🕒'], ['avancements', 'Ma carrière', '📈'], ['formations', 'Formation', '🎓'], ['eservices', 'E-services', '📄']],
};
const ROLE_LABEL = { wali: 'Wali', drh: 'Division RH', chef: 'Chef de service', fonctionnaire: 'Fonctionnaire' };
const app = $('#app');

async function boot() {
  try { const me = await api('/me'); state.user = me; state.today = me.today; state.refs = await api('/refs'); shell(); render(); }
  catch { loginScreen(); }
}

function loginScreen(msg = '') {
  app.innerHTML = String(h`<main class="login"><div class="login-card"><div class="crest" aria-hidden="true">🇲🇦</div><p class="kicker">Royaume du Maroc · Ministère de l'Intérieur</p><h1>SIGRH</h1><p class="muted">Système intégré de gestion des ressources humaines<br>Wilaya de la Région Dakhla-Oued Ed-Dahab</p>
  <form data-form="login">${field('Identifiant', 'username', { required: true, attrs: 'autocomplete="username" autofocus' })}${field('Mot de passe', 'password', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}${msg ? h`<p class="err" role="alert">${msg}</p>` : ''}<button class="primary wide" type="submit">Se connecter</button></form>
  <details class="demo"><summary>Comptes de démonstration</summary><table class="t"><tbody><tr><td><code>wali</code></td><td>Monsieur le Wali (tableau de bord)</td></tr><tr><td><code>drh</code></td><td>Chef de la DRH (back-office)</td></tr><tr><td><code>chef</code></td><td>Chef de service</td></tr><tr><td><code>agent</code></td><td>Fonctionnaire</td></tr></tbody></table><p class="note">Mot de passe : <code>demo1234</code>. Données entièrement fictives.</p></details></div></main>`);
}
forms.login = async (d) => {
  try { await api('/login', 'POST', d); } catch (e) { loginScreen(e.message); return; }
  await boot(); if (state.user?.must_change) toast('Pensez à changer votre mot de passe (menu utilisateur).', 'warn');
};
actions.logout = async () => { await api('/logout', 'POST'); state.user = null; loginScreen(); };
actions.pwd = () => import('./core.js').then(({ modal, closeModal }) => {
  forms.pwd = async (d) => { await api('/password', 'POST', d); closeModal(); toast('Mot de passe modifié'); };
  modal('Changer le mot de passe', h`<form data-form="pwd">${field('Mot de passe actuel', 'ancien', { type: 'password', required: true })}${field('Nouveau mot de passe (8 caractères min.)', 'nouveau', { type: 'password', required: true, attrs: 'minlength="8"' })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Modifier</button></div></form>`);
});

function shell() {
  const u = state.user; const items = NAV[u.role];
  app.innerHTML = String(h`<div class="layout"><aside class="side"><div class="brand"><span aria-hidden="true">🇲🇦</span><div><b>SIGRH</b><small>Wilaya Dakhla-Oued Ed-Dahab</small></div></div>
  <nav aria-label="Navigation principale">${items.map(([k, l, i]) => h`<a href="#/${k}" data-nav="${k}"><span aria-hidden="true">${i}</span> ${l}</a>`)}</nav>
  <div class="me"><div><b>${u.nom_affichage}</b><small>${ROLE_LABEL[u.role]}</small></div><div class="row"><a class="btn mini ghost" href="#/notifications">🔔${u.unread ? h` <span id="badge-n" class="count">${u.unread}</span>` : ''}</a><button class="mini ghost" data-act="pwd">Mot de passe</button><button class="mini ghost" data-act="logout">Quitter</button></div></div></aside>
  <main class="main" id="view" tabindex="-1"></main></div>`);
}

const routes = [];
const on = (re, fn) => routes.push([re, fn]);
on(/^dashboard$/, (v) => dashboard(v));
on(/^fonctionnaires$/, (v) => employees(v));
on(/^fonctionnaires\/nouveau$/, (v, m, p) => employeeNew(v, p));
on(/^fonctionnaires\/(\d+)$/, (v, m) => employee(v, Number(m[1])));
on(/^mon-dossier$/, (v) => employee(v, state.user.employee_id));
on(/^conges$/, (v) => leaves(v));
on(/^absences$/, (v) => absences(v));
on(/^avancements$/, (v) => promotions(v));
on(/^formations$/, (v) => trainings(v));
on(/^formations\/(\d+)$/, (v, m) => trainingDetail(v, Number(m[1])));
on(/^recrutements$/, (v) => recruitments(v));
on(/^eservices$/, (v) => eservices(v));
on(/^notifications$/, (v) => notifications(v));

let seq = 0;
async function render() {
  if (!state.user) return; const view = $('#view'); if (!view) return;
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || '').split('?'); const home = NAV[state.user.role][0][0];
  const p = path || home; const my = ++seq;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', p === a.dataset.nav || p.startsWith(a.dataset.nav + '/')));
  const allowed = new Set(NAV[state.user.role].map((x) => x[0]).concat(['notifications', 'fonctionnaires']));
  const root = p.split('/')[0];
  try {
    if (!allowed.has(root) || (root === 'fonctionnaires' && !['drh', 'chef'].includes(state.user.role) && p !== '')) { location.hash = '#/' + home; return; }
    for (const [re, fn] of routes) { const m = re.exec(p); if (m) { view.innerHTML = '<p class="muted loading">Chargement…</p>'; const keepY = window.scrollY; await fn(view, m, new URLSearchParams(qs || '')); if (my === seq) window.scrollTo(0, keepY); return; } }
    view.innerHTML = '<p class="muted">Page introuvable.</p>';
  } catch (e) {
    if (e.status === 401) { state.user = null; loginScreen('Session expirée, veuillez vous reconnecter.'); return; }
    view.innerHTML = String(h`<div class="card"><h2>Erreur</h2><p>${e.message}</p><a class="btn" href="#/${home}">Retour</a></div>`);
  }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
document.addEventListener('app:refresh', render);
boot();
