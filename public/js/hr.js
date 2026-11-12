import { h, raw, api, state, actions, forms, field, modal, closeModal, refresh, toast, badge, fmtDate, fmtDt, num, pctf, decisionModal, empPicker, MOIS } from './core.js';
import { meter } from './charts.js';

const isHr = () => state.user.role === 'drh';
const empLink = (x) => h`<a href="#/fonctionnaires/${x.employee_id ?? x.id}">${x.prenom} ${x.nom}</a>`;
const cancelRow = (cols) => h`<tr><td colspan="${cols}" class="muted">Aucune donnée.</td></tr>`;

// ------------------------------------------------------------ Avancements
let promoTab = 'propositions'; let promoFilter = 'propose';
export async function promotions(root) {
  const u = state.user; const list = await api('/promotions'); const R = state.refs;
  const cnt = (s) => list.filter((p) => p.statut === s).length; const shown = promoFilter === 'tous' ? list : list.filter((p) => p.statut === promoFilter);
  const tabs = isHr() ? [['propositions', 'Propositions & décisions'], ['regles', 'Règles d\'avancement'], ['cap', 'Commissions (CAP)']] : [['propositions', 'Avancements']];
  let body;
  if (promoTab === 'regles' && isHr()) {
    const rg = R.regles;
    forms.rules = async (d) => {
      const echelon = ['rapide', 'moyen', 'lent'].map((r) => ({ rythme: r, duree_mois: Number(d['e_' + r]) }));
      const grade = rg.grade.map((g) => ({ id: g.id, anciennete_min_ans: Number(d['a_' + g.id]), quota_pct: Number(d['q_' + g.id]), echelon_min: Number(d['m_' + g.id]) }));
      state.refs.regles = await api('/rules', 'PUT', { echelon, grade }); toast('Règles enregistrées'); refresh();
    };
    body = h`<form class="card" data-form="rules"><h3>Avancement d'échelon — durée par rythme</h3><div class="formgrid">${['rapide', 'moyen', 'lent'].map((r) => field(`Rythme ${r} (mois)`, 'e_' + r, { type: 'number', value: rg.echelon[r].duree_mois, attrs: 'min="6" max="120"' }))}</div>
    <h3>Avancement de grade</h3><div class="tscroll"><table class="t"><thead><tr><th>Passage</th><th>Mode</th><th>Ancienneté min. dans le grade (ans)</th><th>Échelon min.</th><th>Quota (%)</th></tr></thead><tbody>${rg.grade.map((g) => h`<tr><td>${g.grade_from} → ${g.grade_to}</td><td>${g.mode === 'choix' ? 'Au choix (quota)' : 'Examen professionnel'}</td><td><input type="number" step="0.5" min="1" max="30" name="a_${g.id}" value="${g.anciennete_min_ans}"></td><td><input type="number" min="1" max="10" name="m_${g.id}" value="${g.echelon_min}"></td><td><input type="number" min="0" max="100" name="q_${g.id}" value="${g.quota_pct}"></td></tr>`)}</tbody></table></div>
    <p class="note">Les règles s'appliquent à la prochaine génération des propositions. Le quota s'applique à l'effectif du grade de départ. Les avancements par examen sont saisis manuellement après proclamation des résultats. À aligner sur le statut de la fonction publique en vigueur.</p><div class="actions"><button class="primary" type="submit">Enregistrer les règles</button></div></form>`;
  } else if (promoTab === 'cap' && isHr()) {
    forms.cap = async (d) => { await api('/caps', 'POST', d); toast('Session CAP créée'); closeModal(); state.refs = await api('/refs'); refresh(); };
    body = h`<div class="card"><div class="row spread"><h3>Commissions administratives paritaires</h3><button class="primary" data-act="cap-new">+ Planifier une CAP</button></div><table class="t"><thead><tr><th>Date</th><th>Objet</th><th>Statut</th><th>Propositions</th></tr></thead><tbody>${R.caps.map((c) => h`<tr><td>${fmtDate(c.date_session)}</td><td>${c.objet}</td><td>${badge(c.statut === 'tenue' ? 'terminee' : 'planifiee')}</td><td>${list.filter((p) => p.cap_id === c.id).length}</td></tr>`)}</tbody></table></div>`;
  } else {
    body = h`${isHr() ? h`<div class="row"><button class="primary" data-act="promo-gen">Générer les propositions</button><button class="ghost" data-act="promo-new">+ Proposition manuelle (examen…)</button></div>` : ''}
    <div class="tiles"><div class="tile"><div class="t-label">À décider</div><div class="t-value">${cnt('propose')}</div></div><div class="tile"><div class="t-label">Validés</div><div class="t-value">${cnt('valide')}</div></div><div class="tile"><div class="t-label">Rejetés</div><div class="t-value">${cnt('rejete')}</div></div></div>
    <div class="tabs">${[['propose', 'À décider'], ['valide', 'Validés'], ['rejete', 'Rejetés'], ['tous', 'Tous']].map(([k, l]) => h`<button class="tab ${promoFilter === k ? 'on' : ''}" data-act="promo-filter" data-k="${k}">${l}</button>`)}</div>
    <div class="card"><div class="tscroll"><table class="t"><thead><tr>${u.role !== 'fonctionnaire' ? h`<th>Fonctionnaire</th>` : ''}<th>Type</th><th>Évolution</th><th>Mode</th><th>Ouvert le</th><th>Statut</th><th>Décision</th><th></th></tr></thead><tbody>
    ${shown.map((p) => h`<tr>${u.role !== 'fonctionnaire' ? h`<td>${empLink(p)}<br><small class="muted">${p.corps} · ${p.service}</small></td>` : ''}<td>${p.type === 'echelon' ? 'Échelon' : 'Grade'}</td><td>${p.de_valeur} → <b>${p.a_valeur}</b></td><td>${p.mode || '—'}</td><td>${fmtDate(p.opened_at)}</td><td>${badge(p.statut)}</td><td>${p.ref_decision || '—'}${p.decided_at ? h`<br><small class="muted">${fmtDate(p.decided_at)}</small>` : ''}</td><td class="nowrap">${isHr() && p.statut === 'propose' ? h`<button class="mini ok" data-act="promo-dec" data-id="${p.id}" data-a="valider">Valider</button><button class="mini ko" data-act="promo-dec" data-id="${p.id}" data-a="rejeter">Rejeter</button>` : ''}</td></tr>`)}
    ${shown.length ? '' : cancelRow(8)}</tbody></table></div></div>`;
  }
  root.innerHTML = String(h`<div class="page-h"><div><h1>Avancements de grade & d'échelon</h1><p class="muted">Éligibilité calculée automatiquement à partir des règles paramétrées</p></div></div>${tabs.length > 1 ? h`<div class="tabs">${tabs.map(([k, l]) => h`<button class="tab ${promoTab === k ? 'on' : ''}" data-act="promo-tab" data-k="${k}">${l}</button>`)}</div>` : ''}${body}`);
}
actions['promo-tab'] = (el) => { promoTab = el.dataset.k; refresh(); };
actions['promo-filter'] = (el) => { promoFilter = el.dataset.k; refresh(); };
actions['promo-gen'] = async () => { const r = await api('/promotions/generate', 'POST'); toast(`${r.echelon} proposition(s) d'échelon et ${r.grade} de grade générée(s)`); refresh(); };
actions['promo-dec'] = (el) => {
  const a = el.dataset.a;
  decisionModal({ title: a === 'valider' ? 'Valider l\'avancement' : 'Rejeter la proposition', label: a === 'valider' ? 'Référence de la décision / de l\'arrêté' : 'Motif', required: true, submit: 'Confirmer', onSubmit: (d) => api(`/promotions/${el.dataset.id}/decision`, 'POST', { action: a, ref_decision: d.commentaire }) });
};
actions['promo-new'] = () => {
  forms['promo-new'] = async (d) => { if (!d.employee_id) throw new Error('Sélectionnez un fonctionnaire'); await api('/promotions', 'POST', d); closeModal(); toast('Proposition créée'); refresh(); };
  modal('Proposition manuelle', h`<form data-form="promo-new">${empPicker()}${field('Type', 'type', { options: [['grade', 'Avancement de grade'], ['echelon', "Avancement d'échelon"]], required: true })}${field('Mode', 'mode', { options: [['examen', 'Examen professionnel'], ['choix', 'Au choix']], value: 'examen', required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Créer</button></div></form>`);
};
actions['cap-new'] = () => modal('Planifier une CAP', h`<form data-form="cap">${field('Date de la session', 'date_session', { type: 'date', required: true })}${field('Objet', 'objet', { required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Créer</button></div></form>`);

