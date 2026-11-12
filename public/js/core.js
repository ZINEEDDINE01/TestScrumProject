// Noyau : gabarits sûrs (échappement automatique), API, modales, actions déléguées.
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
export const h = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ''), ''));

export const state = { user: null, refs: null };
export const $ = (sel, root = document) => root.querySelector(sel);

export async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : (method === 'GET' ? {} : { 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : (method === 'GET' ? undefined : '{}') });
  let data = null; try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) { const e = new Error(data?.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

export const fmtDate = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
export const fmtDt = (s) => (s ? fmtDate(s) + ' ' + s.slice(11, 16) : '—');
export const num = (n, d = 0) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n));
export const pctf = (n, d = 1) => (n === null || n === undefined ? '—' : num(n, d) + ' %');
export const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const STATUTS = {
  en_attente_chef: ['Avis du chef attendu', 'warn'], en_attente_drh: ['Validation DRH attendue', 'warn'], valide: ['Validé', 'ok'], rejete: ['Rejeté', 'ko'], annule: ['Annulé', 'muted'],
  aucune: ['Non justifiée', 'ko'], soumise: ['Justificatif à examiner', 'warn'], validee: ['Justifiée', 'ok'], rejetee: ['Justification rejetée', 'ko'],
  propose: ['À décider', 'warn'], en_attente: ['À signer', 'warn'], signee: ['Signé', 'ok'],
  planifiee: ['Planifiée', 'info'], en_cours: ['En cours', 'ok'], terminee: ['Terminée', 'muted'], annulee: ['Annulée', 'muted'],
  convoque: ['Convoqué(e)', 'warn'], confirme: ['Présence confirmée', 'ok'], decline: ['Désistement', 'ko'], present: ['Présent(e)', 'ok'], absent: ['Absent(e)', 'ko'],
  candidature: ['Candidature', 'info'], emise: ['Offre émise', 'warn'], acceptee: ['Acceptée', 'ok'], refusee: ['Refusée', 'ko'],
};
const ICON = { ok: '✔', warn: '▲', ko: '✖', info: 'ℹ', muted: '•' };
export const badge = (s) => { const [l, k] = STATUTS[s] || [s, 'muted']; return h`<span class="badge ${k}"><span aria-hidden="true">${ICON[k]}</span> ${l}</span>`; };
export const TYPES_CONGE = { annuel: 'Congé annuel', exceptionnel: 'Congé exceptionnel', pelerinage: 'Pèlerinage' };

export function toast(msg, kind = 'ok') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
}

// Actions et formulaires délégués (pas de handlers inline : compatible CSP).
export const actions = {}; export const forms = {};
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  e.preventDefault(); try { await fn(el, e); } catch (err) { toast(err.message, 'ko'); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
  const fn = forms[f.dataset.form]; if (!fn) return;
  const data = Object.fromEntries([...new FormData(f)].filter(([, v]) => v !== ''));
  const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try { await fn(data, f); } catch (err) { toast(err.message, 'ko'); } finally { if (btn) btn.disabled = false; }
});

export function modal(title, body, { wide = false } = {}) {
  closeModal();
  const d = document.createElement('div'); d.className = 'overlay'; d.id = 'modal';
  d.innerHTML = String(h`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}"><div class="modal-h"><h2>${title}</h2><button class="icon-btn" data-act="close-modal" aria-label="Fermer">✕</button></div><div class="modal-b">${body}</div></div>`);
  document.body.appendChild(d); d.querySelector('input,select,textarea,button.primary')?.focus();
}
export const closeModal = () => document.getElementById('modal')?.remove();
actions['close-modal'] = closeModal;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

export const field = (label, name, { type = 'text', value = '', required = false, options = null, attrs = '', hint = '' } = {}) => {
  const input = options
    ? h`<select name="${name}" ${raw(required ? 'required' : '')}>${raw('<option value=""></option>')}${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h`<option value="${v}" ${raw(String(v) === String(value) ? 'selected' : '')}>${l}</option>`; })}</select>`
    : type === 'textarea' ? h`<textarea name="${name}" rows="3" ${raw(required ? 'required' : '')}>${value}</textarea>`
      : h`<input type="${type}" name="${name}" value="${value}" ${raw(required ? 'required' : '')} ${raw(attrs)}>`;
  return h`<label class="field"><span>${label}${required ? raw(' <abbr title="obligatoire">*</abbr>') : ''}</span>${input}${hint ? h`<small>${hint}</small>` : ''}</label>`;
};

// Sélecteur de fonctionnaire avec recherche
export function empPicker(name = 'employee_id') {
  return h`<div class="picker" data-picker><label class="field"><span>Fonctionnaire</span><input type="search" data-pick-q placeholder="Nom, prénom ou PPR…" autocomplete="off"></label><input type="hidden" name="${name}"><div class="pick-res" data-pick-res></div><div class="pick-sel" data-pick-sel></div></div>`;
}
let pickTimer;
document.addEventListener('input', (e) => {
  const inp = e.target.closest('[data-pick-q]'); if (!inp) return; const box = inp.closest('[data-picker]'); clearTimeout(pickTimer);
  pickTimer = setTimeout(async () => {
    const q = inp.value.trim(); const res = box.querySelector('[data-pick-res]'); if (q.length < 2) { res.innerHTML = ''; return; }
    try { const r = await api('/employees?limit=8&q=' + encodeURIComponent(q)); res.innerHTML = String(h`<ul>${r.items.map((x) => h`<li><button type="button" data-act="pick" data-id="${x.id}" data-label="${x.prenom} ${x.nom} — PPR ${x.ppr}">${x.prenom} ${x.nom} <small>PPR ${x.ppr} · ${x.service}</small></button></li>`)}</ul>`); } catch { /* ignore */ }
  }, 250);
});
actions.pick = (el) => { const box = el.closest('[data-picker]'); box.querySelector('input[type=hidden]').value = el.dataset.id; box.querySelector('[data-pick-sel]').textContent = '✔ ' + el.dataset.label; box.querySelector('[data-pick-res]').innerHTML = ''; };

export const confirmBox = (msg) => window.confirm(msg);
export const download = (name, text, type = 'text/csv') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

export const refresh = () => document.dispatchEvent(new Event('app:refresh'));
// Modale de décision avec commentaire optionnel/obligatoire
export function decisionModal({ title, label = 'Commentaire', required = false, submit = 'Confirmer', onSubmit }) {
  forms['decision'] = async (d) => { await onSubmit(d); closeModal(); refresh(); };
  modal(title, h`<form data-form="decision">${field(label, 'commentaire', { type: 'textarea', required })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">${submit}</button></div></form>`);
}
