'use strict';
// Règles métier RH : grades, échelons, éligibilité aux avancements, salaire indicatif.
const U = require('./util');

const CORPS = {
  'Adjoint administratif': { echelle: '8', diplome: 'Baccalauréat' },
  'Rédacteur': { echelle: '9', diplome: 'Licence' },
  'Technicien': { echelle: '9', diplome: 'Diplôme de technicien spécialisé' },
  'Administrateur': { echelle: '10', diplome: 'Master' },
  'Ingénieur': { echelle: '11', diplome: "Diplôme d'ingénieur d'État" },
};
const GRADES = ['3ème grade', '2ème grade', '1er grade', 'Grade principal'];
const ECHELLES = ['8', '9', '10', '11', 'HE'];
const ECHELON_MAX = 10;
const AGE_RETRAITE = 63;
const SOLDE_ANNUEL = 22;
const nextGrade = (g) => GRADES[GRADES.indexOf(g) + 1] || null;

const BASE = { 8: 3100, 9: 3600, 10: 4600, 11: 5800, HE: 9500 };
const PAS = { 8: 120, 9: 150, 10: 200, 11: 260, HE: 400 };
// Traitement de base mensuel indicatif (à remplacer par la rubrique de paie réelle)
const salaireBrut = (e) => BASE[e.echelle] + (e.echelon - 1) * PAS[e.echelle];

function loadRules(db) {
  const echelon = Object.fromEntries(db.prepare('SELECT * FROM regles_echelon').all().map((r) => [r.rythme, r]));
  const grade = db.prepare('SELECT * FROM regles_grade ORDER BY id').all();
  return { echelon, grade };
}

// Éligibilité d'un fonctionnaire à l'avancement d'échelon et de grade à la date `at`.
function eligibility(e, rules, at = U.today()) {
  const out = { echelon: null, grade: null };
  if (e.echelon < ECHELON_MAX) {
    const duree = rules.echelon[e.rythme]?.duree_mois ?? 30;
    const due = U.addMonths(e.date_dernier_echelon, duree);
    out.echelon = { de: e.echelon, a: e.echelon + 1, date_eligibilite: due, eligible: due <= at, rythme: e.rythme, duree_mois: duree };
  }
  const ng = nextGrade(e.grade);
  if (ng) {
    const r = rules.grade.find((x) => x.grade_from === e.grade && x.mode === 'choix') || rules.grade.find((x) => x.grade_from === e.grade);
    if (r) {
      const due = U.addMonths(e.date_dernier_grade, Math.round(r.anciennete_min_ans * 12));
      out.grade = { de: e.grade, a: ng, date_eligibilite: due, eligible: due <= at && e.echelon >= r.echelon_min, mode: r.mode, quota_pct: r.quota_pct, echelon_min: r.echelon_min };
    }
  }
  return out;
}

// Génère les propositions d'avancement (échelon: tous les éligibles ; grade au choix: dans la limite du quota).
function generatePromotions(db, at = U.today()) {
  const rules = loadRules(db);
  const year = Number(at.slice(0, 4));
  const emps = db.prepare("SELECT * FROM employees WHERE statut='actif'").all();
  const existing = db.prepare("SELECT employee_id, type FROM promotions WHERE annee=? OR statut='propose'").all(year);
  const has = new Set(existing.map((p) => p.employee_id + ':' + p.type));
  const cap = db.prepare("SELECT id FROM caps WHERE statut='planifiee' AND date_session>=? ORDER BY date_session LIMIT 1").get(at);
  const ins = db.prepare('INSERT INTO promotions (employee_id,type,de_valeur,a_valeur,mode,cap_id,statut,opened_at,annee) VALUES (?,?,?,?,?,?,?,?,?)');
  let nEch = 0, nGr = 0;
  const gradeCand = {};
  for (const e of emps) {
    const el = eligibility(e, rules, at);
    if (el.echelon?.eligible && !has.has(e.id + ':echelon')) { ins.run(e.id, 'echelon', String(el.echelon.de), String(el.echelon.a), el.echelon.rythme, null, 'propose', at, year); nEch++; }
    if (el.grade?.eligible && el.grade.mode === 'choix' && !has.has(e.id + ':grade')) (gradeCand[e.grade] ||= []).push({ e, el: el.grade });
  }
  for (const [g, list] of Object.entries(gradeCand)) {
    const total = emps.filter((x) => x.grade === g).length; // assiette du quota = effectif du grade
    const quota = Math.max(1, Math.floor(total * list[0].el.quota_pct / 100));
    list.sort((a, b) => a.el.date_eligibilite.localeCompare(b.el.date_eligibilite) || a.e.date_recrutement.localeCompare(b.e.date_recrutement));
    for (const { e, el } of list.slice(0, quota)) { ins.run(e.id, 'grade', el.de, el.a, 'choix', cap?.id ?? null, 'propose', at, year); nGr++; }
  }
  return { echelon: nEch, grade: nGr };
}

// Applique une promotion validée au dossier du fonctionnaire.
function applyPromotion(db, p, at = U.today()) {
  if (p.type === 'echelon') db.prepare('UPDATE employees SET echelon=?, date_dernier_echelon=? WHERE id=?').run(Number(p.a_valeur), at, p.employee_id);
  else db.prepare('UPDATE employees SET grade=?, date_dernier_grade=? WHERE id=?').run(p.a_valeur, at, p.employee_id);
}

module.exports = { CORPS, GRADES, ECHELLES, ECHELON_MAX, AGE_RETRAITE, SOLDE_ANNUEL, nextGrade, salaireBrut, loadRules, eligibility, generatePromotions, applyPromotion };