// ------------------------------------------------------------ Formations
export async function trainings(root) {
  const u = state.user; const list = await api('/trainings'); const besoins = await api('/besoins'); const me = u.employee_id ? await api('/employees/' + u.employee_id) : null;
  const mine = list.filter((t) => t.mon_inscription && ['convoque', 'confirme', 'decline'].includes(t.mon_inscription.statut) && !['terminee', 'annulee'].includes(t.statut));
  const done = list.filter((t) => t.mon_inscription?.statut === 'present');
  const respBtns = (t) => { const s = t.mon_inscription.statut; return h`${s !== 'confirme' ? h`<button class="mini ok" data-act="enr" data-id="${t.mon_inscription.id}" data-a="confirme">Confirmer ma présence</button>` : ''}${s !== 'decline' ? h`<button class="mini ko" data-act="enr" data-id="${t.mon_inscription.id}" data-a="decline">Me désister</button>` : ''}`; };
  root.innerHTML = String(h`<div class="page-h"><div><h1>Formation continue</h1><p class="muted">Catalogue, convocations et suivi des heures de formation</p></div>${isHr() ? h`<div class="row"><button class="ghost" data-act="form-new">+ Formateur</button><button class="primary" data-act="train-new">+ Nouvelle formation</button></div>` : ''}</div>
  ${me ? h`<section class="card"><p class="big-n">${num(me.heures_formation_annee)} h <small>suivies cette année · ${num(me.heures_formation_total)} h au total</small></p></section>` : ''}
  ${mine.length ? h`<section class="card"><h3>Mes invitations</h3><table class="t"><tbody>${mine.map((t) => h`<tr><td><b>${t.titre}</b><br><small class="muted">${fmtDate(t.date_debut)} → ${fmtDate(t.date_fin)} · ${t.heures} h · ${t.lieu || ''}</small></td><td>${badge(t.mon_inscription.statut)}</td><td class="nowrap">${respBtns(t)}</td></tr>`)}</tbody></table></section>` : ''}
  ${done.length ? h`<section class="card"><h3>Mes formations suivies</h3><table class="t"><tbody>${done.map((t) => h`<tr><td>${t.titre}</td><td>${fmtDate(t.date_debut)}</td><td>${t.heures} h</td><td>${t.mon_inscription.note_satisfaction ? h`Ma note : ${t.mon_inscription.note_satisfaction}/5` : h`<span class="nowrap">Évaluer : ${[1, 2, 3, 4, 5].map((n) => h`<button class="mini" data-act="rate" data-id="${t.mon_inscription.id}" data-n="${n}" aria-label="Note ${n} sur 5">${n}</button>`)}</span>`}</td></tr>`)}</tbody></table></section>` : ''}
  <section class="card"><div class="row spread"><h3>Besoins de formation</h3>${u.employee_id ? h`<button class="primary" data-act="need-new">+ Exprimer un besoin</button>` : ''}</div>
  <p class="note">Circuit : agent → avis du chef de service → décision de la DRH (intégration au plan et convocation).</p>
  <div class="tscroll"><table class="t"><thead><tr>${u.role !== 'fonctionnaire' ? h`<th>Fonctionnaire</th>` : ''}<th>Thème</th><th>Session visée</th><th>Statut</th><th></th></tr></thead><tbody>${besoins.map((b) => h`<tr>${u.role !== 'fonctionnaire' ? h`<td>${empLink(b)}</td>` : ''}<td><b>${b.theme}</b>${b.justification ? h`<br><small class="muted">${b.justification}</small>` : ''}</td><td>${b.training || '—'}</td><td>${badge('bs_' + b.statut.replace('avis_', 'avis_'))}${b.commentaire_chef ? h`<br><small class="muted">Chef : ${b.commentaire_chef}</small>` : ''}${b.commentaire_drh ? h`<br><small class="muted">DRH : ${b.commentaire_drh}</small>` : ''}</td>
  <td class="nowrap">${u.role === 'chef' && b.statut === 'soumis' && b.employee_id !== u.employee_id ? h`<button class="mini ok" data-act="need-dec" data-id="${b.id}" data-a="favorable">Favorable</button><button class="mini ko" data-act="need-dec" data-id="${b.id}" data-a="defavorable">Défavorable</button>` : ''}${isHr() && ['soumis', 'avis_favorable', 'avis_defavorable'].includes(b.statut) ? h`<button class="mini ok" data-act="need-dec" data-id="${b.id}" data-a="retenir">Retenir</button><button class="mini ko" data-act="need-dec" data-id="${b.id}" data-a="rejeter">Rejeter</button>` : ''}</td></tr>`)}${besoins.length ? '' : cancelRow(5)}</tbody></table></div></section>
  <section class="card"><h3>Catalogue des formations</h3><div class="tscroll"><table class="t"><thead><tr><th>Intitulé</th><th>Domaine</th><th>Dates</th><th>Durée</th><th>Formateur</th><th>Inscrits</th><th>Statut</th></tr></thead><tbody>
  ${list.map((t) => h`<tr><td>${isHr() ? h`<a href="#/formations/${t.id}">${t.titre}</a>` : t.titre}</td><td>${t.domaine}</td><td>${fmtDate(t.date_debut)} → ${fmtDate(t.date_fin)}</td><td>${t.heures} h</td><td>${t.formateur || '—'}</td><td>${t.inscrits} / ${t.capacite}</td><td>${badge(t.statut)}</td></tr>`)}</tbody></table></div></section>`);
}
actions['need-new'] = async () => {
  const open = (await api('/trainings')).filter((t) => t.statut === 'planifiee');
  forms['need-new'] = async (d) => { await api('/besoins', 'POST', d); closeModal(); toast('Besoin transmis'); refresh(); };
  modal('Exprimer un besoin de formation', h`<form data-form="need-new">${field('Thème souhaité', 'theme', { required: true })}${field('Session du catalogue (facultatif)', 'training_id', { options: open.map((t) => [t.id, `${t.titre} — ${fmtDate(t.date_debut)}`]) })}${field('Justification', 'justification', { type: 'textarea' })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Envoyer</button></div></form>`);
};
actions['need-dec'] = (el) => {
  const a = el.dataset.a; const go = (com) => api(`/besoins/${el.dataset.id}/decision`, 'POST', { action: a, commentaire: com });
  if (a === 'rejeter' || a === 'defavorable') decisionModal({ title: a === 'rejeter' ? 'Ne pas retenir ce besoin' : 'Avis défavorable', label: 'Motif', required: a === 'rejeter', onSubmit: (d) => go(d.commentaire) });
  else go().then(() => { toast('Enregistré'); refresh(); }).catch((e) => toast(e.message, 'ko'));
};
actions.enr = async (el) => { await api(`/enrollments/${el.dataset.id}/respond`, 'POST', { action: el.dataset.a }); toast('Réponse enregistrée'); refresh(); };
actions.rate = async (el) => { await api(`/enrollments/${el.dataset.id}/evaluate`, 'POST', { note: Number(el.dataset.n) }); toast('Merci pour votre évaluation'); refresh(); };
actions['train-new'] = () => {
  const R = state.refs; forms['train-new'] = async (d) => { await api('/trainings', 'POST', d); closeModal(); toast('Formation créée'); refresh(); };
  modal('Nouvelle formation', h`<form data-form="train-new" class="formgrid one">${field('Intitulé', 'titre', { required: true })}${field('Domaine', 'domaine', { options: ['Droit administratif', 'Marchés publics', "Systèmes d'information", 'Management territorial', 'Gestion RH', 'Communication'], required: true })}${field('Début', 'date_debut', { type: 'date', required: true })}${field('Fin', 'date_fin', { type: 'date', required: true })}${field('Volume horaire (h)', 'heures', { type: 'number', required: true, attrs: 'min="1" step="0.5"' })}${field('Capacité', 'capacite', { type: 'number', value: 30, attrs: 'min="1"' })}${field('Lieu', 'lieu')}${field('Formateur', 'formateur_id', { options: R.formateurs.map((f) => [f.id, `${f.nom} — ${f.organisme || ''}`]) })}${field('Description', 'description', { type: 'textarea' })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Créer</button></div></form>`);
};
actions['form-new'] = () => {
  forms['form-new'] = async (d) => { await api('/formateurs', 'POST', d); state.refs = await api('/refs'); closeModal(); toast('Formateur ajouté'); refresh(); };
  modal('Ajouter un formateur / partenaire', h`<form data-form="form-new">${field('Nom', 'nom', { required: true })}${field('Organisme', 'organisme')}${field('Spécialité', 'specialite')}${field('Courriel', 'email', { type: 'email' })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Ajouter</button></div></form>`);
};

