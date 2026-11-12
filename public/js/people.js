import { h, raw, api, state, actions, forms, field, modal, closeModal, refresh, toast, badge, fmtDate, num, TYPES_CONGE, decisionModal, empPicker, MOIS } from './core.js';
import { meter } from './charts.js';

const isHr = () => state.user.role === 'drh';
const empLink = (x) => h`<a href="#/fonctionnaires/${x.employee_id ?? x.id}">${x.prenom} ${x.nom}</a>`;

// ------------------------------------------------------------ Liste
let fl = { q: '', service_id: '', localisation: '', corps: '', offset: 0, statut: 'actif' };
export async function employees(root) {
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(fl).filter(([, v]) => v !== '')), limit: 50 });
  const r = await api('/employees?' + qs);
  const R = state.refs;
  root.innerHTML = String(h`<div class="page-h"><div><h1>${state.user.role === 'chef' ? 'Mon équipe' : 'Fonctionnaires'}</h1><p class="muted">${num(r.total)} dossier(s) ${fl.statut === 'parti' ? 'archivé(s)' : 'actif(s)'}</p></div>${isHr() ? h`<a class="btn primary" href="#/fonctionnaires/nouveau">+ Nouveau fonctionnaire</a>` : ''}</div>
  <form class="filters" data-form="emp-filter">
    <label class="field"><span>Recherche</span><input type="search" name="q" value="${fl.q}" placeholder="Nom, prénom, PPR"></label>
    ${isHr() ? h`${field('Territoire', 'localisation', { options: R.localisations, value: fl.localisation })}${field('Service', 'service_id', { options: R.services.map((s) => [s.id, `${s.nom} — ${s.division}`]), value: fl.service_id })}${field('Corps', 'corps', { options: R.corps, value: fl.corps })}${field('Statut', 'statut', { options: [['actif', 'Actifs'], ['parti', 'Partis / archivés']], value: fl.statut })}` : ''}
    <button class="primary" type="submit">Filtrer</button></form>
  <div class="card"><div class="tscroll"><table class="t"><thead><tr><th>PPR</th><th>Nom</th><th>Corps · grade</th><th>Éch.</th><th>Service</th><th>Recrutement</th></tr></thead><tbody>
  ${r.items.map((x) => h`<tr><td>${x.ppr}</td><td><a href="#/fonctionnaires/${x.id}">${x.nom} ${x.prenom}</a></td><td>${x.corps} · ${x.grade}</td><td>${x.echelle}/${x.echelon}</td><td>${x.service}<br><small class="muted">${x.localisation}</small></td><td>${fmtDate(x.date_recrutement)}</td></tr>`)}
  ${r.items.length ? '' : h`<tr><td colspan="6" class="muted">Aucun résultat.</td></tr>`}</tbody></table></div>
  <div class="pager"><button class="ghost" data-act="emp-page" data-d="-50" ${raw(fl.offset <= 0 ? 'disabled' : '')}>← Précédent</button><span>${r.total ? fl.offset + 1 : 0}–${Math.min(fl.offset + 50, r.total)} sur ${r.total}</span><button class="ghost" data-act="emp-page" data-d="50" ${raw(fl.offset + 50 >= r.total ? 'disabled' : '')}>Suivant →</button></div></div>`);
}
forms['emp-filter'] = async (d) => { fl = { q: d.q || '', service_id: d.service_id || '', localisation: d.localisation || '', corps: d.corps || '', statut: d.statut || 'actif', offset: 0 }; refresh(); };
actions['emp-page'] = (el) => { fl.offset = Math.max(0, fl.offset + Number(el.dataset.d)); refresh(); };

