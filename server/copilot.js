'use strict';
// Copilote décisionnel : analyse par règles et seuils paramétrables (aucun LLM, aucun apprentissage automatique).
// Chaque recommandation est explicable (méthode, données, seuils) et n'est exécutée qu'après validation humaine.
const U = require('./util');
const R = require('./rules');

const SEUILS = { absence_min_jours: 10, absence_ratio_moyenne: 3, absence_taux_min: 5, cap_min_dossiers: 5, formation_part_non_formes: 30, retraites_min_service: 2, duree_renfort_jours: 30 };
const PRIORITE = { HAUTE: { rang: 0, label: 'Priorité haute', badge: 'haute' }, MOYENNE: { rang: 1, label: 'Priorité moyenne', badge: 'moyenne' }, OPTIMISATION: { rang: 2, label: 'Optimisation', badge: 'optim' } };
const now = () => new Date().toISOString().slice(0, 19);

async function revertExpired(db, today = U.today()) {
  const exp = await db.prepare("SELECT * FROM affectations_temporaires WHERE statut='en_cours' AND date_fin < ?").all(today);
  for (const a of exp) { await db.prepare('UPDATE employees SET service_id=? WHERE id=?').run(a.service_origine, a.employee_id); await db.prepare("UPDATE affectations_temporaires SET statut='terminee' WHERE id=?").run(a.id); }
  return exp.length;
}

async function absRate(db, serviceId, a, b, effectif) {
  const rows = await db.prepare('SELECT x.date_debut, x.date_fin FROM absences x JOIN employees e ON e.id=x.employee_id WHERE e.service_id=? AND e.statut=\'actif\' AND x.date_fin>=? AND x.date_debut<=?').all(serviceId, a, b);
  const days = rows.reduce((s, x) => s + U.overlapWork(x.date_debut, x.date_fin, a, b), 0);
  const base = effectif * U.workdays(a, b);
  return { days, rate: base ? (days / base) * 100 : 0 };
}

