// Copilote décisionnel : file priorisée de décisions, une par une, validation en 1 clic.
import { h, raw, api, actions, forms, field, modal, closeModal, refresh, toast, decisionModal, fmtDt } from './core.js';

let list = []; let idx = 0; let host = null; let history = null;
const BADGE = { haute: ['🔴', 'Priorité haute'], moyenne: ['🟡', 'Priorité moyenne'], optim: ['🟢', 'Optimisation'] };

export async function mountCopilot(el) {
  host = el; host.innerHTML = '<section class="copilot"><p class="muted">Analyse des données en cours…</p></section>';
  try { list = await api('/copilot/decisions'); history = null; idx = Math.min(idx, Math.max(0, list.length - 1)); draw(); }
  catch (e) { host.innerHTML = String(h`<section class="copilot"><p>Copilote indisponible : ${e.message}</p></section>`); }
}

function draw() {
  const d = list[idx];
  host.innerHTML = String(h`<section class="copilot" aria-label="Copilote décisionnel">
  <div class="cp-h"><div><span class="cp-tag">🤖 Copilote Wilaya</span><h3>Aide à la décision</h3><p class="cp-sub">Analyse automatique par règles et seuils explicites — aucune décision n'est exécutée sans votre validation.</p></div>${list.length ? h`<span class="cp-count" aria-live="polite">Recommandation ${idx + 1} sur ${list.length}</span>` : ''}</div>
  ${d ? h`<article class="cp-card">
    <div class="cp-meta"><span class="cp-prio ${d.priorite_info.badge}"><span aria-hidden="true">${BADGE[d.priorite_info.badge][0]}</span> ${d.priorite_info.label}</span><span class="cp-ent">Entité : ${d.entite}</span></div>
    <h4>${d.titre}</h4>
    <dl class="cp-dl"><dt>Diagnostic</dt><dd>${d.diagnostic}</dd><dt>Impact mesuré</dt><dd>${d.impact}</dd>${d.cause ? h`<dt>Cause probable</dt><dd>${d.cause}</dd>` : ''}</dl>
    <div class="cp-reco"><b>💡 Action recommandée</b><p>${d.recommandation}</p></div>
    <details class="cp-how"><summary>Comment cette recommandation a été calculée</summary><p>${d.methode}</p></details>
    <div class="cp-actions"><div><button class="cp-ok" data-act="cp-approve" data-id="${d.id}">✔ Valider & exécuter</button><button class="cp-adj" data-act="cp-adjust" data-id="${d.id}">✎ Ajuster</button><button class="cp-ign" data-act="cp-ignore" data-id="${d.id}">Ignorer</button></div>
    <div><button class="cp-nav" data-act="cp-nav" data-d="-1" aria-label="Recommandation précédente" ${raw(idx === 0 ? 'disabled' : '')}>◀</button><button class="cp-nav" data-act="cp-nav" data-d="1" aria-label="Recommandation suivante" ${raw(idx >= list.length - 1 ? 'disabled' : '')}>▶</button></div></div>
  </article>` : h`<div class="cp-empty"><span aria-hidden="true">✔</span> Aucune recommandation en attente : les indicateurs sont dans les seuils.</div>`}
  <details class="cp-hist" ${raw(history ? 'open' : '')}><summary data-act="cp-hist">Historique des décisions</summary>${history ? (history.length ? h`<ul>${history.map((x) => h`<li><b>${{ approuve: '✔ Approuvée', modifie: '✎ Ajustée', ignore: '✖ Ignorée' }[x.statut]}</b> — ${x.titre}<br><small>${x.valide_par} · ${fmtDt(x.decided_at)}${x.resultat ? ' · ' + x.resultat : ''}</small></li>`)}</ul>` : h`<p class="muted">Aucune décision enregistrée.</p>`) : ''}</details></section>`);
}

const send = async (id, body) => { const r = await api(`/copilot/decisions/${id}/action`, 'POST', body); toast(r.resultat || 'Décision enregistrée'); refresh(); };
actions['cp-nav'] = (el) => { idx = Math.max(0, Math.min(list.length - 1, idx + Number(el.dataset.d))); draw(); };
actions['cp-approve'] = (el) => send(el.dataset.id, { action: 'approve' });
actions['cp-ignore'] = (el) => decisionModal({ title: 'Ignorer la recommandation', label: 'Motif (facultatif)', submit: 'Ignorer', onSubmit: (d) => api(`/copilot/decisions/${el.dataset.id}/action`, 'POST', { action: 'ignore', note: d.commentaire }) });
actions['cp-hist'] = async (el) => { if (history) return; history = await api('/copilot/history'); draw(); host.querySelector('.cp-hist').open = true; };
actions['cp-adjust'] = (el) => {
  const d = list.find((x) => x.id === Number(el.dataset.id)); const p = d.params; let fields;
  if (d.action_type === 'redeploy') fields = h`${field('Nombre de fonctionnaires en renfort', 'n', { type: 'number', value: p.employee_ids.length, attrs: `min="1" max="${p.max}"`, required: true })}${field('Durée (jours)', 'jours', { type: 'number', value: p.jours, attrs: 'min="1" max="90"', required: true })}`;
  else if (d.action_type === 'convoke_cap') fields = field('Date de la CAP', 'date_session', { type: 'date', required: true });
  else if (d.action_type === 'invite_training') fields = field("Nombre d'invitations", 'n', { type: 'number', value: Math.min(p.cible, 40), attrs: 'min="1"', required: true });
  else fields = field('Nombre de postes à ouvrir', 'postes', { type: 'number', value: p.postes, attrs: `min="1" max="${p.max}"`, required: true });
  forms['cp-adjust'] = async (v) => { closeModal(); await send(d.id, { action: 'adjust', params: v }); };
  modal('Ajuster la recommandation', h`<form data-form="cp-adjust"><p class="note">${d.recommandation}</p>${fields}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Exécuter avec ces paramètres</button></div></form>`);
};