let curTraining = null;
export async function trainingDetail(root, id) {
  const t = await api('/trainings/' + id); const R = state.refs; curTraining = t.id;
  const ins = t.inscriptions; const pres = ins.filter((x) => x.statut === 'present').length; const notes = ins.filter((x) => x.note_satisfaction).map((x) => x.note_satisfaction);
  const open = !['terminee', 'annulee'].includes(t.statut); const started = ['en_cours', 'terminee'].includes(t.statut);
  root.innerHTML = String(h`<div class="page-h"><div><h1>${t.titre}</h1><p class="muted">${t.domaine} · ${fmtDate(t.date_debut)} → ${fmtDate(t.date_fin)} · ${t.heures} h · ${t.formateur || 'formateur à définir'} · ${t.lieu || ''}</p></div><div class="row">${badge(t.statut)}${t.statut === 'planifiee' ? h`<button class="ghost" data-act="tr-status" data-s="en_cours">Démarrer</button>` : ''}${t.statut === 'en_cours' ? h`<button class="ghost" data-act="tr-status" data-s="terminee">Clôturer</button>` : ''}${open ? h`<button class="ghost" data-act="tr-status" data-s="annulee">Annuler</button>` : ''}</div></div>
  <div class="tiles"><div class="tile"><div class="t-label">Inscrits</div><div class="t-value">${ins.length} <small>/ ${t.capacite}</small></div></div><div class="tile"><div class="t-label">Confirmés</div><div class="t-value">${ins.filter((x) => ['confirme', 'present'].includes(x.statut)).length}</div></div><div class="tile"><div class="t-label">Présents</div><div class="t-value">${pres}</div></div><div class="tile"><div class="t-label">Satisfaction</div><div class="t-value">${notes.length ? (notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(2) : '—'} <small>/ 5</small></div></div></div>
  ${open ? h`<form class="card" data-form="convoke"><h3>Cibler et convoquer</h3><div class="formgrid">${field('Corps', 'corps', { options: R.corps })}${field('Grade', 'grade', { options: R.grades })}${field('Territoire', 'localisation', { options: R.localisations })}${field('Service', 'service_id', { options: R.services.map((s) => [s.id, `${s.nom} — ${s.division}`]) })}</div><p class="note" id="preview">Laissez les critères vides pour cibler tous les fonctionnaires non encore inscrits (dans la limite des places libres).</p><div class="actions"><button type="button" class="ghost" data-act="conv-preview">Aperçu du ciblage</button><button class="primary" type="submit">Envoyer les convocations</button></div></form>` : ''}
  <section class="card"><h3>Inscriptions & émargement</h3><div class="tscroll"><table class="t"><thead><tr><th>Fonctionnaire</th><th>Service</th><th>Statut</th><th>Note</th><th>Émargement</th></tr></thead><tbody>${ins.map((x) => h`<tr><td><a href="#/fonctionnaires/${x.employee_id}">${x.prenom} ${x.nom}</a></td><td>${x.service}</td><td>${badge(x.statut)}</td><td>${x.note_satisfaction ?? '—'}</td><td class="nowrap">${started ? h`<button class="mini ok" data-act="att" data-id="${x.id}" data-p="1">Présent</button><button class="mini ko" data-act="att" data-id="${x.id}" data-p="0">Absent</button>` : '—'}</td></tr>`)}${ins.length ? '' : cancelRow(5)}</tbody></table></div></section>`);
}
forms.convoke = async (d, f) => { const r = await api(`/trainings/${curTraining}/convoke`, 'POST', { criteres: d }); toast(`${r.convoques} convocation(s) envoyée(s)`); refresh(); };
actions['conv-preview'] = async (el) => { const f = el.closest('form'); const d = Object.fromEntries([...new FormData(f)].filter(([, v]) => v !== '')); const r = await api(`/trainings/${curTraining}/convoke`, 'POST', { criteres: d, apercu: true }); document.getElementById('preview').textContent = `${r.eligibles} fonctionnaire(s) ciblé(s) — ${r.places_libres} place(s) libre(s).`; };
actions['tr-status'] = async (el) => { await api(`/trainings/${curTraining}/status`, 'POST', { statut: el.dataset.s }); refresh(); };
actions.att = async (el) => { await api(`/enrollments/${el.dataset.id}/attendance`, 'POST', { present: el.dataset.p === '1' }); refresh(); };