// ------------------------------------------------------------ Fiche
export async function employee(root, id) {
  const e = await api('/employees/' + id); const own = state.user.employee_id === e.id; const el = e.eligibilite;
  const SV = state.refs.services;
  const elig = (x, label) => !x ? h`<li>${label} : <span class="muted">dernier niveau atteint</span></li>` : h`<li><b>${label}</b> : ${x.de} → ${x.a} — ${x.eligible ? h`<span class="badge ok">✔ Éligible depuis le ${fmtDate(x.date_eligibilite)}</span>` : h`<span class="badge info">ℹ Éligible le ${fmtDate(x.date_eligibilite)}</span>`}${x.mode ? h` <small class="muted">(mode ${x.mode}${x.quota_pct ? ', quota ' + x.quota_pct + ' %' : ''}${x.echelon_min ? ', échelon ≥ ' + x.echelon_min : ''})</small>` : x.duree_mois ? h` <small class="muted">(rythme ${x.rythme} : ${x.duree_mois} mois)</small>` : ''}</li>`;
  root.innerHTML = String(h`<div class="page-h"><div><h1>${e.prenom} ${e.nom}</h1><p class="muted">PPR ${e.ppr} · ${e.poste || e.corps} · ${e.statut === 'parti' ? h`<span class="badge muted">Parti le ${fmtDate(e.date_depart)} (${e.motif_depart})</span>` : e.service}</p></div>
    <div class="row">${isHr() && e.statut === 'actif' ? h`<button class="ghost" data-act="emp-edit" data-id="${e.id}">Modifier l'affectation</button><button class="ghost" data-act="emp-depart" data-id="${e.id}">Enregistrer un départ</button>` : ''}${own ? h`<a class="btn" href="#/eservices">Mes documents</a>` : ''}</div></div>
  <div class="grid3">
    <section class="card"><h3>Situation administrative</h3><dl class="dl"><dt>Corps</dt><dd>${e.corps}</dd><dt>Grade</dt><dd>${e.grade}</dd><dt>Échelle / échelon</dt><dd>${e.echelle} / ${e.echelon}</dd><dt>Rythme d'avancement</dt><dd>${e.rythme}</dd><dt>Recrutement</dt><dd>${fmtDate(e.date_recrutement)} (${e.ancienneté_ans} ans)</dd><dt>Dernier échelon</dt><dd>${fmtDate(e.date_dernier_echelon)}</dd><dt>Dernier grade</dt><dd>${fmtDate(e.date_dernier_grade)}</dd>${e.salaire_base ? h`<dt>Traitement de base</dt><dd>${num(e.salaire_base)} MAD <small class="muted">(indicatif)</small></dd>` : ''}</dl></section>
    <section class="card"><h3>Affectation</h3><dl class="dl"><dt>Service</dt><dd>${e.service}</dd><dt>Division</dt><dd>${e.division}</dd><dt>Territoire</dt><dd>${e.localisation}</dd><dt>Fonction</dt><dd>${e.est_chef ? 'Chef de service' : 'Agent'}${e.cadre_sup ? ' · cadre supérieur' : ''}</dd></dl></section>
    <section class="card"><h3>Informations personnelles</h3><dl class="dl"><dt>Né(e) le</dt><dd>${fmtDate(e.date_naissance)} (${e.age} ans)</dd><dt>Départ à la retraite</dt><dd>${fmtDate(e.date_retraite)}</dd>${e.cin ? h`<dt>CIN</dt><dd>${e.cin}</dd>` : ''}${e.situation_familiale ? h`<dt>Situation familiale</dt><dd>${e.situation_familiale}, ${e.nb_enfants} enfant(s)</dd>` : ''}<dt>Diplôme</dt><dd>${e.diplome || '—'}</dd>${e.email ? h`<dt>Courriel</dt><dd>${e.email}</dd>` : ''}${e.telephone ? h`<dt>Téléphone</dt><dd>${e.telephone}</dd>` : ''}</dl></section>
  </div>
  <div class="grid2">
    <section class="card"><h3>Suivi de carrière</h3><ul class="plain">${elig(el.echelon, 'Échelon')}${elig(el.grade, 'Grade')}</ul>
      ${e.promotions.length ? h`<h4>Historique des promotions</h4><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Évolution</th><th>Statut</th><th>Décision</th></tr></thead><tbody>${e.promotions.map((p) => h`<tr><td>${fmtDate(p.decided_at || p.opened_at)}</td><td>${p.type === 'echelon' ? 'Échelon' : 'Grade'}</td><td>${p.de_valeur} → ${p.a_valeur}</td><td>${badge(p.statut)}</td><td>${p.ref_decision || '—'}</td></tr>`)}</tbody></table>` : ''}</section>
    <section class="card"><h3>Congés & formation</h3>
      <p class="big-n">${num(e.solde_conges, 1)} <small>jours de congé restants</small></p>${meter(Math.max(0, e.solde_conges), 30, 'Solde de congés')}
      <p class="big-n" style="margin-top:18px">${num(e.heures_formation_annee, 0)} h <small>de formation suivies en ${state.today.slice(0, 4)} (${num(e.heures_formation_total)} h au total)</small></p></section>
  </div>
  ${e.onboarding ? h`<section class="card"><h3>Parcours d'intégration (prise de service)</h3><ul class="plain check">${e.onboarding.map((o, i) => h`<li><label><input type="checkbox" data-act="onb" data-id="${e.id}" data-i="${i}" ${raw(o.done ? 'checked' : '')} ${raw(isHr() ? '' : 'disabled')}> ${o.label}</label></li>`)}</ul></section>` : ''}`);
}
actions.onb = async (el) => { await api(`/employees/${el.dataset.id}/onboarding`, 'POST', { index: Number(el.dataset.i), done: el.checked }); };
actions['emp-edit'] = async (el) => {
  const e = await api('/employees/' + el.dataset.id); const R = state.refs;
  forms['emp-edit'] = async (d) => { await api('/employees/' + e.id, 'PUT', { service_id: Number(d.service_id), poste: d.poste, rythme: d.rythme }); closeModal(); toast('Dossier mis à jour'); refresh(); };
  modal("Modifier l'affectation", h`<form data-form="emp-edit">${field('Service', 'service_id', { options: R.services.map((s) => [s.id, `${s.nom} — ${s.division}`]), value: e.service_id, required: true })}${field('Poste / fonction', 'poste', { value: e.poste || '', required: true })}${field("Rythme d'avancement", 'rythme', { options: ['rapide', 'moyen', 'lent'], value: e.rythme, required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`);
};
actions['emp-depart'] = (el) => {
  forms['emp-depart'] = async (d) => { await api(`/employees/${el.dataset.id}/depart`, 'POST', d); closeModal(); toast('Départ enregistré'); refresh(); };
  modal('Enregistrer un départ', h`<form data-form="emp-depart">${field('Date de départ', 'date_depart', { type: 'date', required: true })}${field('Motif', 'motif', { options: ['Retraite', 'Démission', 'Mutation', 'Détachement', 'Décès', 'Révocation'], required: true })}<p class="note">Le compte du fonctionnaire sera désactivé ; le départ alimente les indicateurs de turnover.</p><div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Confirmer</button></div></form>`);
};

// ------------------------------------------------------------ Nouveau fonctionnaire
export async function employeeNew(root, params) {
  const R = state.refs; let rec = null;
  if (params.get('recruitment')) { const l = await api('/recruitments'); rec = l.find((x) => x.id === Number(params.get('recruitment'))); }
  const [pre, nom] = rec ? [rec.candidat.split(' ')[0], rec.candidat.split(' ').slice(1).join(' ')] : ['', ''];
  forms['emp-new'] = async (d) => {
    const r = await api('/employees', 'POST', { ...d, ...(rec ? { recruitment_id: rec.id } : {}) });
    root.innerHTML = String(h`<div class="page-h"><h1>Dossier créé</h1></div><section class="card"><p>Le dossier de <b>${d.prenom} ${d.nom}</b> (PPR <b>${r.ppr}</b>) a été créé, ainsi que le compte du portail.</p><div class="secret"><div>Identifiant : <b>${r.identifiant}</b></div><div>Mot de passe temporaire : <b>${r.mot_de_passe_temporaire}</b></div></div><p class="note">À remettre à l'intéressé(e) ; il sera à changer à la première connexion. Cette information n'est affichée qu'une seule fois. Le chef de service a été notifié et le parcours d'intégration est ouvert.</p><a class="btn primary" href="#/fonctionnaires/${r.id}">Ouvrir le dossier</a></section>`);
  };
  root.innerHTML = String(h`<div class="page-h"><div><h1>Nouveau fonctionnaire</h1><p class="muted">Immatriculation, dossier numérique, affectation et grade initial${rec ? ` — recrutement : ${rec.poste}` : ''}</p></div></div>
  <form class="card formgrid" data-form="emp-new">
    ${field('Nom', 'nom', { value: nom, required: true })}${field('Prénom', 'prenom', { value: pre, required: true })}${field('Sexe', 'sexe', { options: [['F', 'Féminin'], ['H', 'Masculin']], required: true })}${field('Date de naissance', 'date_naissance', { type: 'date', required: true })}
    ${field('CIN', 'cin')}${field('PPR', 'ppr', { hint: 'Laisser vide pour générer automatiquement', attrs: 'pattern="\\d{6,8}"' })}${field('Date de recrutement', 'date_recrutement', { type: 'date', required: true })}${field('Date de prise de service', 'date_prise_service', { type: 'date' })}
    ${field('Corps', 'corps', { options: R.corps, required: true })}${field('Grade initial', 'grade', { options: R.grades, value: R.grades[0] })}${field('Échelon initial', 'echelon', { type: 'number', value: 1, attrs: 'min="1" max="10"' })}${field('Poste', 'poste')}
    ${field('Service d\'affectation', 'service_id', { options: R.services.map((s) => [s.id, `${s.nom} — ${s.division}`]), required: true })}${field('Diplôme', 'diplome')}${field('Courriel', 'email', { type: 'email' })}${field('Téléphone', 'telephone', { type: 'tel' })}
    ${field('Situation familiale', 'situation_familiale', { options: ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)'] })}${field("Nombre d'enfants", 'nb_enfants', { type: 'number', attrs: 'min="0"' })}
    <div class="actions full"><a class="btn ghost" href="#/fonctionnaires">Annuler</a><button class="primary" type="submit">Créer le dossier</button></div></form>`);
}

// ------------------------------------------------------------ Congés
let leaveFilter = 'a_traiter';
export async function leaves(root) {
  const u = state.user; const me = u.employee_id ? await api('/employees/' + u.employee_id) : null;
  let list = await api('/leaves'); const pending = list.filter((l) => l.statut.startsWith('en_attente'));
  if (leaveFilter === 'a_traiter') list = pending; else if (leaveFilter !== 'tous') list = list.filter((l) => l.statut === leaveFilter);
  const actionsFor = (l) => {
    const out = [];
    if (u.role === 'chef' && l.statut === 'en_attente_chef' && l.employee_id !== u.employee_id) out.push(h`<button class="mini ok" data-act="leave" data-id="${l.id}" data-a="favorable">Avis favorable</button><button class="mini ko" data-act="leave" data-id="${l.id}" data-a="defavorable">Avis défavorable</button>`);
    if (u.role === 'drh' && l.statut.startsWith('en_attente')) out.push(h`<button class="mini ok" data-act="leave" data-id="${l.id}" data-a="valider">Valider</button><button class="mini ko" data-act="leave" data-id="${l.id}" data-a="rejeter">Rejeter</button>`);
    if (l.employee_id === u.employee_id && l.statut.startsWith('en_attente')) out.push(h`<button class="mini" data-act="leave" data-id="${l.id}" data-a="annuler">Annuler</button>`);
    return out;
  };
  root.innerHTML = String(h`<div class="page-h"><div><h1>Congés</h1><p class="muted">Demande en ligne et circuit de validation : fonctionnaire → chef de service → DRH</p></div>${me ? h`<button class="primary" data-act="leave-new">+ Nouvelle demande</button>` : ''}</div>
  ${me ? h`<section class="card"><div class="row spread"><div><p class="big-n">${num(me.solde_conges, 1)} <small>jours de congé annuel disponibles</small></p></div><div class="grow">${meter(Math.max(0, me.solde_conges), 30, 'Solde')}</div></div></section>` : ''}
  <div class="tabs">${[['a_traiter', `À traiter (${pending.length})`], ['valide', 'Validés'], ['rejete', 'Rejetés'], ['tous', 'Tous']].map(([k, l]) => h`<button class="tab ${leaveFilter === k ? 'on' : ''}" data-act="leave-filter" data-k="${k}">${l}</button>`)}</div>
  <div class="card"><div class="tscroll"><table class="t"><thead><tr>${u.role !== 'fonctionnaire' ? h`<th>Fonctionnaire</th>` : ''}<th>Type</th><th>Période</th><th>Jours</th><th>Statut</th><th>Avis du chef</th><th></th></tr></thead><tbody>
  ${list.map((l) => h`<tr>${u.role !== 'fonctionnaire' ? h`<td>${empLink(l)}<br><small class="muted">${l.service}</small></td>` : ''}<td>${TYPES_CONGE[l.type] || l.type}</td><td>${fmtDate(l.date_debut)} → ${fmtDate(l.date_fin)}</td><td>${l.jours}</td><td>${badge(l.statut)}${l.commentaire_drh ? h`<br><small class="muted">${l.commentaire_drh}</small>` : ''}</td><td>${l.avis_chef ? h`${l.avis_chef}${l.commentaire_chef ? h`<br><small class="muted">${l.commentaire_chef}</small>` : ''}` : '—'}</td><td class="nowrap">${actionsFor(l)}</td></tr>`)}
  ${list.length ? '' : h`<tr><td colspan="7" class="muted">Aucune demande.</td></tr>`}</tbody></table></div></div>`);
}
actions['leave-filter'] = (el) => { leaveFilter = el.dataset.k; refresh(); };
actions['leave-new'] = () => {
  forms['leave-new'] = async (d) => { const r = await api('/leaves', 'POST', d); closeModal(); toast(`Demande envoyée (${r.jours} jour(s) ouvré(s))`); refresh(); };
  modal('Nouvelle demande de congé', h`<form data-form="leave-new">${field('Type', 'type', { options: Object.entries(TYPES_CONGE), required: true })}${field('Du', 'date_debut', { type: 'date', required: true })}${field('Au (inclus)', 'date_fin', { type: 'date', required: true })}${field('Motif (facultatif)', 'motif', { type: 'textarea' })}<p class="note">Le décompte exclut les week-ends et jours fériés.</p><div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Envoyer</button></div></form>`);
};
actions.leave = (el) => {
  const id = el.dataset.id, a = el.dataset.a; const go = (c) => api(`/leaves/${id}/decision`, 'POST', { action: a, commentaire: c });
  if (a === 'rejeter' || a === 'defavorable') decisionModal({ title: a === 'rejeter' ? 'Rejeter la demande' : 'Avis défavorable', label: 'Motif', required: a === 'rejeter', onSubmit: (d) => go(d.commentaire) });
  else go().then(() => { toast('Enregistré'); refresh(); }).catch((e) => toast(e.message, 'ko'));
};

// ------------------------------------------------------------ Absences
let absFilter = 'soumise';
export async function absences(root) {
  const u = state.user; let list = await api('/absences'); const n = (k) => list.filter((a) => a.statut_justif === k).length;
  const all = list; if (absFilter !== 'tous') list = list.filter((a) => a.statut_justif === absFilter);
  root.innerHTML = String(h`<div class="page-h"><div><h1>Absences & justifications</h1><p class="muted">Une absence dont la justification est validée par la DRH n'entre pas dans le taux d'absentéisme.</p></div>${u.role !== 'fonctionnaire' ? h`<button class="primary" data-act="abs-new">+ Déclarer une absence</button>` : ''}</div>
  <div class="tabs">${[['soumise', `À examiner (${n('soumise')})`], ['aucune', `Non justifiées (${n('aucune')})`], ['validee', 'Justifiées'], ['rejetee', 'Rejetées'], ['tous', 'Toutes']].map(([k, l]) => h`<button class="tab ${absFilter === k ? 'on' : ''}" data-act="abs-filter" data-k="${k}">${l}</button>`)}</div>
  <div class="card"><div class="tscroll"><table class="t"><thead><tr>${u.role !== 'fonctionnaire' ? h`<th>Fonctionnaire</th>` : ''}<th>Période</th><th>Jours</th><th>Nature</th><th>Justification</th><th></th></tr></thead><tbody>
  ${list.slice(0, 200).map((a) => h`<tr>${u.role !== 'fonctionnaire' ? h`<td>${empLink(a)}<br><small class="muted">${a.service}</small></td>` : ''}<td>${fmtDate(a.date_debut)}${a.date_fin !== a.date_debut ? h` → ${fmtDate(a.date_fin)}` : ''}</td><td>${a.jours}</td><td>${a.type === 'maladie' ? 'Maladie' : 'Autre absence'}</td><td>${badge(a.statut_justif)}${a.justification ? h`<br><small class="muted">${a.justification}</small>` : ''}${a.commentaire_drh ? h`<br><small class="muted">DRH : ${a.commentaire_drh}</small>` : ''}</td>
  <td class="nowrap">${u.role === 'drh' && a.statut_justif === 'soumise' ? h`<button class="mini ok" data-act="abs-dec" data-id="${a.id}" data-a="valider">Valider</button><button class="mini ko" data-act="abs-dec" data-id="${a.id}" data-a="rejeter">Rejeter</button>` : ''}${(a.employee_id === u.employee_id || u.role === 'drh') && ['aucune', 'rejetee'].includes(a.statut_justif) ? h`<button class="mini" data-act="abs-just" data-id="${a.id}">Justifier</button>` : ''}</td></tr>`)}
  ${list.length ? '' : h`<tr><td colspan="6" class="muted">Aucune absence dans cette catégorie.</td></tr>`}</tbody></table></div>${list.length > 200 ? h`<p class="note">200 premières lignes affichées sur ${list.length}.</p>` : ''}</div>`);
}
actions['abs-filter'] = (el) => { absFilter = el.dataset.k; refresh(); };
actions['abs-new'] = () => {
  forms['abs-new'] = async (d) => { if (!d.employee_id) throw new Error('Sélectionnez un fonctionnaire'); await api('/absences', 'POST', d); closeModal(); toast('Absence enregistrée'); refresh(); };
  modal('Déclarer une absence', h`<form data-form="abs-new">${empPicker()}${field('Du', 'date_debut', { type: 'date', required: true })}${field('Au (inclus)', 'date_fin', { type: 'date', required: true })}${field('Nature', 'type', { options: [['maladie', 'Maladie'], ['absence', 'Autre absence']], required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`);
};
actions['abs-just'] = (el) => decisionModal({ title: 'Justifier une absence', label: 'Justification (n° de certificat, motif…)', required: true, submit: 'Soumettre', onSubmit: (d) => api(`/absences/${el.dataset.id}/justify`, 'POST', { justification: d.commentaire }) });
actions['abs-dec'] = (el) => decisionModal({ title: el.dataset.a === 'valider' ? 'Valider la justification' : 'Rejeter la justification', label: 'Commentaire', required: el.dataset.a === 'rejeter', onSubmit: (d) => api(`/absences/${el.dataset.id}/decision`, 'POST', { action: el.dataset.a, commentaire: d.commentaire }) });
