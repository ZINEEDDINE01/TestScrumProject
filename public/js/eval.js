// Évaluation annuelle : saisie par le chef (N+1), validation par la DRH.
import { h, raw, api, state, actions, forms, field, modal, closeModal, refresh, toast, badge, num, decisionModal } from './core.js';

let tab = 'manquantes';
const isHr = () => state.user.role === 'drh';
export async function evaluations(root) {
  const annee = Number(state.today.slice(0, 4));
  const [manq, all] = await Promise.all([api('/evaluations/manquantes'), api('/evaluations?annee=' + annee)]);
  const aValider = all.filter((v) => v.statut === 'saisie'); const aRevoir = all.filter((v) => v.statut === 'a_revoir');
  const tabs = [['manquantes', `À saisir (${manq.length})`], ...(isHr() ? [['valider', `À valider (${aValider.length})`]] : [['revoir', `À revoir (${aRevoir.length})`]]), ['toutes', `Évaluations ${annee} (${all.length})`]];
  const rows = tab === 'valider' ? aValider : tab === 'revoir' ? aRevoir : all;
  root.innerHTML = String(h`<div class="page-h"><div><h1>Évaluation annuelle ${annee}</h1><p class="muted">Circuit : DRH (éligibilité) → chef (note annuelle) → DRH (validation). Une note validée est requise pour valider un avancement de grade.</p></div></div>
  <div class="tabs">${tabs.map(([k, l]) => h`<button class="tab ${tab === k ? 'on' : ''}" data-act="ev-tab" data-k="${k}">${l}</button>`)}</div>
  <div class="card"><div class="tscroll">${tab === 'manquantes' ? h`<table class="t"><thead><tr><th>Fonctionnaire</th><th>Corps · grade</th><th>Service</th><th></th></tr></thead><tbody>${manq.map((x) => h`<tr><td><a href="#/fonctionnaires/${x.id}">${x.prenom} ${x.nom}</a>${x.grade_propose ? h` <span class="badge warn">▲ avancement de grade en attente</span>` : ''}</td><td>${x.corps} · ${x.grade}</td><td>${x.service}</td><td><button class="mini ok" data-act="ev-new" data-id="${x.id}" data-n="${x.prenom} ${x.nom}">Noter</button></td></tr>`)}${manq.length ? '' : h`<tr><td colspan="4" class="muted">Tous les fonctionnaires de votre périmètre sont évalués.</td></tr>`}</tbody></table>`
    : h`<table class="t"><thead><tr><th>Fonctionnaire</th><th>Note</th><th>Objectifs</th><th>Appréciation</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map((v) => h`<tr><td><a href="#/fonctionnaires/${v.employee_id}">${v.prenom} ${v.nom}</a><br><small class="muted">${v.service}</small></td><td><b>${v.note}</b> / 20</td><td>${num(v.objectifs_pct)} %</td><td>${v.appreciation || '—'}<br><small class="muted">${v.saisi_par || ''}</small></td><td>${badge('ev_' + v.statut)}${v.commentaire_drh ? h`<br><small class="muted">DRH : ${v.commentaire_drh}</small>` : ''}</td>
    <td class="nowrap">${isHr() && v.statut === 'saisie' ? h`<button class="mini ok" data-act="ev-dec" data-id="${v.id}" data-a="valider">Valider</button><button class="mini ko" data-act="ev-dec" data-id="${v.id}" data-a="renvoyer">Renvoyer</button>` : ''}${v.statut === 'a_revoir' ? h`<button class="mini" data-act="ev-new" data-id="${v.employee_id}" data-n="${v.prenom} ${v.nom}" data-note="${v.note}" data-obj="${v.objectifs_pct}" data-app="${v.appreciation || ''}">Corriger</button>` : ''}</td></tr>`)}${rows.length ? '' : h`<tr><td colspan="6" class="muted">Rien à afficher.</td></tr>`}</tbody></table>`}</div></div>`);
}
actions['ev-tab'] = (el) => { tab = el.dataset.k; refresh(); };
actions['ev-new'] = (el) => {
  forms['ev-new'] = async (d) => { await api('/evaluations', 'POST', { ...d, employee_id: Number(el.dataset.id) }); closeModal(); toast('Évaluation enregistrée'); refresh(); };
  modal(`Évaluation — ${el.dataset.n}`, h`<form data-form="ev-new">${field('Note annuelle (sur 20)', 'note', { type: 'number', value: el.dataset.note || '', required: true, attrs: 'min="0" max="20" step="0.25"' })}${field('Objectifs réalisés (%)', 'objectifs_pct', { type: 'number', value: el.dataset.obj || '', required: true, attrs: 'min="0" max="100"' })}${field('Appréciation générale', 'appreciation', { type: 'textarea', value: el.dataset.app || '' })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`);
};
actions['ev-dec'] = (el) => {
  const a = el.dataset.a; const go = (c) => api(`/evaluations/${el.dataset.id}/decision`, 'POST', { action: a, commentaire: c });
  if (a === 'renvoyer') decisionModal({ title: 'Renvoyer au chef de service', label: 'Motif', required: true, submit: 'Renvoyer', onSubmit: (d) => go(d.commentaire) });
  else go().then(() => { toast('Évaluation validée'); refresh(); }).catch((e) => toast(e.message, 'ko'));
};