// ------------------------------------------------------------ Recrutements
export async function recruitments(root) {
  const list = await api('/recruitments');
  const act = (r) => r.statut === 'candidature' ? h`<button class="mini" data-act="rec-offer" data-id="${r.id}">Émettre l'offre</button>` : r.statut === 'emise' ? h`<button class="mini ok" data-act="rec-out" data-id="${r.id}" data-ok="1">Acceptée</button><button class="mini ko" data-act="rec-out" data-id="${r.id}" data-ok="0">Refusée</button>` : r.statut === 'acceptee' && r.source === 'externe' && !r.employee_id ? h`<a class="btn mini" href="#/fonctionnaires/nouveau?recruitment=${r.id}">Intégrer</a>` : '';
  root.innerHTML = String(h`<div class="page-h"><div><h1>Recrutements & intégrations</h1><p class="muted">Suivi des candidatures, offres et coûts — alimente les indicateurs de recrutement</p></div><button class="primary" data-act="rec-new">+ Nouvelle candidature</button></div>
  <div class="card"><div class="tscroll"><table class="t"><thead><tr><th>Candidat</th><th>Poste</th><th>Source</th><th>Candidature</th><th>Offre</th><th>Acceptation</th><th>Coût</th><th>Statut</th><th></th></tr></thead><tbody>
  ${list.map((r) => h`<tr><td>${r.candidat}</td><td>${r.poste}</td><td>${r.source}</td><td>${fmtDate(r.date_candidature)}</td><td>${fmtDate(r.date_offre)}</td><td>${fmtDate(r.date_acceptation)}</td><td>${num(r.cout)} MAD</td><td>${badge(r.statut)}${r.employee_id ? h`<br><a href="#/fonctionnaires/${r.employee_id}"><small>PPR ${r.ppr}</small></a>` : ''}</td><td class="nowrap">${act(r)}</td></tr>`)}</tbody></table></div></div>`);
}
const today = () => state.today;
actions['rec-new'] = () => {
  forms['rec-new'] = async (d) => { await api('/recruitments', 'POST', d); closeModal(); toast('Candidature enregistrée'); refresh(); };
  modal('Nouvelle candidature', h`<form data-form="rec-new">${field('Candidat', 'candidat', { required: true })}${field('Poste', 'poste', { required: true })}${field('Source', 'source', { options: [['externe', 'Recrutement externe'], ['interne', 'Promotion / nomination interne']], required: true })}${field('Date de candidature', 'date_candidature', { type: 'date', value: today(), required: true })}${field('Coût de la procédure (MAD)', 'cout', { type: 'number', attrs: 'min="0"' })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`);
};
actions['rec-offer'] = (el) => {
  forms['rec-offer'] = async (d) => { await api(`/recruitments/${el.dataset.id}/offer`, 'POST', d); closeModal(); refresh(); };
  modal("Émettre l'offre", h`<form data-form="rec-offer">${field("Date de l'offre", 'date_offre', { type: 'date', value: today(), required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Valider</button></div></form>`);
};
actions['rec-out'] = (el) => {
  if (el.dataset.ok === '0') { api(`/recruitments/${el.dataset.id}/outcome`, 'POST', { accepted: false }).then(refresh).catch((e) => toast(e.message, 'ko')); return; }
  forms['rec-out'] = async (d) => { await api(`/recruitments/${el.dataset.id}/outcome`, 'POST', { accepted: true, ...d }); closeModal(); refresh(); };
  modal("Acceptation de l'offre", h`<form data-form="rec-out">${field("Date d'acceptation", 'date_acceptation', { type: 'date', value: today(), required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Valider</button></div></form>`);
};

