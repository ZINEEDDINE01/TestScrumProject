'use strict';
// Calcul des indicateurs du tableau de bord exécutif (formules du cahier des charges).
const U = require('./util');
const R = require('./rules');

const pct = (n, d, dec = 1) => (d > 0 ? Math.round((n / d) * 100 * 10 ** dec) / 10 ** dec : null);
const avg = (a, dec = 1) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10 ** dec) / 10 ** dec : null);
const count = (a, f) => a.filter(f).length;
const group = (a, f) => { const m = new Map(); for (const x of a) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
const rows = (m, order) => { const r = [...m].map(([label, value]) => ({ label, value })); return order ? r.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)) : r.sort((a, b) => b.value - a.value); };

const FORMULES = [
  { id: 'absenteisme', nom: "Taux d'absentéisme", formule: "(Nombre total d'absences / Nombre total de jours ouvrés) × 100", note: "Absences = journées ouvrées d'absence dont la justification n'est pas validée par la DRH ; le taux d'absences total (justifiées incluses) est affiché en complément. Les congés ne sont pas des absences." },
  { id: 'turnover', nom: 'Turnover (attrition)', formule: "(Employés ayant quitté pendant la période / Nombre moyen d'employés) × 100", note: "Période = année en cours ; nombre moyen = (effectif début + effectif fin) / 2." },
  { id: 'retention', nom: 'Rétention des employés', formule: '((Employés en fin de période − Nouveaux embauchés) / Employés en début de période) × 100', note: 'Période = année en cours.' },
  { id: 'promo', nom: 'Taux de promotion interne', formule: '(Postes pourvus par promotion interne / Nombre total de postes pourvus) × 100', note: "Postes pourvus de l'année : nominations internes + recrutements externes acceptés." },
  { id: 'cout', nom: 'Coût par embauche', formule: '(Coût total de recrutement interne + externe) / Nombre total d\'embauches', note: "Coûts des procédures de l'année, y compris celles sans embauche ; embauches = postes pourvus." },
  { id: 'delai', nom: 'Délai de recrutement', formule: "Σ (Date d'acceptation de l'offre − Date de candidature) / Nombre d'embauches", note: 'En jours calendaires.' },
  { id: 'acceptation', nom: "Taux d'acceptation des offres", formule: '(Offres acceptées / Offres émises) × 100', note: "Offres émises dans l'année (en cours incluses)." },
  { id: 'heures', nom: 'Heures de formation par fonctionnaire', formule: "Nombre total d'heures de formation / Nombre d'employés à temps plein", note: "Heures effectivement suivies (présence émargée) sur l'année." },
  { id: 'attrition12', nom: "Taux d'attrition sur 1 an", formule: "(Employés ayant quitté dans l'année / Effectif total pendant l'année) × 100", note: "12 mois glissants ; effectif total = effectif d'il y a 12 mois + embauches de la période." },
  { id: 'ratiorh', nom: 'Ratio RH / employé', formule: "Nombre total de personnel RH / Nombre total d'employés", note: 'Personnel RH = agents de la Division des Ressources Humaines.' },
  { id: 'retention12', nom: 'Taux de rétention sur 1 an', formule: '(Employés restés 1 an / Total des embauches pendant la période) × 100', note: "Cohorte des embauches de la période [−24 mois ; −12 mois], vérifiée un an après leur prise de service." },
];