async function candidates(db, today) {
  const Y = today.slice(0, 4); const out = [];
  const svcs = await db.prepare("SELECT s.*, (SELECT COUNT(*) FROM employees e WHERE e.service_id=s.id AND e.statut='actif') eff FROM services s").all();
  const totalEff = svcs.reduce((s, x) => s + x.eff, 0) || 1;
  const w1 = [U.addDays(today, -29), today], w0 = [U.addDays(today, -59), U.addDays(today, -30)];
  const all = await Promise.all(svcs.map(async (s) => ({ s, cur: await absRate(db, s.id, w1[0], w1[1], s.eff), prev: await absRate(db, s.id, w0[0], w0[1], s.eff) })));
  const avgRate = (all.reduce((t, x) => t + x.cur.days, 0) / (totalEff * U.workdays(w1[0], w1[1]))) * 100;
  const retire = (await db.prepare("SELECT id, service_id, date_naissance FROM employees WHERE statut='actif'").all()).filter((e) => { const left = R.AGE_RETRAITE - U.yearsBetween(e.date_naissance, today); return left > 0 && left <= 1; });
  const retireBy = new Map(); for (const e of retire) retireBy.set(e.service_id, (retireBy.get(e.service_id) || 0) + 1);

  // 1. Pic d'absentéisme dans une entité -> renfort temporaire
  for (const { s, cur, prev } of all) {
    if (s.eff < 8 || cur.days < SEUILS.absence_min_jours || cur.rate < SEUILS.absence_taux_min || cur.rate < SEUILS.absence_ratio_moyenne * avgRate) continue;
    const donors = await db.prepare(`SELECT e.id, e.nom, e.prenom, e.service_id FROM employees e JOIN services d ON d.id=e.service_id WHERE e.statut='actif' AND d.id<>? AND d.localisation=? AND d.division=? AND e.corps IN ('Adjoint administratif','Rédacteur') AND d.chef_id<>e.id
      AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.employee_id=e.id AND a.date_fin>=? ) AND NOT EXISTS (SELECT 1 FROM affectations_temporaires t WHERE t.employee_id=e.id AND t.statut='en_cours') ORDER BY e.id LIMIT 6`).all(s.id, s.localisation, s.division, U.addDays(today, -10));
    if (!donors.length) continue;
    const from = (await db.prepare('SELECT nom FROM services WHERE id=?').get(donors[0].service_id)).nom;
    const n = Math.min(2, donors.length); const hausse = prev.rate > 0 ? Math.round(((cur.rate - prev.rate) / prev.rate) * 100) : null;
    const nRet = retireBy.get(s.id) || 0;
    out.push({
      code: `abs:${s.id}:${today.slice(0, 7)}`, type: "Pic d'absentéisme", priorite: 'HAUTE', service_id: s.id,
      titre: `Pic d'absentéisme — ${s.nom}`,
      diagnostic: `Taux d'absence de ${cur.rate.toFixed(1)} % sur les 30 derniers jours (${cur.days} jours d'absence pour ${s.eff} agents), contre ${avgRate.toFixed(1)} % en moyenne dans la Wilaya.`,
      impact: hausse !== null ? `${hausse >= 0 ? '+' : ''}${hausse} % par rapport aux 30 jours précédents (${prev.rate.toFixed(1)} %).` : `Aucune absence sur les 30 jours précédents.`,
      cause: nRet ? `${nRet} fonctionnaire(s) du service atteignent l'âge de la retraite dans les 12 mois : le service risque d'être en sous-effectif.` : 'Cause non déterminée automatiquement : à vérifier avec le chef de service.',
      recommandation: `Redéployer temporairement ${n} fonctionnaire(s) (${from}, même division) vers « ${s.nom} » pour ${SEUILS.duree_renfort_jours} jours.`,
      action_type: 'redeploy', params: { service_id: s.id, employee_ids: donors.slice(0, n).map((d) => d.id), jours: SEUILS.duree_renfort_jours, max: Math.min(5, donors.length) },
      methode: `Taux = jours d'absence / (effectif × jours ouvrés) sur 30 jours glissants, comparé à la période précédente et à la moyenne régionale. Seuils : ≥ ${SEUILS.absence_taux_min} %, ≥ ${SEUILS.absence_ratio_moyenne}× la moyenne, ≥ ${SEUILS.absence_min_jours} jours. Renforts : adjoints/rédacteurs de la même division et du même territoire, sans absence récente.`,
    });
  }

  // 2. Avancements en attente -> convocation de la CAP
  const pend = await db.prepare("SELECT p.*, e.service_id FROM promotions p JOIN employees e ON e.id=p.employee_id WHERE p.statut='propose' AND p.type='grade'").all();
  if (pend.length >= SEUILS.cap_min_dossiers) {
    const cap = await db.prepare("SELECT * FROM caps WHERE statut='planifiee' AND date_session>=? ORDER BY date_session LIMIT 1").get(today);
    const oldest = pend.reduce((m, p) => (p.opened_at < m ? p.opened_at : m), today); const jours = U.diffDays(oldest, today);
    const lointaine = cap && U.diffDays(today, cap.date_session) > 60;
    out.push({
      code: `cap:${Y}`, type: "Avancements de grade en attente", priorite: !cap || lointaine ? 'HAUTE' : 'MOYENNE', service_id: null,
      titre: `${pend.length} dossiers d'avancement de grade en attente de CAP`,
      diagnostic: `${pend.length} fonctionnaires remplissent les conditions d'avancement au choix (règles paramétrées) ; le plus ancien dossier est ouvert depuis ${jours} jour(s).`,
      impact: cap ? `Prochaine CAP : ${cap.date_session} (dans ${U.diffDays(today, cap.date_session)} jours)${lointaine ? ' — échéance éloignée' : ''}.` : "Aucune CAP planifiée : les dossiers ne peuvent pas être instruits.",
      cause: null,
      recommandation: cap ? `Convoquer officiellement la CAP du ${cap.date_session} et lui rattacher les ${pend.length} dossiers.` : `Planifier une CAP dans 21 jours et lui rattacher les ${pend.length} dossiers.`,
      action_type: 'convoke_cap', params: { cap_id: cap?.id ?? null, dossiers: pend.length },
      methode: `Comptage des propositions de grade au statut « à décider » (seuil : ≥ ${SEUILS.cap_min_dossiers}) et comparaison avec le calendrier des CAP. Le délai légal d'instruction n'est pas modélisé : à paramétrer selon le statut en vigueur.`,
    });
  }

  // 3. Couverture de formation des annexes / caïdats
  const terr = await db.prepare("SELECT e.id, e.service_id FROM employees e JOIN services s ON s.id=e.service_id WHERE e.statut='actif' AND s.type_entite IN ('annexe','caidat')").all();
  const formes = new Set((await db.prepare("SELECT n.employee_id FROM enrollments n JOIN trainings t ON t.id=n.training_id WHERE n.statut='present' AND t.date_debut>=?").all(`${Y}-01-01`)).map((x) => x.employee_id));
  const non = terr.filter((e) => !formes.has(e.id)); const part = terr.length ? Math.round((non.length / terr.length) * 100) : 0;
  const actifsAll = await db.prepare("SELECT id FROM employees WHERE statut='actif'").all(); const allNon = Math.round((actifsAll.filter((e) => !formes.has(e.id)).length / actifsAll.length) * 100);
  if (part >= SEUILS.formation_part_non_formes) {
    out.push({
      code: `form:${Y}-T${Math.ceil(Number(today.slice(5, 7)) / 3)}`, type: 'Couverture de formation', priorite: 'OPTIMISATION', service_id: null,
      titre: 'Formation des annexes et caïdats insuffisante',
      diagnostic: `${part} % des fonctionnaires des annexes et caïdats (${non.length} sur ${terr.length}) n'ont suivi aucune formation en ${Y}.`,
      impact: `${allNon} % de non-formés pour l'ensemble des agents de la Wilaya : les annexes et caïdats sont ${part > allNon ? 'en retrait' : 'dans la moyenne'}.`, cause: null,
      recommandation: `Convoquer le groupe non formé à la session « Numérisation & Accueil Citoyen » (session planifiée, ou création si aucune n'est ouverte).`,
      action_type: 'invite_training', params: { cible: non.length },
      methode: `Part des agents d'annexes/caïdats sans présence émargée à une formation de l'année (seuil : ≥ ${SEUILS.formation_part_non_formes} %). Les invitations sont limitées aux places disponibles.`,
    });
  }

  // 4. Départs à la retraite à anticiper
  for (const [sid, n] of retireBy) {
    if (n < SEUILS.retraites_min_service) continue; const s = svcs.find((x) => x.id === sid);
    out.push({
      code: `ret:${sid}:${Y}`, type: 'Départs à la retraite à remplacer', priorite: 'MOYENNE', service_id: sid,
      titre: `${n} départs à la retraite d'ici 12 mois — ${s.nom}`,
      diagnostic: `${n} agents sur ${s.eff} atteignent ${R.AGE_RETRAITE} ans dans les 12 prochains mois.`, impact: `${Math.round((n / s.eff) * 100)} % de l'effectif du service.`, cause: null,
      recommandation: `Ouvrir ${n} poste(s) à pourvoir pour ${s.nom} afin de préparer la relève.`,
      action_type: 'open_recruitment', params: { service_id: sid, postes: n, max: 10 },
      methode: `Fonctionnaires actifs dont l'âge légal de départ (${R.AGE_RETRAITE} ans) tombe dans les 12 mois ; seuil : ≥ ${SEUILS.retraites_min_service} par service.`,
    });
  }
  return out;
}

