'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { open, dropSchema } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');
const U = require('./util');

// Chaque exécution utilise un schéma PostgreSQL jetable (DATABASE_URL requis).
let db, server, base;
test.before(async () => {
  db = await open({ schema: 't_' + Math.random().toString(36).slice(2, 10) }); await seed(db); server = createApp(db);
  await new Promise((r) => server.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; r(); }));
});
test.after(async () => { server.close(); await dropSchema(db); });

async function as(user) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: 'demo1234' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, method = 'GET', body) => { const x = await fetch(base + '/api' + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); return { status: x.status, body: await x.json().catch(() => null) }; };
}

test('workdays exclut week-ends et fériés', () => { assert.equal(U.workdays('2026-11-02', '2026-11-08'), 4); /* 6 nov férié */ });
test('login refusé avec mauvais mot de passe', async () => { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'drh', password: 'x' }) }); assert.equal(r.status, 401); });
test('API protégée sans session', async () => { assert.equal((await fetch(base + '/api/dashboard')).status, 401); });
test('le wali voit le tableau de bord mais pas les dossiers', async () => {
  const w = await as('wali'); const d = await w('/dashboard'); assert.equal(d.status, 200); assert.equal(d.body.entete.effectif, 485); assert.equal(d.body.formation.sessions_en_cours, 3);
  assert.equal((await w('/employees')).status, 403); assert.equal((await w('/leaves')).status, 403);
});
test('formules : rétention = (fin - embauches) / début', async () => { const d = (await (await as('drh'))('/dashboard')).body.rh; assert.equal(d.retention, Math.round(((d.effectif_fin - d.embauches) / d.effectif_debut) * 1000) / 10); });
test('un fonctionnaire ne voit que son dossier', async () => {
  const a = await as('agent'); const me = (await a('/me')).body; assert.equal((await a('/employees/' + me.employee_id)).status, 200); assert.equal((await a('/employees/1')).status, 403); assert.equal((await a('/employees')).status, 403);
});
test('circuit de congé : agent -> chef -> DRH, solde décrémenté', async () => {
  const a = await as('agent'), c = await as('chef'), d = await as('drh'); const me = (await a('/me')).body; const before = (await a('/employees/' + me.employee_id)).body.solde_conges;
  const start = U.addDays(U.today(), 60); const s = [0, 1, 2, 3, 4, 5, 6].map((i) => U.addDays(start, i)).find(U.isWorkday);
  const r = await a('/leaves', 'POST', { type: 'annuel', date_debut: s, date_fin: s }); assert.equal(r.status, 200); assert.equal(r.body.statut, 'en_attente_chef');
  assert.equal((await d(`/leaves/${r.body.id}/decision`, 'POST', { action: 'valider' })).status, 200); // DRH peut valider directement
  assert.equal((await a('/employees/' + me.employee_id)).body.solde_conges, before - 1);
  assert.equal((await a(`/leaves/${r.body.id}/decision`, 'POST', { action: 'valider' })).status, 403);
  assert.equal((await c('/leaves/' + r.body.id + '/decision', 'POST', { action: 'favorable' })).status, 403);
});
test('justification validée sort du taux d\'absentéisme', async () => {
  const d = await as('drh'); const before = (await d('/dashboard')).body.assiduite.annee.abs_non_justifiees;
  const list = (await d('/absences?statut_justif=aucune')).body; const a = list.find((x) => x.date_fin >= U.today().slice(0, 4) + '-01-01'); assert.ok(a);
  assert.equal((await d(`/absences/${a.id}/justify`, 'POST', { justification: 'Certificat n°1' })).status, 200);
  assert.equal((await d(`/absences/${a.id}/decision`, 'POST', { action: 'valider' })).status, 200);
  assert.ok((await d('/dashboard')).body.assiduite.annee.abs_non_justifiees < before);
});
test('avancement : validation applique le nouvel échelon', async () => {
  const d = await as('drh'); const p = (await d('/promotions?statut=propose&type=echelon')).body[0]; assert.ok(p);
  assert.equal((await d(`/promotions/${p.id}/decision`, 'POST', { action: 'valider' })).status, 400); // référence obligatoire
  assert.equal((await d(`/promotions/${p.id}/decision`, 'POST', { action: 'valider', ref_decision: 'Décision 1/2026' })).status, 200);
  assert.equal((await d('/employees/' + p.employee_id)).body.echelon, Number(p.a_valeur));
});
test('création de fonctionnaire + compte + validation des champs', async () => {
  const d = await as('drh'); const svc = (await d('/refs')).body.services[0].id;
  assert.equal((await d('/employees', 'POST', { nom: 'X' })).status, 400);
  const r = await d('/employees', 'POST', { nom: 'Test', prenom: 'Nouveau', sexe: 'F', date_naissance: '1999-01-01', date_recrutement: U.today(), corps: 'Rédacteur', service_id: svc }); assert.equal(r.status, 200); assert.ok(r.body.mot_de_passe_temporaire);
  const l = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: r.body.ppr, password: r.body.mot_de_passe_temporaire }) }); assert.equal(l.status, 200);
});
test('attestations : travail auto-signée, mission à signer, vérification publique', async () => {
  const a = await as('agent'), d = await as('drh');
  const t = await a('/attestations', 'POST', { type: 'travail' }); assert.equal(t.body.statut, 'signee');
  const m = await a('/attestations', 'POST', { type: 'mission', destination: 'Rabat', objet: 'Réunion', date_debut: U.today(), date_fin: U.today() }); assert.equal(m.body.statut, 'en_attente');
  const list = (await a('/attestations')).body; const id = list.find((x) => x.code === t.body.code).id;
  const ck = (await a('/me')).body; assert.ok(ck);
  assert.equal((await d(`/attestations/${m.body.id}/sign`, 'POST')).status, 200);
  const v = await fetch(base + '/verify/' + t.body.code); assert.match(await v.text(), /Document authentique/);
  assert.match(await (await fetch(base + '/verify/AT-ZZZZZZZZZZ')).text(), /non reconnu/);
  assert.ok(id);
});
test('convocation et confirmation de formation', async () => {
  const d = await as('drh'), a = await as('agent'); const me = (await a('/me')).body.employee_id;
  const tr = (await a('/trainings')).body.find((t) => t.mon_inscription?.statut === 'convoque'); assert.ok(tr);
  assert.equal((await a(`/enrollments/${tr.mon_inscription.id}/respond`, 'POST', { action: 'confirme' })).status, 200);
  assert.equal((await a(`/enrollments/${tr.mon_inscription.id}/attendance`, 'POST', { present: true })).status, 403);
  assert.ok(me);
});
test('pas de fuite de traversée de chemin', async () => { assert.equal((await fetch(base + '/..%2fserver/db.js')).status, 404); });

