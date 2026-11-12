'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, checkPassword, tx } = require('./db');
const U = require('./util');
const R = require('./rules');
const { dashboard } = require('./kpi');
const copilot = require('./copilot');
const { renderDocument, renderVerify } = require('./documents');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const forbidden = () => new HttpError(403, 'Accès refusé');
const notFound = (m = 'Ressource introuvable') => new HttpError(404, m);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && U.iso(U.parse(s)) === s;
const reqDate = (s, name) => { if (!isDate(s)) throw bad(`${name} : date invalide (AAAA-MM-JJ)`); return s; };
const reqStr = (s, name, max = 200) => { if (typeof s !== 'string' || !s.trim() || s.length > max) throw bad(`${name} : valeur requise`); return s.trim(); };
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`${name} : valeur invalide`); return v; };
const nowIso = () => new Date().toISOString().slice(0, 19);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBLIC = path.join(__dirname, '..', 'public');
const ONBOARDING = ['Procès-verbal de prise de service', 'Fiche de renseignements', 'Copie de la CIN', 'Diplômes certifiés conformes', 'RIB', "Certificat médical d'aptitude"];

function createApp(db) {
  const sessions = new Map(); const fails = new Map();
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  // ---------- Notifications
  const notifyUser = async (uid, message, lien) => { if (uid) await run('INSERT INTO notifications (user_id,message,lien,created_at) VALUES (?,?,?,?)', uid, message, lien || null, nowIso()); };
  const notifyEmployee = async (eid, m, l) => { const u = await one('SELECT id FROM users WHERE employee_id=?', eid); if (u) await notifyUser(u.id, m, l); };
  const notifyDrh = async (m, l) => { for (const u of await q("SELECT id FROM users WHERE role='drh'")) await notifyUser(u.id, m, l); };
  const notifyChefOf = async (eid, m, l) => { const s = await one('SELECT s.chef_id FROM employees e JOIN services s ON s.id=e.service_id WHERE e.id=?', eid); if (s?.chef_id && s.chef_id !== eid) await notifyEmployee(s.chef_id, m, l); };

  // ---------- Périmètres de visibilité
  const teamIds = async (u) => (u.role === 'chef' && u.employee_id ? (await q("SELECT e.id FROM employees e JOIN services s ON s.id=e.service_id WHERE s.chef_id=? AND e.statut='actif'", u.employee_id)).map((x) => x.id) : []);
  const scopeIds = async (u) => (u.role === 'drh' ? null : u.role === 'chef' ? [...new Set([...(await teamIds(u)), u.employee_id].filter(Boolean))] : u.employee_id ? [u.employee_id] : []);
  const inScope = async (u, eid) => { const s = await scopeIds(u); return s === null || s.includes(eid); };
  const inClause = (ids) => (ids === null ? '1=1' : ids.length ? `employee_id IN (${ids.map(Number).join(',')})` : '0=1');
  const mustSee = async (u, eid) => { if (!await inScope(u, eid)) throw forbidden(); };
  const isChefOf = async (u, eid) => u.role === 'chef' && (await teamIds(u)).includes(eid);

  const EMP_COLS = 'e.ppr,e.nom,e.prenom,e.sexe,e.corps,e.echelle,e.echelon,e.grade,e.poste,e.service_id,s.nom service,s.division,s.localisation';
  const withEmp = 'JOIN employees e ON e.id=x.employee_id LEFT JOIN services s ON s.id=e.service_id';

  const routes = [];
  const route = (method, pattern, roles, fn) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, roles, fn });
  };

  // ---------- Authentification
  route('POST', '/api/login', null, async (c) => {
    const username = reqStr(c.body.username, 'Identifiant', 60).toLowerCase(); const f = fails.get(username);
    if (f && f.n >= 5 && Date.now() < f.until) throw new HttpError(429, 'Trop de tentatives. Réessayez dans une minute.');
    const user = await one('SELECT * FROM users WHERE username=?', username);
    const emp = user?.employee_id ? await one('SELECT statut FROM employees WHERE id=?', user.employee_id) : null;
    if (!user || typeof c.body.password !== 'string' || !checkPassword(c.body.password, user) || emp?.statut === 'parti') {
      const n = (f?.n || 0) + 1; fails.set(username, { n, until: Date.now() + 60000 });
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    fails.delete(username);
    const sid = crypto.randomBytes(24).toString('hex'); sessions.set(sid, { uid: user.id, exp: Date.now() + 8 * 3600e3 });
    c.setCookie = `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
    return publicUser(user);
  });
  route('POST', '/api/logout', ['*'], async (c) => { sessions.delete(c.sid); c.setCookie = 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'; return { ok: true }; });
  const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, nom_affichage: u.nom_affichage, employee_id: u.employee_id, must_change: !!u.must_change });
  route('GET', '/api/me', ['*'], async (c) => ({ ...publicUser(c.user), unread: (await one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND lu=0', c.user.id)).n, today: U.today() }));
  route('POST', '/api/password', ['*'], async (c) => {
    const { ancien, nouveau } = c.body;
    if (typeof nouveau !== 'string' || nouveau.length < 8) throw bad('Le nouveau mot de passe doit comporter au moins 8 caractères');
    if (!checkPassword(String(ancien), c.user)) throw new HttpError(401, 'Mot de passe actuel incorrect');
    const h = hashPassword(nouveau); await run('UPDATE users SET hash=?, salt=?, must_change=0 WHERE id=?', h.hash, h.salt, c.user.id); return { ok: true };
  });

  // ---------- Référentiels
  route('GET', '/api/refs', ['*'], async () => ({
    services: await q('SELECT id,nom,division,localisation,type_entite,chef_id FROM services ORDER BY division,nom'),
    corps: Object.keys(R.CORPS), grades: R.GRADES, echelles: R.ECHELLES, formateurs: await q('SELECT * FROM formateurs ORDER BY nom'),
    localisations: ['Wilaya', 'Province Oued Ed-Dahab', 'Province Aousserd'], regles: await R.loadRules(db), caps: await q('SELECT * FROM caps ORDER BY date_session'),
    onboarding: ONBOARDING, age_retraite: R.AGE_RETRAITE, solde_annuel: R.SOLDE_ANNUEL,
  }));

  // ---------- Tableau de bord
  route('GET', '/api/dashboard', ['wali', 'drh'], async () => await dashboard(db));

  // ---------- Copilote décisionnel (règles explicables ; exécution après validation humaine)
  route('GET', '/api/copilot/decisions', ['wali', 'drh'], async () => { await copilot.generate(db); return await copilot.pending(db); });
  route('GET', '/api/copilot/history', ['wali', 'drh'], async () => await q("SELECT d.id,d.titre,d.statut,d.valide_par,d.resultat,d.note,d.decided_at,d.priorite FROM ai_decisions d WHERE d.statut<>'en_attente' ORDER BY d.decided_at DESC LIMIT 30"));
  route('POST', '/api/copilot/decisions/:id/action', ['wali', 'drh'], async (c) => tx(db, async () => {
    const row = await one('SELECT * FROM ai_decisions WHERE id=?', Number(c.params.id)); if (!row) throw notFound();
    if (row.statut !== 'en_attente') throw new HttpError(409, 'Décision déjà traitée');
    const action = oneOf(c.body.action, ['approve', 'adjust', 'ignore'], 'Action'); const d = { ...row, params: JSON.parse(row.params) };
    let statut, resultat = null;
    if (action === 'ignore') { statut = 'ignore'; }
    else {
      if (action === 'adjust' && (!c.body.params || typeof c.body.params !== 'object')) throw bad('Paramètres ajustés requis');
      try { resultat = await copilot.execute(db, d, action === 'adjust' ? c.body.params : null, c.user.nom_affichage); } catch (e) { throw e.status ? new HttpError(e.status, e.message) : e; }
      statut = action === 'adjust' ? 'modifie' : 'approuve';
    }
    await run('UPDATE ai_decisions SET statut=?, valide_par=?, note=?, resultat=?, decided_at=? WHERE id=?', statut, c.user.nom_affichage, c.body.note ? String(c.body.note).slice(0, 300) : null, resultat, nowIso(), row.id);
    if (c.user.role === 'wali' && statut !== 'ignore') await notifyDrh(`Décision du Wali — ${row.titre} : ${resultat}`, '#/dashboard');
    return { statut, resultat };
  }));

  // ---------- Fonctionnaires
  route('GET', '/api/employees', ['drh', 'chef'], async (c) => {
    const where = ['1=1']; const p = []; const { q: s, service_id, localisation, statut, corps } = c.query;
    if (c.user.role === 'chef') { const ids = await teamIds(c.user); where.push(ids.length ? `e.id IN (${ids.join(',')})` : '0=1'); }
    if (s) { where.push('(e.nom ILIKE ? OR e.prenom ILIKE ? OR e.ppr ILIKE ?)'); p.push(`%${s}%`, `%${s}%`, `%${s}%`); }
    if (service_id) { where.push('e.service_id=?'); p.push(Number(service_id)); }
    if (localisation) { where.push('s.localisation=?'); p.push(localisation); }
    if (corps) { where.push('e.corps=?'); p.push(corps); }
    where.push('e.statut=?'); p.push(statut === 'parti' ? 'parti' : 'actif');
    const limit = Math.min(Number(c.query.limit) || 50, 200); const offset = Number(c.query.offset) || 0;
    const total = (await one(`SELECT COUNT(*) n FROM employees e LEFT JOIN services s ON s.id=e.service_id WHERE ${where.join(' AND ')}`, ...p)).n;
    const items = await q(`SELECT e.id, e.statut, ${EMP_COLS}, e.date_recrutement, e.solde_conges FROM employees e LEFT JOIN services s ON s.id=e.service_id WHERE ${where.join(' AND ')} ORDER BY e.nom,e.prenom LIMIT ? OFFSET ?`, ...p, limit, offset);
    return { total, items };
  });
  const employeeDetail = async (c, id) => {
    const e = await one('SELECT e.*, s.nom service, s.division, s.localisation, s.chef_id FROM employees e LEFT JOIN services s ON s.id=e.service_id WHERE e.id=?', id);
    if (!e) throw notFound(); await mustSee(c.user, id);
    const rules = await R.loadRules(db); const at = U.today(); const Y = at.slice(0, 4);
    const heures = (await one("SELECT COALESCE(SUM(t.heures),0) h FROM enrollments n JOIN trainings t ON t.id=n.training_id WHERE n.employee_id=? AND n.statut='present' AND t.date_debut>=?", id, `${Y}-01-01`)).h;
    const out = {
      ...e, ancienneté_ans: Math.round(U.yearsBetween(e.date_recrutement, at) * 10) / 10, age: Math.floor(U.yearsBetween(e.date_naissance, at)),
      date_retraite: U.addMonths(e.date_naissance, R.AGE_RETRAITE * 12), eligibilite: R.eligibility(e, rules, at), heures_formation_annee: heures,
      heures_formation_total: (await one("SELECT COALESCE(SUM(t.heures),0) h FROM enrollments n JOIN trainings t ON t.id=n.training_id WHERE n.employee_id=? AND n.statut='present'", id)).h,
      promotions: await q('SELECT * FROM promotions WHERE employee_id=? ORDER BY opened_at DESC', id), est_chef: e.chef_id === e.id,
      onboarding: e.onboarding ? JSON.parse(e.onboarding) : null,
    };
    if (c.user.role === 'drh' || c.user.employee_id === id) out.salaire_base = R.salaireBrut(e); // donnée sensible
    else { delete out.cin; delete out.telephone; delete out.situation_familiale; delete out.nb_enfants; }
    return out;
  };
  route('GET', '/api/employees/:id', ['drh', 'chef', 'fonctionnaire'], async (c) => await employeeDetail(c, Number(c.params.id)));

  route('POST', '/api/employees', ['drh'], async (c) => tx(db, async () => {
    const b = c.body;
    const nom = reqStr(b.nom, 'Nom', 80), prenom = reqStr(b.prenom, 'Prénom', 80);
    const sexe = oneOf(b.sexe, ['F', 'H'], 'Sexe'); const naiss = reqDate(b.date_naissance, 'Date de naissance'); const rec = reqDate(b.date_recrutement, 'Date de recrutement');
    if (U.yearsBetween(naiss, rec) < 18) throw bad('Le fonctionnaire doit avoir au moins 18 ans à la date de recrutement');
    if (rec > U.addDays(U.today(), 90)) throw bad('Date de recrutement trop éloignée');
    const corps = oneOf(b.corps, Object.keys(R.CORPS), 'Corps'); const svc = await one('SELECT * FROM services WHERE id=?', Number(b.service_id)); if (!svc) throw bad('Service : affectation requise');
    const grade = b.grade ? oneOf(b.grade, R.GRADES, 'Grade') : R.GRADES[0]; const echelon = b.echelon ? Math.min(Math.max(parseInt(b.echelon, 10) || 1, 1), R.ECHELON_MAX) : 1;
    let ppr = b.ppr ? String(b.ppr).trim() : null;
    if (ppr && !/^\d{6,8}$/.test(ppr)) throw bad('PPR : 6 à 8 chiffres');
    if (!ppr) do { ppr = String(1000000 + Math.floor(Math.random() * 8999999)); } while (await one('SELECT 1 FROM employees WHERE ppr=?', ppr));
    if (await one('SELECT 1 FROM employees WHERE ppr=?', ppr)) throw new HttpError(409, 'Ce PPR existe déjà');
    const prise = b.date_prise_service ? reqDate(b.date_prise_service, 'Prise de service') : rec;
    const onboarding = JSON.stringify(ONBOARDING.map((label) => ({ label, done: false })));
    const id = Number((await run(`INSERT INTO employees (ppr,cin,nom,prenom,sexe,date_naissance,date_recrutement,email,telephone,situation_familiale,nb_enfants,diplome,corps,echelle,echelon,grade,rythme,poste,service_id,cadre_sup,solde_conges,date_dernier_echelon,date_dernier_grade,date_prise_service,onboarding)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ppr, b.cin || null, nom, prenom, sexe, naiss, rec, b.email || null, b.telephone || null, b.situation_familiale || null, parseInt(b.nb_enfants, 10) || 0, b.diplome || R.CORPS[corps].diplome,
      corps, R.CORPS[corps].echelle, echelon, grade, 'moyen', b.poste || corps, svc.id, corps === 'Administrateur' || corps === 'Ingénieur' ? 1 : 0, R.SOLDE_ANNUEL, prise, prise, prise, onboarding)).lastInsertRowid);
    const temp = crypto.randomBytes(5).toString('hex'); const h = hashPassword(temp);
    await run('INSERT INTO users (username,hash,salt,role,employee_id,nom_affichage,must_change) VALUES (?,?,?,?,?,?,1)', ppr, h.hash, h.salt, 'fonctionnaire', id, `${prenom} ${nom}`);
    if (b.recruitment_id) await run("UPDATE recruitments SET employee_id=? WHERE id=? AND statut='acceptee'", id, Number(b.recruitment_id));
    if (svc.chef_id) await notifyEmployee(svc.chef_id, `Nouveau fonctionnaire affecté à votre service : ${prenom} ${nom} (prise de service le ${prise}).`, `#/fonctionnaires/${id}`);
    return { id, ppr, identifiant: ppr, mot_de_passe_temporaire: temp };
  }));
  route('PUT', '/api/employees/:id', ['drh'], async (c) => {
    const id = Number(c.params.id); const e = await one('SELECT * FROM employees WHERE id=?', id); if (!e) throw notFound(); const b = c.body; const sets = []; const v = [];
    const set = (col, val) => { sets.push(`${col}=?`); v.push(val); };
    if (b.service_id !== undefined) { const s = await one('SELECT id FROM services WHERE id=?', Number(b.service_id)); if (!s) throw bad('Service invalide'); set('service_id', s.id); }
    if (b.poste !== undefined) set('poste', reqStr(b.poste, 'Poste', 120));
    for (const k of ['email', 'telephone', 'situation_familiale', 'diplome', 'cin']) if (b[k] !== undefined) set(k, b[k] || null);
    if (b.nb_enfants !== undefined) set('nb_enfants', Math.max(0, parseInt(b.nb_enfants, 10) || 0));
    if (b.rythme !== undefined) set('rythme', oneOf(b.rythme, ['rapide', 'moyen', 'lent'], 'Rythme'));
    if (b.cadre_sup !== undefined) set('cadre_sup', b.cadre_sup ? 1 : 0);
    if (!sets.length) throw bad('Aucune modification');
    await run(`UPDATE employees SET ${sets.join(',')} WHERE id=?`, ...v, id);
    if (b.service_id !== undefined && Number(b.service_id) !== e.service_id) await notifyEmployee(id, 'Votre affectation a été modifiée par la DRH.', '#/mon-dossier');
    return { ok: true };
  });
  route('POST', '/api/employees/:id/onboarding', ['drh'], async (c) => {
    const id = Number(c.params.id); const e = await one('SELECT onboarding FROM employees WHERE id=?', id); if (!e?.onboarding) throw notFound();
    const list = JSON.parse(e.onboarding); const i = Number(c.body.index); if (!list[i]) throw bad('Élément inconnu'); list[i].done = !!c.body.done;
    await run('UPDATE employees SET onboarding=? WHERE id=?', JSON.stringify(list), id); return list;
  });
  route('POST', '/api/employees/:id/depart', ['drh'], async (c) => {
    const id = Number(c.params.id); const e = await one("SELECT * FROM employees WHERE id=? AND statut='actif'", id); if (!e) throw notFound();
    const d = reqDate(c.body.date_depart, 'Date de départ'); if (d < e.date_recrutement) throw bad('Date de départ antérieure au recrutement');
    const motif = oneOf(c.body.motif, ['Retraite', 'Démission', 'Mutation', 'Détachement', 'Décès', 'Révocation'], 'Motif');
    await run("UPDATE employees SET statut='parti', date_depart=?, motif_depart=? WHERE id=?", d, motif, id);
    if (await one('SELECT 1 FROM services WHERE chef_id=?', id)) await run('UPDATE services SET chef_id=NULL WHERE chef_id=?', id);
    return { ok: true };
  });

  // ---------- Congés
  const leaveList = async (c) => {
    const st = c.query.statut; const w = [inClause(await scopeIds(c.user)).replace('employee_id', 'x.employee_id')]; const p = [];
    if (st) { w.push('x.statut=?'); p.push(st); }
    return await q(`SELECT x.*, ${EMP_COLS} FROM leaves x ${withEmp} WHERE ${w.join(' AND ')} ORDER BY x.created_at DESC LIMIT 500`, ...p);
  };
  route('GET', '/api/leaves', ['drh', 'chef', 'fonctionnaire'], leaveList);
  route('POST', '/api/leaves', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const b = c.body; const eid = c.user.role === 'drh' && b.employee_id ? Number(b.employee_id) : c.user.employee_id;
    if (!eid) throw bad('Aucun dossier fonctionnaire associé'); const e = await one("SELECT * FROM employees WHERE id=? AND statut='actif'", eid); if (!e) throw notFound('Fonctionnaire introuvable');
    const type = oneOf(b.type, ['annuel', 'exceptionnel', 'pelerinage'], 'Type de congé'); const d1 = reqDate(b.date_debut, 'Début'), d2 = reqDate(b.date_fin, 'Fin');
    if (d2 < d1) throw bad('La date de fin précède la date de début'); if (d1 < U.addDays(U.today(), -30)) throw bad('Début trop ancien');
    const jours = U.workdays(d1, d2); if (jours < 1) throw bad('La période ne contient aucun jour ouvré');
    if (await one("SELECT 1 FROM leaves WHERE employee_id=? AND statut IN ('en_attente_chef','en_attente_drh','valide') AND date_debut<=? AND date_fin>=?", eid, d2, d1)) throw new HttpError(409, 'Cette période chevauche une autre demande de congé');
    if (type === 'annuel' && jours > e.solde_conges) throw new HttpError(422, `Solde insuffisant : ${e.solde_conges} jour(s) disponible(s) pour ${jours} demandé(s)`);
    const svc = await one('SELECT chef_id FROM services WHERE id=?', e.service_id); const direct = !svc?.chef_id || svc.chef_id === eid || c.user.role === 'drh';
    const id = Number((await run('INSERT INTO leaves (employee_id,type,date_debut,date_fin,jours,motif,statut,created_at) VALUES (?,?,?,?,?,?,?,?)', eid, type, d1, d2, jours, b.motif ? String(b.motif).slice(0, 300) : null, direct ? 'en_attente_drh' : 'en_attente_chef', nowIso())).lastInsertRowid);
    if (direct) await notifyDrh(`Demande de congé de ${e.prenom} ${e.nom} à valider.`, '#/conges'); else await notifyChefOf(eid, `Demande de congé de ${e.prenom} ${e.nom} : avis requis.`, '#/conges');
    return { id, jours, statut: direct ? 'en_attente_drh' : 'en_attente_chef' };
  });
  route('POST', '/api/leaves/:id/decision', ['drh', 'chef', 'fonctionnaire'], async (c) => tx(db, async () => {
    const l = await one('SELECT * FROM leaves WHERE id=?', Number(c.params.id)); if (!l) throw notFound(); const { action } = c.body; const com = c.body.commentaire ? String(c.body.commentaire).slice(0, 300) : null; const u = c.user;
    const e = await one('SELECT * FROM employees WHERE id=?', l.employee_id);
    if (action === 'annuler') { if (u.employee_id !== l.employee_id || !l.statut.startsWith('en_attente')) throw forbidden(); await run("UPDATE leaves SET statut='annule', decided_at=? WHERE id=?", nowIso(), l.id); return { ok: true }; }
    if (action === 'favorable' || action === 'defavorable') {
      if (u.role !== 'chef' || !await isChefOf(u, l.employee_id) || l.statut !== 'en_attente_chef') throw forbidden();
      await run("UPDATE leaves SET statut='en_attente_drh', avis_chef=?, commentaire_chef=? WHERE id=?", action === 'favorable' ? 'favorable' : 'defavorable', com, l.id);
      await notifyDrh(`Avis ${action} du chef de service sur le congé de ${e.prenom} ${e.nom}.`, '#/conges'); return { ok: true };
    }
    if (u.role !== 'drh') throw forbidden(); if (!['en_attente_chef', 'en_attente_drh'].includes(l.statut)) throw new HttpError(409, 'Demande déjà traitée');
    if (action === 'valider') {
      if (l.type === 'annuel') { if (e.solde_conges < l.jours) throw new HttpError(422, 'Solde insuffisant pour valider cette demande'); await run('UPDATE employees SET solde_conges=solde_conges-? WHERE id=?', l.jours, e.id); }
      await run("UPDATE leaves SET statut='valide', commentaire_drh=?, decided_at=? WHERE id=?", com, nowIso(), l.id); await notifyEmployee(e.id, `Votre congé du ${l.date_debut} au ${l.date_fin} a été validé.`, '#/conges');
    } else if (action === 'rejeter') {
      await run("UPDATE leaves SET statut='rejete', commentaire_drh=?, decided_at=? WHERE id=?", com, nowIso(), l.id); await notifyEmployee(e.id, `Votre demande de congé du ${l.date_debut} a été refusée.${com ? ' Motif : ' + com : ''}`, '#/conges');
    } else throw bad('Action inconnue');
    return { ok: true };
  }));

  // ---------- Absences & justifications
  route('GET', '/api/absences', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const w = [inClause(await scopeIds(c.user)).replace('employee_id', 'x.employee_id')]; const p = [];
    if (c.query.statut_justif) { w.push('x.statut_justif=?'); p.push(c.query.statut_justif); }
    return await q(`SELECT x.*, ${EMP_COLS} FROM absences x ${withEmp} WHERE ${w.join(' AND ')} ORDER BY x.date_debut DESC LIMIT 500`, ...p);
  });
  route('POST', '/api/absences', ['drh', 'chef'], async (c) => {
    const b = c.body; const eid = Number(b.employee_id); await mustSee(c.user, eid); const e = await one("SELECT * FROM employees WHERE id=? AND statut='actif'", eid); if (!e) throw notFound('Fonctionnaire introuvable');
    const d1 = reqDate(b.date_debut, 'Début'), d2 = reqDate(b.date_fin, 'Fin'); if (d2 < d1) throw bad('La date de fin précède la date de début'); if (d2 > U.today()) throw bad("Une absence ne peut pas être déclarée dans le futur");
    const jours = U.workdays(d1, d2); if (jours < 1) throw bad('Aucun jour ouvré dans la période'); const type = oneOf(b.type, ['maladie', 'absence'], 'Type');
    const id = Number((await run('INSERT INTO absences (employee_id,date_debut,date_fin,jours,type,declared_by,created_at) VALUES (?,?,?,?,?,?,?)', eid, d1, d2, jours, type, c.user.id, nowIso())).lastInsertRowid);
    await notifyEmployee(eid, `Une absence du ${d1} au ${d2} a été enregistrée. Vous pouvez soumettre un justificatif.`, '#/absences'); return { id, jours };
  });
  route('POST', '/api/absences/:id/justify', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const a = await one('SELECT * FROM absences WHERE id=?', Number(c.params.id)); if (!a) throw notFound();
    if (c.user.employee_id !== a.employee_id && c.user.role !== 'drh') throw forbidden(); if (!['aucune', 'rejetee'].includes(a.statut_justif)) throw new HttpError(409, 'Justification déjà soumise ou validée');
    const txt = reqStr(c.body.justification, 'Justification', 500); await run("UPDATE absences SET statut_justif='soumise', justification=?, decided_at=NULL WHERE id=?", txt, a.id);
    const e = await one('SELECT prenom,nom FROM employees WHERE id=?', a.employee_id); await notifyDrh(`Justification d'absence soumise par ${e.prenom} ${e.nom}.`, '#/absences'); return { ok: true };
  });
  route('POST', '/api/absences/:id/decision', ['drh'], async (c) => {
    const a = await one('SELECT * FROM absences WHERE id=?', Number(c.params.id)); if (!a) throw notFound(); if (a.statut_justif !== 'soumise') throw new HttpError(409, "Aucune justification en attente");
    const act = oneOf(c.body.action, ['valider', 'rejeter'], 'Action'); const com = c.body.commentaire ? String(c.body.commentaire).slice(0, 300) : null;
    await run('UPDATE absences SET statut_justif=?, commentaire_drh=?, decided_at=? WHERE id=?', act === 'valider' ? 'validee' : 'rejetee', com, nowIso(), a.id);
    await notifyEmployee(a.employee_id, `Votre justification d'absence (${a.date_debut}) a été ${act === 'valider' ? 'acceptée' : 'rejetée — l\'absence reste comptabilisée comme injustifiée'}.`, '#/absences'); return { ok: true };
  });
  route('GET', '/api/alerts', ['drh', 'chef'], async (c) => {
    const ids = await scopeIds(c.user); const at = U.today(); const out = []; const cond = inClause(ids);
    for (const e of await q(`SELECT id,nom,prenom,solde_conges FROM employees e WHERE statut='actif' AND solde_conges<0 AND ${cond.replace('employee_id', 'e.id')}`)) out.push({ niveau: 'critique', type: 'solde', employee_id: e.id, message: `${e.prenom} ${e.nom} : solde de congés négatif (${e.solde_conges} j).` });
    for (const r of await q(`SELECT x.employee_id, e.nom, e.prenom, SUM(x.jours) j FROM absences x JOIN employees e ON e.id=x.employee_id WHERE x.statut_justif!='validee' AND x.date_fin>=? AND ${cond.replace('employee_id', 'x.employee_id')} GROUP BY x.employee_id, e.nom, e.prenom HAVING SUM(x.jours)>=3 ORDER BY j DESC`, U.addDays(at, -30)))
      out.push({ niveau: 'alerte', type: 'absence', employee_id: r.employee_id, message: `${r.prenom} ${r.nom} : ${r.j} jours d'absence non justifiée sur 30 jours.` });
    if (c.user.role === 'drh') {
      const n = (await one("SELECT COUNT(*) n FROM absences WHERE statut_justif='soumise'")).n; if (n) out.push({ niveau: 'info', type: 'justification', message: `${n} justification(s) d'absence en attente de décision.`, lien: '#/absences' });
      const o = (await one("SELECT COUNT(*) n FROM leaves WHERE statut='en_attente_drh'")).n; if (o) out.push({ niveau: 'info', type: 'conge', message: `${o} demande(s) de congé en attente de validation finale.`, lien: '#/conges' });
    }
    return out;
  });

  // ---------- Avancements
  route('GET', '/api/promotions', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const w = [inClause(await scopeIds(c.user)).replace('employee_id', 'x.employee_id')]; const p = [];
    for (const k of ['statut', 'type']) if (c.query[k]) { w.push(`x.${k}=?`); p.push(c.query[k]); }
    return await q(`SELECT x.*, ${EMP_COLS}, e.date_dernier_echelon, e.date_dernier_grade FROM promotions x ${withEmp} WHERE ${w.join(' AND ')} ORDER BY x.statut='propose' DESC, x.opened_at DESC LIMIT 500`, ...p);
  });
  route('POST', '/api/promotions/generate', ['drh'], async () => await R.generatePromotions(db));
  route('POST', '/api/promotions', ['drh'], async (c) => {
    const e = await one("SELECT * FROM employees WHERE id=? AND statut='actif'", Number(c.body.employee_id)); if (!e) throw notFound('Fonctionnaire introuvable');
    const type = oneOf(c.body.type, ['echelon', 'grade'], 'Type'); const mode = oneOf(c.body.mode || 'choix', ['choix', 'examen', 'moyen', 'rapide', 'lent'], 'Mode');
    const de = type === 'echelon' ? String(e.echelon) : e.grade; const a = type === 'echelon' ? e.echelon + 1 : R.nextGrade(e.grade);
    if (type === 'echelon' && e.echelon >= R.ECHELON_MAX) throw new HttpError(422, "Dernier échelon atteint"); if (!a) throw new HttpError(422, 'Dernier grade atteint');
    if (await one("SELECT 1 FROM promotions WHERE employee_id=? AND type=? AND statut='propose'", e.id, type)) throw new HttpError(409, 'Une proposition est déjà en cours');
    const cap = type === 'grade' ? await one("SELECT id FROM caps WHERE statut='planifiee' ORDER BY date_session LIMIT 1") : null;
    return { id: Number((await run('INSERT INTO promotions (employee_id,type,de_valeur,a_valeur,mode,cap_id,statut,opened_at,annee) VALUES (?,?,?,?,?,?,?,?,?)', e.id, type, de, String(a), mode, cap?.id ?? null, 'propose', U.today(), Number(U.today().slice(0, 4)))).lastInsertRowid) };
  });
  route('POST', '/api/promotions/:id/decision', ['drh'], async (c) => tx(db, async () => {
    const p = await one('SELECT * FROM promotions WHERE id=?', Number(c.params.id)); if (!p) throw notFound(); if (p.statut !== 'propose') throw new HttpError(409, 'Décision déjà prise');
    const act = oneOf(c.body.action, ['valider', 'rejeter'], 'Action'); const ref = reqStr(c.body.ref_decision || (act === 'valider' ? '' : 'Non retenu'), 'Référence de la décision', 120);
    const e = await one('SELECT * FROM employees WHERE id=?', p.employee_id);
    if (act === 'valider') {
      const cur = p.type === 'echelon' ? String(e.echelon) : e.grade; if (cur !== p.de_valeur) throw new HttpError(409, "La situation du fonctionnaire a changé depuis la proposition");
      await R.applyPromotion(db, p); await run("UPDATE promotions SET statut='valide', ref_decision=?, decided_at=? WHERE id=?", ref, U.today(), p.id);
      await notifyEmployee(p.employee_id, `Avancement validé : ${p.type === 'echelon' ? 'échelon ' + p.a_valeur : p.a_valeur}.`, '#/mon-dossier');
    } else await run("UPDATE promotions SET statut='rejete', ref_decision=?, decided_at=? WHERE id=?", ref, U.today(), p.id);
    return { ok: true };
  }));
  route('PUT', '/api/rules', ['drh'], async (c) => tx(db, async () => {
    for (const r of c.body.echelon || []) { const m = Number(r.duree_mois); if (!(m >= 6 && m <= 120)) throw bad('Durée invalide (6 à 120 mois)'); await run('UPDATE regles_echelon SET duree_mois=? WHERE rythme=?', m, oneOf(r.rythme, ['rapide', 'moyen', 'lent'], 'Rythme')); }
    for (const r of c.body.grade || []) { const a = Number(r.anciennete_min_ans), qt = Number(r.quota_pct), em = Number(r.echelon_min); if (!(a >= 1 && a <= 30 && qt >= 0 && qt <= 100 && em >= 1 && em <= 10)) throw bad('Paramètres de grade invalides'); await run('UPDATE regles_grade SET anciennete_min_ans=?, quota_pct=?, echelon_min=? WHERE id=?', a, qt, em, Number(r.id)); }
    return await R.loadRules(db);
  }));
  route('POST', '/api/caps', ['drh'], async (c) => ({ id: Number((await run('INSERT INTO caps (date_session,objet,statut) VALUES (?,?,?)', reqDate(c.body.date_session, 'Date'), reqStr(c.body.objet, 'Objet'), 'planifiee')).lastInsertRowid) }));

  // ---------- Formation
  const trainingRows = async (c) => {
    const rows = await q('SELECT t.*, f.nom formateur, (SELECT COUNT(*) FROM enrollments n WHERE n.training_id=t.id) inscrits, (SELECT COUNT(*) FROM enrollments n WHERE n.training_id=t.id AND n.statut IN (\'confirme\',\'present\')) confirmes, (SELECT COUNT(*) FROM enrollments n WHERE n.training_id=t.id AND n.statut=\'present\') presents FROM trainings t LEFT JOIN formateurs f ON f.id=t.formateur_id ORDER BY t.date_debut DESC');
    const mine = c.user.employee_id ? Object.fromEntries((await q('SELECT * FROM enrollments WHERE employee_id=?', c.user.employee_id)).map((n) => [n.training_id, n])) : {};
    return rows.map((t) => ({ ...t, mon_inscription: mine[t.id] || null }));
  };
  route('GET', '/api/trainings', ['drh', 'chef', 'fonctionnaire'], trainingRows);
  route('POST', '/api/trainings', ['drh'], async (c) => {
    const b = c.body; const d1 = reqDate(b.date_debut, 'Début'), d2 = reqDate(b.date_fin, 'Fin'); if (d2 < d1) throw bad('La date de fin précède le début');
    const h = Number(b.heures); if (!(h > 0 && h <= 400)) throw bad('Volume horaire invalide'); const cap = parseInt(b.capacite, 10) || 30; if (cap < 1 || cap > 500) throw bad('Capacité invalide');
    if (b.formateur_id && !await one('SELECT 1 FROM formateurs WHERE id=?', Number(b.formateur_id))) throw bad('Formateur inconnu');
    return { id: Number((await run('INSERT INTO trainings (titre,domaine,date_debut,date_fin,heures,lieu,capacite,formateur_id,statut,description) VALUES (?,?,?,?,?,?,?,?,?,?)', reqStr(b.titre, 'Titre'), reqStr(b.domaine, 'Domaine', 80), d1, d2, h, b.lieu || null, cap, b.formateur_id ? Number(b.formateur_id) : null, 'planifiee', b.description ? String(b.description).slice(0, 500) : null)).lastInsertRowid) };
  });
  route('POST', '/api/formateurs', ['drh'], async (c) => ({ id: Number((await run('INSERT INTO formateurs (nom,organisme,specialite,email) VALUES (?,?,?,?)', reqStr(c.body.nom, 'Nom', 100), c.body.organisme || null, c.body.specialite || null, c.body.email || null)).lastInsertRowid) }));
  route('POST', '/api/trainings/:id/status', ['drh'], async (c) => { const t = await one('SELECT id FROM trainings WHERE id=?', Number(c.params.id)); if (!t) throw notFound(); await run('UPDATE trainings SET statut=? WHERE id=?', oneOf(c.body.statut, ['planifiee', 'en_cours', 'terminee', 'annulee'], 'Statut'), t.id); return { ok: true }; });
  route('GET', '/api/trainings/:id', ['drh'], async (c) => {
    const t = await one('SELECT t.*, f.nom formateur FROM trainings t LEFT JOIN formateurs f ON f.id=t.formateur_id WHERE t.id=?', Number(c.params.id)); if (!t) throw notFound();
    return { ...t, inscriptions: await q(`SELECT x.id, x.employee_id, x.statut, x.note_satisfaction, ${EMP_COLS} FROM enrollments x ${withEmp} WHERE x.training_id=? ORDER BY e.nom`, t.id) };
  });
  route('POST', '/api/trainings/:id/convoke', ['drh'], async (c) => tx(db, async () => {
    const t = await one('SELECT * FROM trainings WHERE id=?', Number(c.params.id)); if (!t) throw notFound(); if (['terminee', 'annulee'].includes(t.statut)) throw new HttpError(409, 'Session close');
    const cr = c.body.criteres || {}; const w = ["e.statut='actif'", 'e.id NOT IN (SELECT employee_id FROM enrollments WHERE training_id=?)']; const p = [t.id];
    if (Array.isArray(c.body.employee_ids) && c.body.employee_ids.length) { w.push(`e.id IN (${c.body.employee_ids.map(Number).filter(Number.isInteger).join(',') || 0})`); }
    for (const [k, col] of [['corps', 'e.corps'], ['service_id', 'e.service_id'], ['localisation', 's.localisation'], ['division', 's.division'], ['grade', 'e.grade']]) if (cr[k]) { w.push(`${col}=?`); p.push(k === 'service_id' ? Number(cr[k]) : cr[k]); }
    const libres = t.capacite - (await one('SELECT COUNT(*) n FROM enrollments WHERE training_id=?', t.id)).n;
    const cand = await q(`SELECT e.id FROM employees e LEFT JOIN services s ON s.id=e.service_id WHERE ${w.join(' AND ')} ORDER BY e.date_recrutement LIMIT ?`, ...p, Math.max(0, libres));
    if (c.body.apercu) return { eligibles: cand.length, places_libres: libres };
    for (const e of cand) { await run('INSERT INTO enrollments (training_id,employee_id,statut,convoque_at) VALUES (?,?,?,?)', t.id, e.id, 'convoque', nowIso()); await notifyEmployee(e.id, `Convocation à la formation « ${t.titre} » du ${t.date_debut}. Merci de confirmer votre présence.`, '#/formations'); }
    return { convoques: cand.length, places_libres: libres - cand.length };
  }));
  const myEnrollment = async (c) => { const n = await one('SELECT * FROM enrollments WHERE id=?', Number(c.params.id)); if (!n) throw notFound(); return n; };
  route('POST', '/api/enrollments/:id/respond', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const n = await myEnrollment(c); if (n.employee_id !== c.user.employee_id) throw forbidden(); const t = await one('SELECT * FROM trainings WHERE id=?', n.training_id);
    if (['terminee', 'annulee'].includes(t.statut) || !['convoque', 'confirme', 'decline'].includes(n.statut)) throw new HttpError(409, 'Réponse impossible pour cette session');
    await run('UPDATE enrollments SET statut=? WHERE id=?', oneOf(c.body.action, ['confirme', 'decline'], 'Action'), n.id);
    if (c.body.action === 'decline') await notifyDrh(`Désistement : ${c.user.nom_affichage} — « ${t.titre} ».`, '#/formations'); return { ok: true };
  });
  route('POST', '/api/enrollments/:id/attendance', ['drh'], async (c) => {
    const n = await myEnrollment(c); const t = await one('SELECT * FROM trainings WHERE id=?', n.training_id); if (t.statut === 'planifiee' || t.statut === 'annulee') throw new HttpError(409, "La session n'a pas commencé");
    await run('UPDATE enrollments SET statut=? WHERE id=?', c.body.present ? 'present' : 'absent', n.id); return { ok: true };
  });
  route('POST', '/api/enrollments/:id/evaluate', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const n = await myEnrollment(c); if (n.employee_id !== c.user.employee_id) throw forbidden(); if (n.statut !== 'present') throw new HttpError(409, 'Évaluation réservée aux participants présents');
    const note = parseInt(c.body.note, 10); if (!(note >= 1 && note <= 5)) throw bad('Note de 1 à 5'); await run('UPDATE enrollments SET note_satisfaction=? WHERE id=?', note, n.id); return { ok: true };
  });

  // ---------- Recrutements
  route('GET', '/api/recruitments', ['drh'], async () => await q('SELECT r.*, e.ppr FROM recruitments r LEFT JOIN employees e ON e.id=r.employee_id ORDER BY r.date_candidature DESC LIMIT 300'));
  route('POST', '/api/recruitments', ['drh'], async (c) => ({ id: Number((await run("INSERT INTO recruitments (poste,source,candidat,date_candidature,statut,cout) VALUES (?,?,?,?,'candidature',?)", reqStr(c.body.poste, 'Poste'), oneOf(c.body.source, ['externe', 'interne'], 'Source'), reqStr(c.body.candidat, 'Candidat'), reqDate(c.body.date_candidature, 'Date de candidature'), Math.max(0, Number(c.body.cout) || 0))).lastInsertRowid) }));
  route('POST', '/api/recruitments/:id/offer', ['drh'], async (c) => { const r = await one('SELECT * FROM recruitments WHERE id=?', Number(c.params.id)); if (!r) throw notFound(); if (r.statut !== 'candidature') throw new HttpError(409, 'Offre déjà émise'); const d = reqDate(c.body.date_offre, "Date de l'offre"); if (d < r.date_candidature) throw bad("L'offre précède la candidature"); await run("UPDATE recruitments SET statut='emise', date_offre=? WHERE id=?", d, r.id); return { ok: true }; });
  route('POST', '/api/recruitments/:id/outcome', ['drh'], async (c) => {
    const r = await one('SELECT * FROM recruitments WHERE id=?', Number(c.params.id)); if (!r) throw notFound(); if (r.statut !== 'emise') throw new HttpError(409, "Aucune offre en attente de réponse");
    if (c.body.accepted) { const d = reqDate(c.body.date_acceptation, "Date d'acceptation"); if (d < r.date_offre) throw bad("L'acceptation précède l'offre"); await run("UPDATE recruitments SET statut='acceptee', date_acceptation=? WHERE id=?", d, r.id); } else await run("UPDATE recruitments SET statut='refusee' WHERE id=?", r.id);
    return { ok: true };
  });

  // ---------- E-services : attestations
  const ATT = { travail: 'Attestation de travail', salaire: 'Attestation de salaire', mission: 'Ordre de mission', conge: 'Titre de congé' };
  route('GET', '/api/attestations', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const ids = c.user.role === 'drh' ? null : [c.user.employee_id].filter(Boolean);
    return await q(`SELECT x.id,x.employee_id,x.type,x.code,x.statut,x.requested_at,x.signed_at,x.signed_by,x.params, ${EMP_COLS} FROM attestations x ${withEmp} WHERE ${inClause(ids).replace('employee_id', 'x.employee_id')} AND (${c.query.statut ? 'x.statut=?' : '1=1'}) ORDER BY x.requested_at DESC LIMIT 300`, ...(c.query.statut ? [c.query.statut] : []));
  });
  route('POST', '/api/attestations', ['drh', 'chef', 'fonctionnaire'], async (c) => {
    const b = c.body; const eid = c.user.role === 'drh' && b.employee_id ? Number(b.employee_id) : c.user.employee_id; const e = eid && await one("SELECT * FROM employees WHERE id=? AND statut='actif'", eid); if (!e) throw bad('Aucun dossier fonctionnaire associé');
    const type = oneOf(b.type, Object.keys(ATT), 'Type de document'); let params = {};
    if (type === 'mission') { params = { destination: reqStr(b.destination, 'Destination', 100), objet: reqStr(b.objet, 'Objet', 200), date_debut: reqDate(b.date_debut, 'Début'), date_fin: reqDate(b.date_fin, 'Fin') }; if (params.date_fin < params.date_debut) throw bad('Fin avant début'); }
    if (type === 'conge') { const l = await one("SELECT * FROM leaves WHERE id=? AND employee_id=? AND statut='valide'", Number(b.leave_id), eid); if (!l) throw bad('Sélectionnez un congé validé'); params = { leave_id: l.id, type: l.type, date_debut: l.date_debut, date_fin: l.date_fin, jours: l.jours }; }
    const auto = type === 'travail' || type === 'salaire'; const now = nowIso(); const code = 'AT-' + crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'X').slice(0, 10).toUpperCase();
    const id = Number((await run('INSERT INTO attestations (employee_id,type,code,params,statut,requested_at,signed_at,signed_by) VALUES (?,?,?,?,?,?,?,?)', eid, type, code, JSON.stringify(params), auto ? 'signee' : 'en_attente', now, auto ? now : null, auto ? 'Signature électronique automatique' : null)).lastInsertRowid);
    if (!auto) await notifyDrh(`Demande de « ${ATT[type]} » de ${e.prenom} ${e.nom} à signer.`, '#/eservices');
    return { id, statut: auto ? 'signee' : 'en_attente', code };
  });
  route('POST', '/api/attestations/:id/sign', ['drh'], async (c) => {
    const a = await one('SELECT * FROM attestations WHERE id=?', Number(c.params.id)); if (!a) throw notFound(); if (a.statut !== 'en_attente') throw new HttpError(409, 'Déjà signée');
    await run("UPDATE attestations SET statut='signee', signed_at=?, signed_by=? WHERE id=?", nowIso(), c.user.nom_affichage, a.id); await notifyEmployee(a.employee_id, `Votre « ${ATT[a.type]} » est prête à être téléchargée.`, '#/eservices'); return { ok: true };
  });

  // ---------- Notifications
  route('GET', '/api/notifications', ['*'], async (c) => await q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', c.user.id));
  route('POST', '/api/notifications/read', ['*'], async (c) => { await run('UPDATE notifications SET lu=1 WHERE user_id=?', c.user.id); return { ok: true }; });

  // ---------- Pages HTML (documents imprimables, vérification publique)
  const pages = {
    doc: async (c, id) => { const a = await one('SELECT * FROM attestations WHERE id=?', id); if (!a) throw notFound(); if (c.user.role !== 'drh' && a.employee_id !== c.user.employee_id) throw forbidden(); if (a.statut !== 'signee') throw new HttpError(409, "Document non encore signé"); const e = await one('SELECT e.*, s.nom service, s.division FROM employees e LEFT JOIN services s ON s.id=e.service_id WHERE e.id=?', a.employee_id); return renderDocument(a, e, { salaire: R.salaireBrut(e), host: c.origin }); },
    verify: async (c, code) => { const a = await one('SELECT x.*, e.nom, e.prenom FROM attestations x JOIN employees e ON e.id=x.employee_id WHERE x.code=?', code); return renderVerify(a ? { ...a, label: ATT[a.type] } : null); },
  };

  // ---------- Serveur
  const parseCookies = (h) => Object.fromEntries((h || '').split(';').map((s) => s.trim().split('=')).filter((x) => x[0]));
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC, ...headers }); res.end(body); };
  const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'); const p = url.pathname; const cookies = parseCookies(req.headers.cookie);
      const sess = sessions.get(cookies.sid); if (sess && sess.exp < Date.now()) sessions.delete(cookies.sid);
      const live = sessions.get(cookies.sid); const user = live ? await one('SELECT * FROM users WHERE id=?', live.uid) : null;
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      if (p.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue; const m = r.re.exec(p); if (!m) continue;
          if (r.roles && (!user || (!r.roles.includes('*') && !r.roles.includes(user.role)))) throw user ? forbidden() : new HttpError(401, 'Authentification requise');
          let body = {};
          if (req.method !== 'GET') {
            if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON requis');
            const chunks = []; let size = 0; for await (const ch of req) { size += ch.length; if (size > 1e6) throw new HttpError(413, 'Requête trop volumineuse'); chunks.push(ch); }
            try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { throw bad('JSON invalide'); }
            if (body === null || typeof body !== 'object') throw bad('Corps invalide');
          }
          const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          const ctx = { user, body, params, query: Object.fromEntries(url.searchParams), sid: cookies.sid, origin };
          const out = await r.fn(ctx); return json(res, 200, out, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
        }
        throw notFound('Route inconnue');
      }
      let m;
      if ((m = /^\/doc\/(\d+)$/.exec(p))) { if (!user) throw new HttpError(401, 'Authentification requise'); return send(res, 200, await pages.doc({ user, origin }, Number(m[1])), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); }
      if ((m = /^\/verify\/([A-Z0-9-]{4,20})$/.exec(p))) return send(res, 200, await pages.verify({}, m[1]), { 'Content-Type': 'text/html; charset=utf-8' });
      // fichiers statiques
      let f = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
      if (!f.startsWith(PUBLIC + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (path.extname(p)) throw notFound(); f = path.join(PUBLIC, 'index.html'); }
      return send(res, 200, fs.readFileSync(f), { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error(e); return json(res, 500, { error: 'Erreur interne du serveur' });
    }
  });
  return server;
}

module.exports = { createApp };