async function generate(db, today = U.today()) {
  await revertExpired(db, today);
  const ins = db.prepare('INSERT INTO ai_decisions (code,type_diagnostic,priorite,service_id,titre,diagnostic,impact,cause,recommandation,action_type,params,methode,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (code) DO NOTHING');
  let n = 0; for (const c of await candidates(db, today)) n += Number((await ins.run(c.code, c.type, c.priorite, c.service_id, c.titre, c.diagnostic, c.impact, c.cause, c.recommandation, c.action_type, JSON.stringify(c.params), c.methode, now())).changes);
  return n;
}

async function pending(db) {
  return (await db.prepare("SELECT d.*, s.nom entite, s.division FROM ai_decisions d LEFT JOIN services s ON s.id=d.service_id WHERE d.statut='en_attente'").all())
    .map((d) => ({ ...d, params: JSON.parse(d.params), priorite_info: PRIORITE[d.priorite], entite: d.entite || 'Wilaya (transversal)' }))
    .sort((a, b) => PRIORITE[a.priorite].rang - PRIORITE[b.priorite].rang || a.id - b.id);
}

// Exécution après validation humaine. `adj` = paramètres ajustés (action « Ajuster »).
async function execute(db, d, adj, actor, today = U.today()) {
  const p = { ...d.params, ...(adj || {}) }; const notifyDrh = async (m, l) => { for (const u of await db.prepare("SELECT id FROM users WHERE role='drh'").all()) await db.prepare('INSERT INTO notifications (user_id,message,lien,created_at) VALUES (?,?,?,?)').run(u.id, m, l, now()); };
  const notifyEmp = async (eid, m, l) => { const u = await db.prepare('SELECT id FROM users WHERE employee_id=?').get(eid); if (u) await db.prepare('INSERT INTO notifications (user_id,message,lien,created_at) VALUES (?,?,?,?)').run(u.id, m, l, now()); };
  if (d.action_type === 'redeploy') {
    const jours = Math.min(Math.max(parseInt(p.jours, 10) || 30, 1), 90); const target = await db.prepare('SELECT * FROM services WHERE id=?').get(d.service_id);
    let ids = Array.isArray(p.employee_ids) ? p.employee_ids : []; const n = adj?.n ? Math.min(Math.max(parseInt(adj.n, 10) || 1, 1), d.params.max || 5) : ids.length;
    if (adj?.n && n > ids.length) { const more = await db.prepare(`SELECT e.id FROM employees e JOIN services d ON d.id=e.service_id WHERE e.statut='actif' AND d.id<>? AND d.localisation=? AND d.division=? AND e.corps IN ('Adjoint administratif','Rédacteur') AND d.chef_id<>e.id AND e.id NOT IN (${ids.join(',') || 0}) AND NOT EXISTS (SELECT 1 FROM affectations_temporaires t WHERE t.employee_id=e.id AND t.statut='en_cours') ORDER BY e.id LIMIT ?`).all(d.service_id, target.localisation, target.division, n - ids.length); ids = ids.concat(more.map((m) => m.id)); }
    ids = ids.slice(0, n); let done = 0;
    for (const id of ids) { const e = await db.prepare("SELECT * FROM employees WHERE id=? AND statut='actif'").get(id); if (!e || e.service_id === d.service_id) continue; await db.prepare('INSERT INTO affectations_temporaires (employee_id,service_origine,service_accueil,date_debut,date_fin,decision_id) VALUES (?,?,?,?,?,?)').run(id, e.service_id, d.service_id, today, U.addDays(today, jours), d.id); await db.prepare('UPDATE employees SET service_id=? WHERE id=?').run(d.service_id, id); await notifyEmp(id, `Affectation temporaire à « ${target.nom} » du ${today} au ${U.addDays(today, jours)}.`, '#/mon-dossier'); done++; }
    if (!done) throw Object.assign(new Error('Aucun fonctionnaire disponible pour le redéploiement'), { status: 409 });
    if (target.chef_id) await notifyEmp(target.chef_id, `${done} fonctionnaire(s) en renfort dans votre service pendant ${jours} jours.`, '#/fonctionnaires');
    return `${done} fonctionnaire(s) affecté(s) temporairement jusqu'au ${U.addDays(today, jours)} (retour automatique).`;
  }
  if (d.action_type === 'convoke_cap') {
    let cap = d.params.cap_id ? await db.prepare('SELECT * FROM caps WHERE id=?').get(d.params.cap_id) : null;
    if (adj?.date_session) { if (!/^\d{4}-\d{2}-\d{2}$/.test(adj.date_session) || adj.date_session < today) throw Object.assign(new Error('Date de CAP invalide'), { status: 400 }); }
    const date = adj?.date_session || cap?.date_session || U.addDays(today, 21);
    if (!cap) cap = { id: Number((await db.prepare('INSERT INTO caps (date_session,objet,statut) VALUES (?,?,?)').run(date, `Avancement de grade ${today.slice(0, 4)}`, 'convoquee')).lastInsertRowid) };
    else await db.prepare("UPDATE caps SET statut='convoquee', date_session=? WHERE id=?").run(date, cap.id);
    const r = await db.prepare("UPDATE promotions SET cap_id=? WHERE statut='propose' AND type='grade'").run(cap.id);
    await notifyDrh(`CAP convoquée le ${date} : ${r.changes} dossier(s) rattaché(s).`, '#/avancements');
    return `CAP convoquée pour le ${date} ; ${r.changes} dossier(s) rattaché(s).`;
  }
  if (d.action_type === 'invite_training') {
    let t = await db.prepare("SELECT t.*, (SELECT COUNT(*) FROM enrollments n WHERE n.training_id=t.id) ins FROM trainings t WHERE t.statut='planifiee' AND t.date_debut>=? ORDER BY (t.domaine='Communication') DESC, t.date_debut LIMIT 1").get(today);
    if (!t) { const id = Number((await db.prepare("INSERT INTO trainings (titre,domaine,date_debut,date_fin,heures,lieu,capacite,statut,description) VALUES (?,?,?,?,?,?,?,'planifiee',?)").run('Numérisation & Accueil Citoyen', 'Communication', U.addDays(today, 21), U.addDays(today, 23), 14, 'Centre de formation - Dakhla', 40, 'Session ciblée annexes et caïdats.')).lastInsertRowid); t = await db.prepare('SELECT *, 0 ins FROM trainings WHERE id=?').get(id); }
    const libres = Math.max(0, t.capacite - t.ins); const lim = Math.min(libres, adj?.n ? Math.max(1, parseInt(adj.n, 10) || 1) : libres);
    const Y = today.slice(0, 4);
    const cand = await db.prepare(`SELECT e.id FROM employees e JOIN services s ON s.id=e.service_id WHERE e.statut='actif' AND s.type_entite IN ('annexe','caidat') AND e.id NOT IN (SELECT n.employee_id FROM enrollments n JOIN trainings tt ON tt.id=n.training_id WHERE n.statut='present' AND tt.date_debut>=?) AND e.id NOT IN (SELECT employee_id FROM enrollments WHERE training_id=?) ORDER BY e.date_recrutement LIMIT ?`).all(`${Y}-01-01`, t.id, lim);
    for (const e of cand) { await db.prepare("INSERT INTO enrollments (training_id,employee_id,statut,convoque_at) VALUES (?,?,'convoque',?)").run(t.id, e.id, now()); await notifyEmp(e.id, `Convocation à la formation « ${t.titre} » du ${t.date_debut}. Merci de confirmer votre présence.`, '#/formations'); }
    return `${cand.length} convocation(s) envoyée(s) pour « ${t.titre} » (${libres - cand.length} place(s) restante(s)).`;
  }
  if (d.action_type === 'open_recruitment') {
    const n = Math.min(Math.max(parseInt(p.postes, 10) || 1, 1), d.params.max || 10); const s = await db.prepare('SELECT nom FROM services WHERE id=?').get(d.service_id);
    for (let i = 0; i < n; i++) await db.prepare("INSERT INTO recruitments (poste,source,candidat,date_candidature,statut,cout) VALUES (?,?,?,?,'candidature',0)").run(`Poste à pourvoir — ${s.nom}`, 'externe', '(à identifier)', today);
    await notifyDrh(`${n} poste(s) à pourvoir ouvert(s) pour ${s.nom}.`, '#/recrutements');
    return `${n} poste(s) à pourvoir créé(s) dans le suivi des recrutements.`;
  }
  throw Object.assign(new Error('Action inconnue'), { status: 400 });
}

module.exports = { generate, pending, execute, revertExpired, SEUILS };