test('copilote : file priorisée, accès réservé, exécution après validation', async () => {
  const w = await as('wali'), a = await as('agent');
  assert.equal((await a('/copilot/decisions')).status, 403);
  const l = await w('/copilot/decisions'); assert.equal(l.status, 200); assert.ok(l.body.length >= 3);
  assert.equal(l.body[0].priorite, 'HAUTE'); const ranks = l.body.map((x) => x.priorite_info.rang); assert.deepEqual(ranks, [...ranks].sort());
  const red = l.body.find((x) => x.action_type === 'redeploy'); assert.ok(red);
  assert.equal((await w(`/copilot/decisions/${red.id}/action`, 'POST', { action: 'adjust' })).status, 400);
  const r = await w(`/copilot/decisions/${red.id}/action`, 'POST', { action: 'adjust', params: { n: 1, jours: 15 } }); assert.equal(r.status, 200); assert.match(r.body.resultat, /1 fonctionnaire/);
  assert.equal((await w(`/copilot/decisions/${red.id}/action`, 'POST', { action: 'approve' })).status, 409); // pas de double exécution
  const cap = l.body.find((x) => x.action_type === 'convoke_cap'); assert.equal((await w(`/copilot/decisions/${cap.id}/action`, 'POST', { action: 'ignore', note: 'plus tard' })).body.statut, 'ignore');
  assert.ok(!(await w('/copilot/decisions')).body.some((x) => x.id === cap.id)); // une décision ignorée ne revient pas
  assert.ok((await w('/copilot/history')).body.length >= 2);
});
test('affectation temporaire : retour automatique à l\'échéance', async () => {
  const cp = require('./copilot'); const row = await db.prepare("SELECT * FROM affectations_temporaires WHERE statut='en_cours'").get(); assert.ok(row);
  assert.notEqual((await db.prepare('SELECT service_id s FROM employees WHERE id=?').get(row.employee_id)).s, row.service_origine);
  await cp.revertExpired(db, U.addDays(row.date_fin, 1)); assert.equal((await db.prepare('SELECT service_id s FROM employees WHERE id=?').get(row.employee_id)).s, row.service_origine);
});
test('dashboard : formules du cahier des charges (encadrement, avancement, formation)', async () => {
  const d = (await (await as('drh'))('/dashboard')).body; assert.ok(d.effectifs.encadrement_pct > 0); assert.ok(d.assiduite.par_entite.length > 0);
  assert.equal(d.carriere.taux_realisation, Math.round((d.carriere.valides / d.carriere.eligibles) * 1000) / 10); assert.ok(d.formules.some((f) => f.id === 'encad'));
});

test('chef de service : périmètre limité à son équipe', async () => {
  const c = await as('chef'); const team = (await c('/employees')).body; assert.equal((await c('/employees')).status, 200); assert.ok(team.total > 0 && team.total < 60);
  for (const p of ['/leaves', '/absences', '/promotions', '/alerts']) assert.equal((await c(p)).status, 200, p);
  const other = (await (await as('drh'))('/employees?limit=1&service_id=1')).body.items[0]; assert.equal((await c('/employees/' + other.id)).status, 403);
});