function dashboard(db, today = U.today()) {
  const Y = Number(today.slice(0, 4)); const yStart = `${Y}-01-01`; const mStart = today.slice(0, 7) + '-01';
  const all = db.prepare('SELECT e.*, s.nom service, s.division, s.localisation, s.type_entite FROM employees e LEFT JOIN services s ON s.id=e.service_id').all();
  const act = all.filter((e) => e.statut === 'actif');
  const eff = (d) => count(all, (e) => e.date_recrutement <= d && (!e.date_depart || e.date_depart > d));
  const leaves = db.prepare("SELECT * FROM leaves WHERE statut='valide'").all();
  const abs = db.prepare('SELECT * FROM absences').all();
  const age = (e, at = today) => U.yearsBetween(e.date_naissance, at);

  // ---- Assiduité
  const absDays = (a, b, f) => abs.filter(f || (() => true)).reduce((s, x) => s + U.overlapWork(x.date_debut, x.date_fin, a, b), 0);
  const leaveDays = (a, b) => leaves.reduce((s, x) => s + U.overlapWork(x.date_debut, x.date_fin, a, b), 0);
  const notJust = (x) => x.statut_justif !== 'validee';
  const win = (a, b) => {
    const jo = U.workdays(a, b); const E = act.length || 1; const base = E * jo;
    const nj = absDays(a, b, notJust); const tot = absDays(a, b); const cg = leaveDays(a, b);
    return { jours_ouvres: jo, abs_non_justifiees: nj, abs_total: tot, conges: cg, absenteisme: pct(nj, base, 2), absences_totales: pct(tot, base, 2), presence: base ? Math.round((100 - ((tot + cg) / base) * 100) * 10) / 10 : null };
  };
  const mois = win(mStart, today), annee = win(yStart, today);
  const trend = [];
  for (let m = 1; m <= Number(today.slice(5, 7)); m++) { const a = `${Y}-${String(m).padStart(2, '0')}-01`; const b0 = U.addDays(U.addMonths(a, 1), -1); const w = win(a, b0 > today ? today : b0); trend.push({ mois: m, absenteisme: w.absenteisme, totales: w.absences_totales }); }
  const absentToday = new Set();
  if (U.isWorkday(today)) { for (const l of leaves) if (l.date_debut <= today && l.date_fin >= today) absentToday.add(l.employee_id); for (const a of abs) if (a.date_debut <= today && a.date_fin >= today) absentToday.add(a.employee_id); }
  const svcMap = new Map();
  for (const e of act) { const k = e.service_id; const s = svcMap.get(k) || { service: e.service, division: e.division, localisation: e.localisation, effectif: 0, presents: 0 }; s.effectif++; if (!absentToday.has(e.id)) s.presents++; svcMap.set(k, s); }
  const couverture = [...svcMap.values()].map((s) => ({ ...s, taux: pct(s.presents, s.effectif, 0) })).sort((a, b) => a.taux - b.taux || a.service.localeCompare(b.service));
  const presentsToday = act.length - count(act, (e) => absentToday.has(e.id));
  const soldeMoyen = avg(act.map((e) => e.solde_conges));

  // ---- Effectifs
  const tranches = [[20, 29], [30, 39], [40, 49], [50, 59], [60, 70]];
  const pyramide = tranches.map(([a, b]) => ({ tranche: `${a}-${b}`, F: count(act, (e) => e.sexe === 'F' && age(e) >= a && age(e) < b + 1), H: count(act, (e) => e.sexe === 'H' && age(e) >= a && age(e) < b + 1) }));
  const retraites = [1, 2, 3, 4, 5].map((n) => ({ horizon: n, value: count(act, (e) => { const left = R.AGE_RETRAITE - age(e); return left > n - 1 && left <= n; })}));
  const retraitesCum = retraites.map((r, i) => ({ ...r, cumul: retraites.slice(0, i + 1).reduce((s, x) => s + x.value, 0) }));
  const anc = [['< 5 ans', 0, 5], ['5-10 ans', 5, 10], ['10-20 ans', 10, 20], ['20-30 ans', 20, 30], ['≥ 30 ans', 30, 99]].map(([label, a, b]) => ({ label, value: count(act, (e) => { const y = U.yearsBetween(e.date_recrutement, today); return y >= a && y < b; }) }));
  const entiteLabel = { service: 'Services centraux & provinciaux', annexe: 'Annexes administratives', caidat: 'Caïdats' };
  const byEntite = rows(group(act, (e) => (e.division === 'Pachalik de Dakhla' && e.type_entite !== 'annexe' ? 'Pachalik de Dakhla (services)' : entiteLabel[e.type_entite] || e.type_entite)));
  const effectifs = {
    total: act.length,
    byDivision: rows(group(act, (e) => e.division)),
    byLocalisation: rows(group(act, (e) => e.localisation)),
    byEntite,
    byCorps: rows(group(act, (e) => e.corps)),
    pyramide, retraites: retraitesCum, anciennete: anc,
    feminisation: pct(count(act, (e) => e.sexe === 'F'), act.length), femmes: count(act, (e) => e.sexe === 'F'), hommes: count(act, (e) => e.sexe === 'H'),
    cadres_sup: count(act, (e) => e.cadre_sup), cadres_sup_pct: pct(count(act, (e) => e.cadre_sup), act.length),
    cadres_femmes_pct: pct(count(act, (e) => e.cadre_sup && e.sexe === 'F'), count(act, (e) => e.cadre_sup)),
    age_moyen: avg(act.map((e) => age(e))), anciennete_moyenne: avg(act.map((e) => U.yearsBetween(e.date_recrutement, today))),
  };

  // ---- Mouvements du personnel (turnover, rétention, attrition)
  const effDebut = eff(U.addDays(yStart, -1)); const effFin = eff(today);
  const departs = count(all, (e) => e.date_depart && e.date_depart >= yStart && e.date_depart <= today);
  const embauches = count(all, (e) => e.date_recrutement >= yStart && e.date_recrutement <= today);
  const d12 = U.addDays(today, -365); const effD12 = eff(d12);
  const departs12 = count(all, (e) => e.date_depart && e.date_depart > d12 && e.date_depart <= today);
  const emb12 = count(all, (e) => e.date_recrutement > d12 && e.date_recrutement <= today);
  const coh = all.filter((e) => e.date_recrutement > U.addDays(today, -730) && e.date_recrutement <= d12);
  const cohRestes = count(coh, (e) => !e.date_depart || e.date_depart >= U.addDays(e.date_recrutement, 365));
  const mouvements = [];
  for (let m = 1; m <= Number(today.slice(5, 7)); m++) { const p = `${Y}-${String(m).padStart(2, '0')}`; mouvements.push({ mois: m, entrees: count(all, (e) => e.date_recrutement.startsWith(p)), sorties: count(all, (e) => e.date_depart && e.date_depart.startsWith(p)) }); }
  const motifs = rows(group(all.filter((e) => e.date_depart && e.date_depart >= yStart), (e) => e.motif_depart));
  const rh = {
    effectif_debut: effDebut, effectif_fin: effFin, embauches, departs,
    turnover: pct(departs, (effDebut + effFin) / 2),
    retention: pct(effFin - embauches, effDebut),
    attrition_12m: pct(departs12, effD12 + emb12), departs_12m: departs12,
    retention_1an: pct(cohRestes, coh.length), cohorte: coh.length,
    personnel_rh: count(act, (e) => e.division === 'Division des Ressources Humaines'),
    ratio_rh: Math.round((count(act, (e) => e.division === 'Division des Ressources Humaines') / act.length) * 1000) / 1000,
    mouvements, motifs,
  };

  // ---- Recrutement
  const rec = db.prepare('SELECT * FROM recruitments').all();
  const recY = rec.filter((r) => r.date_candidature >= yStart || (r.date_acceptation && r.date_acceptation >= yStart));
  const pourvus = rec.filter((r) => r.statut === 'acceptee' && r.date_acceptation >= yStart && r.date_acceptation <= today);
  const offres = rec.filter((r) => r.date_offre && r.date_offre >= yStart && r.date_offre <= today);
  const recrutement = {
    postes_pourvus: pourvus.length, offres_emises: offres.length, offres_acceptees: count(offres, (r) => r.statut === 'acceptee'),
    taux_acceptation: pct(count(offres, (r) => r.statut === 'acceptee'), offres.length),
    taux_promotion_interne: pct(count(pourvus, (r) => r.source === 'interne'), pourvus.length),
    pourvus_internes: count(pourvus, (r) => r.source === 'interne'), pourvus_externes: count(pourvus, (r) => r.source === 'externe'),
    cout_total: Math.round(recY.reduce((s, r) => s + r.cout, 0)),
    cout_par_embauche: pourvus.length ? Math.round(recY.reduce((s, r) => s + r.cout, 0) / pourvus.length) : null,
    delai_moyen_jours: avg(pourvus.map((r) => U.diffDays(r.date_candidature, r.date_acceptation))),
  };

  // ---- Carrière
  const pr = db.prepare('SELECT * FROM promotions WHERE annee=?').all(Y);
  const val = pr.filter((p) => p.statut === 'valide');
  const carriere = {
    eligibles: pr.length, valides: val.length, rejetes: count(pr, (p) => p.statut === 'rejete'), en_attente: count(pr, (p) => p.statut === 'propose'),
    taux_realisation: pct(val.length, pr.length),
    delai_moyen_jours: avg(val.map((p) => U.diffDays(p.opened_at, p.decided_at)), 0),
    echelon: { eligibles: count(pr, (p) => p.type === 'echelon'), valides: count(val, (p) => p.type === 'echelon') },
    grade: { eligibles: count(pr, (p) => p.type === 'grade'), valides: count(val, (p) => p.type === 'grade') },
  };

  // ---- Formation
  const tr = db.prepare('SELECT * FROM trainings').all(); const en = db.prepare('SELECT * FROM enrollments').all();
  const trY = new Map(tr.filter((t) => t.date_debut >= yStart && t.date_debut <= today).map((t) => [t.id, t]));
  const presents = en.filter((x) => x.statut === 'present' && trY.has(x.training_id));
  const actIds = new Set(act.map((e) => e.id));
  const dist = new Set(presents.filter((x) => actIds.has(x.employee_id)).map((x) => x.employee_id));
  const heures = presents.reduce((s, x) => s + trY.get(x.training_id).heures, 0);
  const tp = count(act, (e) => e.temps_plein) || 1;
  const cours = tr.filter((t) => t.statut === 'en_cours');
  const notes = presents.filter((x) => x.note_satisfaction).map((x) => x.note_satisfaction);
  const domaine = new Map(); for (const x of presents) { const d = trY.get(x.training_id).domaine; domaine.set(d, (domaine.get(d) || 0) + trY.get(x.training_id).heures); }
  const formation = {
    sessions_en_cours: cours.length, inscrits_en_cours: count(en, (x) => cours.some((t) => t.id === x.training_id)),
    sessions_planifiees: count(tr, (t) => t.statut === 'planifiee'), sessions_terminees: count(tr, (t) => t.statut === 'terminee'),
    participation: pct(dist.size, act.length), beneficiaires: dist.size,
    satisfaction: avg(notes, 2), evaluations: notes.length,
    heures_total: heures, heures_par_employe: Math.round((heures / tp) * 10) / 10,
    heures_par_domaine: rows(domaine),
  };

  // ---- E-services
  const att = db.prepare('SELECT * FROM attestations').all();
  const attM = att.filter((a) => a.requested_at.slice(0, 10) >= mStart);
  const hrs = (a) => (new Date(a.signed_at + 'Z') - new Date(a.requested_at + 'Z')) / 3600e3;
  const NOMS_ATT = { travail: 'Attestation de travail', salaire: 'Attestation de salaire', mission: 'Ordre de mission', conge: 'Titre de congé' };
  const eservices = {
    volume_mois: attM.length, volume_annee: count(att, (a) => a.requested_at >= yStart),
    par_type: rows(group(attM, (a) => NOMS_ATT[a.type] || a.type)),
    delai_moyen_heures: avg(attM.filter((a) => a.signed_at).map(hrs)), en_attente: count(att, (a) => a.statut === 'en_attente'),
    part_automatique: pct(count(attM, (a) => a.type === 'travail' || a.type === 'salaire'), attM.length, 0),
  };

  return {
    as_of: today, annee: Y,
    entete: { effectif: act.length, presence_mois: mois.presence, presents_aujourdhui: presentsToday, taux_presence_aujourdhui: pct(presentsToday, act.length), sessions_en_cours: formation.sessions_en_cours, inscrits_en_cours: formation.inscrits_en_cours },
    effectifs, assiduite: { mois, annee, trend, solde_moyen: soldeMoyen, couverture, absents_aujourdhui: act.length - presentsToday },
    rh, recrutement, carriere, formation, eservices, formules: FORMULES,
  };
}

module.exports = { dashboard, FORMULES };