// ------------------------------------------------------------ E-services
const DOCS = [['travail', '📄', 'Attestation de travail', 'Délivrée immédiatement'], ['salaire', '💰', 'Attestation de salaire', 'Délivrée immédiatement'], ['mission', '🚗', 'Ordre de mission', 'Signature de la DRH'], ['conge', '🏖️', 'Titre de congé', 'Signature de la DRH']];
const targetId = () => document.querySelector('[data-picker] input[type=hidden]')?.value || undefined;
export async function eservices(root) {
  const u = state.user; const list = await api('/attestations');
  root.innerHTML = String(h`<div class="page-h"><div><h1>E-services & documents administratifs</h1><p class="muted">Documents signés électroniquement et vérifiables par code de référence</p></div></div>
  ${isHr() ? h`<section class="card"><h3>Émettre pour un fonctionnaire</h3><p class="note">Sélectionnez un fonctionnaire pour émettre à sa place, ou laissez vide pour votre propre dossier.</p>${empPicker()}</section>` : ''}
  <div class="doc-tiles">${DOCS.map(([k, ic, l, s]) => h`<button class="doc-tile" data-act="doc-req" data-k="${k}" ${raw(!u.employee_id && !isHr() ? 'disabled' : '')}><span class="ic" aria-hidden="true">${ic}</span><b>${l}</b><small>${s}</small></button>`)}</div>
  <div class="card"><div class="tscroll"><table class="t"><thead><tr>${isHr() ? h`<th>Fonctionnaire</th>` : ''}<th>Document</th><th>Demandé le</th><th>Statut</th><th>Référence</th><th></th></tr></thead><tbody>
  ${list.map((a) => h`<tr>${isHr() ? h`<td>${empLink(a)}</td>` : ''}<td>${DOCS.find((d) => d[0] === a.type)?.[2]}</td><td>${fmtDt(a.requested_at)}</td><td>${badge(a.statut)}${a.signed_at ? h`<br><small class="muted">${fmtDt(a.signed_at)}</small>` : ''}</td><td><code>${a.code}</code></td><td class="nowrap">${a.statut === 'signee' ? h`<a class="btn mini primary" href="/doc/${a.id}.pdf">PDF</a><a class="btn mini" href="/doc/${a.id}" target="_blank" rel="noopener">Aperçu / imprimer</a>` : isHr() ? h`<button class="mini ok" data-act="doc-sign" data-id="${a.id}">Signer</button>` : ''}</td></tr>`)}
  ${list.length ? '' : cancelRow(6)}</tbody></table></div></div>`);
}
actions['doc-req'] = async (el) => {
  const type = el.dataset.k; const employee_id = targetId() ? Number(targetId()) : undefined;
  const send = async (extra = {}) => { const r = await api('/attestations', 'POST', { type, employee_id, ...extra }); closeModal(); toast(r.statut === 'signee' ? 'Document généré' : 'Demande transmise à la DRH pour signature'); if (r.statut === 'signee') window.open(`/doc/${r.id}`, '_blank', 'noopener'); refresh(); };
  if (type === 'travail' || type === 'salaire') return send();
  if (type === 'mission') { forms.mission = (d) => send(d); modal('Ordre de mission', h`<form data-form="mission">${field('Destination', 'destination', { required: true })}${field('Objet de la mission', 'objet', { required: true, type: 'textarea' })}${field('Du', 'date_debut', { type: 'date', required: true })}${field('Au', 'date_fin', { type: 'date', required: true })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Demander</button></div></form>`); return; }
  const lv = (await api('/leaves?statut=valide')).filter((l) => (employee_id ? l.employee_id === employee_id : l.employee_id === state.user.employee_id));
  if (!lv.length) throw new Error('Aucun congé validé pour ce fonctionnaire');
  forms.conge = (d) => send({ leave_id: Number(d.leave_id) });
  modal('Titre de congé', h`<form data-form="conge">${field('Congé validé', 'leave_id', { required: true, options: lv.slice(0, 40).map((l) => [l.id, `${fmtDate(l.date_debut)} → ${fmtDate(l.date_fin)} (${l.jours} j)`]) })}<div class="actions"><button type="button" class="ghost" data-act="close-modal">Annuler</button><button class="primary" type="submit">Demander</button></div></form>`);
};
actions['doc-sign'] = async (el) => { await api(`/attestations/${el.dataset.id}/sign`, 'POST'); toast('Document signé électroniquement'); refresh(); };

// ------------------------------------------------------------ Notifications
export async function notifications(root) {
  const list = await api('/notifications'); await api('/notifications/read', 'POST'); document.getElementById('badge-n')?.remove();
  root.innerHTML = String(h`<div class="page-h"><h1>Notifications</h1></div><div class="card"><ul class="notifs">${list.map((n) => h`<li class="${n.lu ? '' : 'new'}"><div>${n.lien ? h`<a href="${n.lien}">${n.message}</a>` : n.message}</div><small class="muted">${fmtDt(n.created_at)}</small></li>`)}${list.length ? '' : h`<li class="muted">Aucune notification.</li>`}</ul></div>`);
}
