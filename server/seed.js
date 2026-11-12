'use strict';
// Jeu de données fictif et déterministe (aucune donnée personnelle réelle).
const { open, reset, hashPassword, tx } = require('./db');
const U = require('./util');
const R = require('./rules');

function prng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const PRENOMS_H = ['Mohamed', 'Ahmed', 'Brahim', 'Hassan', 'Said', 'Abdelaziz', 'Youssef', 'Omar', 'Khalid', 'Mustapha', 'Larbi', 'Salek', 'Ali', 'Bachir', 'Hamdi', 'Sidi Mohamed', 'Mohamed Salem', 'Abdelkader', 'Driss', 'Rachid', 'Hicham', 'Yassine', 'Aziz', 'Lahcen'];
const PRENOMS_F = ['Fatima', 'Khadija', 'Aicha', 'Mariam', 'Salma', 'Zineb', 'Hafsa', 'Nadia', 'Latifa', 'Meryem', 'Sakina', 'Mbarka', 'Hayat', 'Samira', 'Ghalia', 'Mina', 'Soukaina', 'Imane', 'Hind', 'Naima', 'Layla', 'Fadwa'];
const NOMS = ['Ould Ahmed', 'El Ouali', 'Ben Salem', 'Lahlou', 'El Idrissi', 'Bouchra', 'Ould Cheikh', 'Rguibi', 'Tamek', 'Bahaha', 'El Mansouri', 'Ait Brahim', 'Chbihi', 'Daoudi', 'Fakhouri', 'Haddad', 'Jabri', 'Kabbaj', 'Lamrani', 'Mouloud', 'Naciri', 'Ouazzani', 'Sabri', 'Tazi', 'Zaoui', 'Ould Mohamed', 'Ould Brahim', 'Yahdih', 'El Khalil', 'Sbai', 'Alaoui', 'Berrada', 'Cherkaoui', 'El Fassi', 'Guennoun', 'Hajji'];
const DIVISIONS = [
  // [division, localisation, type, [[service, poids]...]]
  ['Cabinet du Wali', 'Wilaya', 'service', [['Secrétariat Particulier', 6], ["Bureau d'Ordre", 8], ['Protocole & Communication', 10]]],
  ['Secrétariat Général', 'Wilaya', 'service', [['Coordination', 8], ['Archives & Documentation', 10]]],
  ['Division des Ressources Humaines', 'Wilaya', 'service', [['Gestion du Personnel', 7], ['Formation & Compétences', 4], ['Paie & Carrières', 6]]],
  ['Division des Affaires Intérieures', 'Wilaya', 'service', [['Affaires Générales', 14], ['Associations & Élections', 9], ['Étrangers & État Civil', 11]]],
  ['Division de l\'Action Sociale', 'Wilaya', 'service', [['Programmes Sociaux', 10], ['INDH', 9]]],
  ['Division du Budget & des Marchés', 'Wilaya', 'service', [['Budget', 8], ['Marchés Publics', 8], ['Comptabilité', 8]]],
  ['Division Urbanisme & Équipement', 'Wilaya', 'service', [['Urbanisme', 8], ['Domaine & Patrimoine', 8]]],
  ['Division des Collectivités Territoriales', 'Wilaya', 'service', [['Contrôle de Légalité', 9], ['Finances Locales', 7]]],
  ['Division des Systèmes d\'Information', 'Wilaya', 'service', [['Développement', 7], ['Infrastructure & Réseaux', 8]]],
  ['Province d\'Oued Ed-Dahab', 'Province Oued Ed-Dahab', 'service', [['Secrétariat de la Province', 12]]],
  ['Pachalik de Dakhla', 'Province Oued Ed-Dahab', 'annexe', [['Annexe Administrative 1', 24], ['Annexe Administrative 2', 24], ['Annexe Administrative 3', 22], ['Annexe Administrative 4', 20], ['Services du Pachalik', 30]]],
  ['Caïdats d\'Oued Ed-Dahab', 'Province Oued Ed-Dahab', 'caidat', [['Caïdat de Gleibat Foula', 14], ['Caïdat d\'Imlili', 12], ['Caïdat de Bir Anzarane', 14], ['Caïdat de Lagouira', 10], ['Caïdat d\'El Argoub', 12]]],
  ['Province d\'Aousserd', 'Province Aousserd', 'service', [['Secrétariat de la Province', 14], ['Affaires Générales', 14], ['Annexe Administrative d\'Aousserd', 16]]],
  ['Caïdats d\'Aousserd', 'Province Aousserd', 'caidat', [['Caïdat d\'Aousserd', 14], ['Caïdat de Tichla', 10], ['Caïdat de Zoug', 12]]],
];
const TARGET = 485;

async function seed(db, { today = U.today() } = {}) {
  const rnd = prng(20261112);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const wpick = (pairs) => { let t = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((t -= w) < 0) return v; } return pairs.at(-1)[0]; };
  const Y = Number(today.slice(0, 4));
  const yStart = `${Y}-01-01`;
  const dt = (d, h = ri(8, 17), m = ri(0, 59)) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const randDate = (a, b) => U.addDays(a, ri(0, Math.max(0, U.diffDays(a, b))));
  const nextWork = (d) => { while (!U.isWorkday(d)) d = U.addDays(d, 1); return d; };
  const endAfter = (start, wd) => { let d = start, n = 1; while (n < wd) { d = U.addDays(d, 1); if (U.isWorkday(d)) n++; } return d; };

  await tx(db, async () => {
    // --- Règles paramétrables
    await db.prepare('INSERT INTO regles_echelon VALUES (?,?,?)').run('rapide', 24, 30);
    await db.prepare('INSERT INTO regles_echelon VALUES (?,?,?)').run('moyen', 30, 50);
    await db.prepare('INSERT INTO regles_echelon VALUES (?,?,?)').run('lent', 36, 20);
    const rg = db.prepare('INSERT INTO regles_grade (grade_from,grade_to,echelon_min,anciennete_min_ans,mode,quota_pct) VALUES (?,?,?,?,?,?)');
    await rg.run('3ème grade', '2ème grade', 4, 4, 'choix', 30); await rg.run('2ème grade', '1er grade', 5, 5, 'choix', 30); await rg.run('1er grade', 'Grade principal', 6, 6, 'choix', 25);
    await rg.run('3ème grade', '2ème grade', 3, 3, 'examen', 100);

    // --- Services
    const insS = db.prepare('INSERT INTO services (nom,division,localisation,type_entite) VALUES (?,?,?,?)');
    const services = [];
    let wsum = 0; DIVISIONS.forEach((d) => d[3].forEach((s) => (wsum += s[1])));
    let alloc = 0;
    for (const [div, loc, type, list] of DIVISIONS) for (const [nom, w] of list) {
      const id = Number((await insS.run(nom, div, loc, type === 'service' ? 'service' : (nom.startsWith('Caïdat') ? 'caidat' : (nom.startsWith('Annexe') ? 'annexe' : 'service')))).lastInsertRowid);
      const n = Math.round((w * TARGET) / wsum); services.push({ id, div, loc, nom, n }); alloc += n;
    }
    services[services.length - 1].n += TARGET - alloc;

    // --- Formateurs
    const insF = db.prepare('INSERT INTO formateurs (nom,organisme,specialite,email) VALUES (?,?,?,?)');
    for (const f of [['Pr. Karim Bensouda', 'Université Ibn Zohr', 'Droit administratif'], ['Mme Laila Ouahbi', 'ENA Rabat', 'Marchés publics'], ['M. Reda Skalli', 'Direction des Systèmes d\'Information (MI)', 'Systèmes d\'information'], ['Dr Nawal Berhili', 'Institut des Hautes Études de Gestion', 'Management territorial'], ['M. Tarik Amrani', 'Cabinet Compétences Sud', 'Gestion des ressources humaines'], ['Mme Sanaa Idrissi', 'Institut de Langues Dakhla', 'Communication administrative']]) await insF.run(f[0], f[1], f[2], null);

    // --- Fonctionnaires
    const insE = db.prepare(`INSERT INTO employees (ppr,cin,nom,prenom,sexe,date_naissance,date_recrutement,email,telephone,situation_familiale,nb_enfants,diplome,corps,echelle,echelon,grade,rythme,poste,service_id,cadre_sup,statut,date_depart,motif_depart,solde_conges,date_dernier_echelon,date_dernier_grade,date_prise_service)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const used = new Set(); let seq = 0;
    const makeEmp = async (svc, { statut = 'actif', hireWindow = null, depart = null } = {}) => {
      const sexe = rnd() < 0.38 ? 'F' : 'H';
      let prenom, nom, key;
      do { prenom = pick(sexe === 'F' ? PRENOMS_F : PRENOMS_H); nom = pick(NOMS); key = prenom + nom; } while (used.has(key) && used.size < 600 && rnd() < 0.9);
      used.add(key);
      const corps = svc.nom.includes('Développement') || svc.nom.includes('Infrastructure') ? wpick([['Ingénieur', 40], ['Technicien', 35], ['Administrateur', 15], ['Rédacteur', 10]])
        : svc.nom.startsWith('Caïdat') || svc.nom.startsWith('Annexe') ? wpick([['Adjoint administratif', 40], ['Rédacteur', 30], ['Technicien', 12], ['Administrateur', 18]])
          : wpick([['Adjoint administratif', 26], ['Rédacteur', 22], ['Technicien', 14], ['Administrateur', 28], ['Ingénieur', 10]]);
      const ageHire = ri(22, 34);
      let hire;
      if (hireWindow) hire = randDate(hireWindow[0], hireWindow[1]);
      else { let y = wpick([[ri(0, 7), 30], [ri(8, 18), 35], [ri(19, 35), 35]]); if (ageHire + y > 61) y = 61 - ageHire - ri(0, 3); hire = U.addDays(today, -Math.round(y * 365.25) - ri(0, 360)); }
      if (hire > today) hire = today;
      const birth = U.addDays(hire, -Math.round(ageHire * 365.25) - ri(0, 360));
      const endRef = depart || today;
      const yrs = U.yearsBetween(hire, endRef);
      const gi = yrs < 6 ? 0 : yrs < 14 ? 1 : yrs < 22 ? 2 : 3;
      const echelon = Math.min(10, 1 + Math.floor(yrs / 2.8));
      const dEch = U.addDays(endRef, -ri(100, 1100)); const dernierEch = dEch < hire ? hire : dEch;
      const gStart = [0, 6, 14, 22][gi]; let dg = U.addMonths(hire, gStart * 12 + ri(0, 24)); if (dg > endRef) dg = U.addDays(endRef, -ri(200, 900)); if (dg < hire || gi === 0) dg = hire;
      seq++;
      const ppr = String(1000000 + seq * 7 + ri(0, 5));
      const email = `${prenom}.${nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z.]/g, '') + seq + '@wilaya-dakhla.example';
      const sf = birth < '1990-01-01' ? wpick([['Marié(e)', 75], ['Célibataire', 12], ['Divorcé(e)', 8], ['Veuf(ve)', 5]]) : wpick([['Marié(e)', 45], ['Célibataire', 52], ['Divorcé(e)', 3]]);
      const id = Number((await insE.run(ppr, 'EH' + String(100000 + ri(0, 899999)), nom, prenom, sexe, birth, hire, email, '06' + String(ri(10000000, 99999999)), sf, sf === 'Marié(e)' ? ri(0, 4) : 0, R.CORPS[corps].diplome, corps, R.CORPS[corps].echelle, echelon, R.GRADES[gi], wpick([['rapide', 25], ['moyen', 50], ['lent', 25]]), corps === 'Adjoint administratif' ? 'Adjoint administratif' : `${corps} - ${svc.nom}`, svc.id, corps === 'Administrateur' || corps === 'Ingénieur' ? 1 : 0, statut, depart, depart ? pick(['Retraite', 'Démission', 'Mutation', 'Détachement', 'Décès']) : null, 22, dernierEch, dg, hire)).lastInsertRowid);
      return id;
    };
    const hireNew = [];
    // embauches récentes: ~22 cette année, ~25 l'an dernier
    const recent = [];
    for (const s of services) for (let i = 0; i < s.n; i++) recent.push(s);
    const shuffled = recent.map((s) => [rnd(), s]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    for (const [i, s] of shuffled.entries()) {
      let w = null;
      if (i < 22) w = [yStart, U.addDays(today, -3)]; else if (i < 47) w = [`${Y - 1}-01-01`, `${Y - 1}-12-31`];
      const id = await makeEmp(s, { hireWindow: w }); if (w) hireNew.push(id);
    }
    // départs: 15 cette année, 21 l'an dernier (fonctionnaires aujourd'hui « partis »)
    for (let i = 0; i < 36; i++) {
      const s = pick(services);
      const early = i < 3; // départs de recrues de l'an dernier (rétention à 1 an)
      const dep = early ? randDate(`${Y}-01-05`, `${Y}-02-20`) : i < 15 ? randDate(yStart, U.addDays(today, -5)) : randDate(`${Y - 1}-01-01`, `${Y - 1}-12-31`);
      await makeEmp(s, { statut: 'parti', depart: dep, hireWindow: early ? [`${Y - 1}-03-01`, `${Y - 1}-04-30`] : [`${Y - 30}-01-01`, `${Y - 3}-12-31`] });
    }
    // Chefs de service (fonctionnaire le plus ancien parmi cadres) + échelle hors échelle pour chefs de division
    const divSeen = new Set();
    for (const s of services) {
      const c = await db.prepare("SELECT id FROM employees WHERE service_id=? AND statut='actif' ORDER BY cadre_sup DESC, date_recrutement LIMIT 1").get(s.id);
      if (!c) continue;
      await db.prepare('UPDATE services SET chef_id=? WHERE id=?').run(c.id, s.id);
      const first = !divSeen.has(s.div); divSeen.add(s.div);
      const isWilaya = s.loc === 'Wilaya' && first;
      await db.prepare("UPDATE employees SET cadre_sup=1, poste=?, corps=CASE WHEN ?=1 THEN 'Administrateur' ELSE corps END, echelle=CASE WHEN ?=1 THEN 'HE' ELSE echelle END, grade=CASE WHEN ?=1 THEN 'Grade principal' ELSE grade END, echelon=CASE WHEN ?=1 THEN 10 ELSE echelon END WHERE id=?")
        .run(isWilaya ? `Chef de ${s.div.replace(/^Division (des |du |de l'|de la |d')?/, 'Division ')}` : `Chef de ${/^(Caïdat)/.test(s.nom) ? s.nom : 'Service ' + s.nom}`, isWilaya ? 1 : 0, isWilaya ? 1 : 0, isWilaya ? 1 : 0, isWilaya ? 1 : 0, c.id);
    }

    // Scénario de démonstration : Annexe 3 — plusieurs départs à la retraite proches
    const hotSvc = await db.prepare("SELECT id FROM services WHERE nom='Annexe Administrative 3'").get();
    const hotEmps = await db.prepare("SELECT e.id FROM employees e WHERE e.service_id=? AND e.statut='actif' AND e.id NOT IN (SELECT chef_id FROM services WHERE chef_id IS NOT NULL) ORDER BY e.id LIMIT 3").all(hotSvc.id);
    for (const [i, e] of hotEmps.entries()) { const birth = U.addDays(U.addMonths(today, -63 * 12), 60 + i * 90); const hire = U.addMonths(birth, 25 * 12); await db.prepare('UPDATE employees SET date_naissance=?, date_recrutement=?, date_prise_service=?, date_dernier_echelon=?, date_dernier_grade=?, corps=?, echelle=?, grade=?, echelon=10 WHERE id=?').run(birth, hire, hire, U.addMonths(today, -20), U.addMonths(hire, 120), 'Rédacteur', '9', 'Grade principal', e.id); }

    // --- Comptes de démonstration
    const insU = db.prepare('INSERT INTO users (username,hash,salt,role,employee_id,nom_affichage) VALUES (?,?,?,?,?,?)');
    const mk = async (u, role, emp, nom) => { const h = hashPassword('demo1234'); await insU.run(u, h.hash, h.salt, role, emp, nom); };
    const sid = (nom, div) => db.prepare('SELECT id, chef_id FROM services WHERE nom=? AND division=?').get(nom, div);
    const gp = await sid('Gestion du Personnel', 'Division des Ressources Humaines');
    const ag = await sid('Affaires Générales', 'Division des Affaires Intérieures');
    await mk('wali', 'wali', null, 'M. le Wali de la Région');
    await mk('drh', 'drh', gp.chef_id, 'Chef de la DRH');
    await mk('chef', 'chef', ag.chef_id, 'Chef de Service (Affaires Générales)');
    const agent = await db.prepare("SELECT id FROM employees WHERE service_id=? AND statut='actif' AND id<>? ORDER BY date_recrutement LIMIT 1").get(ag.id, ag.chef_id);
    await mk('agent', 'fonctionnaire', agent.id, 'Fonctionnaire (démo)');

    // --- Congés & absences
    const actifs = await db.prepare("SELECT id, service_id, date_recrutement FROM employees WHERE statut='actif'").all();
    const insL = db.prepare('INSERT INTO leaves (employee_id,type,date_debut,date_fin,jours,motif,statut,avis_chef,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insA = db.prepare('INSERT INTO absences (employee_id,date_debut,date_fin,jours,type,statut_justif,justification,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const used_by = {};
    for (const e of actifs) {
      for (let m = 0; m <= Number(today.slice(5, 7)) - 1; m++) {
        const ms = `${Y}-${String(m + 1).padStart(2, '0')}-01`; const me = U.addDays(U.addMonths(ms, 1), -1);
        const from = ms < e.date_recrutement ? e.date_recrutement : ms; if (from > me) continue;
        const frac = me > today ? U.diffDays(ms, today) / 30 : 1; // mois en cours : prorata
        if (rnd() < 0.09 * frac) {
          const type = wpick([['annuel', 82], ['exceptionnel', 16], ['pelerinage', 2]]);
          const len = type === 'annuel' ? ri(2, 9) : type === 'exceptionnel' ? 3 : 20;
          const s = nextWork(randDate(from, me > today ? today : me)); const en = endAfter(s, len); const j = U.workdays(s, en);
          await insL.run(e.id, type, s, en, j, null, 'valide', 'favorable', dt(U.addDays(s, -ri(7, 25))), dt(U.addDays(s, -ri(2, 6))));
          if (type === 'annuel') used_by[e.id] = (used_by[e.id] || 0) + j;
        }
        const hot = e.service_id === hotSvc.id && m >= Number(today.slice(5, 7)) - 2;
        if (rnd() < (hot ? 0.6 : 0.14) * frac) {
          const s = nextWork(randDate(from, me > today ? today : me)); const len = ri(1, 4); const en = endAfter(s, len); const j = U.workdays(s, en);
          const type = rnd() < 0.55 ? 'maladie' : 'absence'; const recentAbs = U.diffDays(s, today) < 14;
          let st;
          if (recentAbs) st = rnd() < 0.4 ? 'soumise' : 'aucune';
          else st = type === 'maladie' ? wpick([['validee', 62], ['rejetee', 8], ['soumise', 5], ['aucune', 25]]) : wpick([['aucune', 55], ['validee', 20], ['rejetee', 25]]);
          await insA.run(e.id, s, en, j, type, st, st === 'aucune' ? null : (type === 'maladie' ? 'Certificat médical joint' : 'Justificatif administratif'), dt(U.addDays(en, 1)), ['validee', 'rejetee'].includes(st) ? dt(U.addDays(en, ri(2, 6))) : null);
        }
      }
    }
    for (const e of actifs) await db.prepare('UPDATE employees SET solde_conges=? WHERE id=?').run(Math.max(-2, R.SOLDE_ANNUEL + ri(0, 9) - (used_by[e.id] || 0)), e.id);
    // demandes en cours
    for (let i = 0; i < 14; i++) {
      const e = pick(actifs); const s = nextWork(U.addDays(today, ri(5, 25))); const en = endAfter(s, ri(2, 8));
      const st = pick(['en_attente_chef', 'en_attente_chef', 'en_attente_drh', 'valide']);
      await insL.run(e.id, 'annuel', s, en, U.workdays(s, en), 'Congé annuel', st, st === 'en_attente_chef' ? null : 'favorable', dt(U.addDays(today, -ri(1, 6))), st === 'valide' ? dt(U.addDays(today, -1)) : null);
    }

    // --- CAP & avancements
    await db.prepare('INSERT INTO caps (date_session,objet,statut) VALUES (?,?,?)').run(`${Y}-03-18`, `Avancement de grade ${Y} (session 1)`, 'tenue');
    await db.prepare('INSERT INTO caps (date_session,objet,statut) VALUES (?,?,?)').run(`${Y}-12-10`, `Avancement de grade ${Y} (session 2)`, 'planifiee');
    const insP = db.prepare('INSERT INTO promotions (employee_id,type,de_valeur,a_valeur,mode,cap_id,statut,ref_decision,opened_at,decided_at,annee) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const pool = await db.prepare("SELECT id, echelon, grade FROM employees WHERE statut='actif' AND date_recrutement < ? ORDER BY RANDOM()").all(`${Y - 4}-01-01`);
    let k = 0;
    for (let i = 0; i < 38; i++) { const e = pool[k++]; if (e.echelon < 2) continue; const op = randDate(yStart, U.addDays(today, -100)); const de = U.addDays(op, ri(18, 75)); await insP.run(e.id, 'echelon', String(e.echelon - 1), String(e.echelon), 'moyen', null, 'valide', `Décision n° ${ri(100, 900)}/${Y}`, op, de, Y); await db.prepare('UPDATE employees SET date_dernier_echelon=? WHERE id=?').run(de, e.id); }
    for (let i = 0; i < 14; i++) { const e = pool[k++]; const gi = R.GRADES.indexOf(e.grade); if (gi < 1) continue; const op = randDate(yStart, `${Y}-03-01`); const de = `${Y}-03-18`; await insP.run(e.id, 'grade', R.GRADES[gi - 1], e.grade, 'choix', 1, 'valide', `Arrêté n° ${ri(10, 99)}/${Y}`, op, de, Y); await db.prepare('UPDATE employees SET date_dernier_grade=? WHERE id=?').run(de, e.id); }
    for (let i = 0; i < 5; i++) { const e = pool[k++]; const op = randDate(yStart, U.addDays(today, -100)); await insP.run(e.id, 'echelon', String(e.echelon), String(Math.min(10, e.echelon + 1)), 'moyen', null, 'rejete', 'Dossier incomplet', op, U.addDays(op, ri(20, 60)), Y); }
    R.generatePromotions(db, today);

    // --- Formation
    const forms = (await db.prepare('SELECT id FROM formateurs').all()).map((x) => x.id);
    const insT = db.prepare('INSERT INTO trainings (titre,domaine,date_debut,date_fin,heures,lieu,capacite,formateur_id,statut,description) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insEn = db.prepare('INSERT INTO enrollments (training_id,employee_id,statut,note_satisfaction,convoque_at) VALUES (?,?,?,?,?)');
    const catalog = [
      ['Droit administratif et contentieux', 'Droit administratif', 21], ['Passation des marchés publics', 'Marchés publics', 28], ['Sécurité des systèmes d\'information', 'Systèmes d\'information', 14],
      ['Management territorial', 'Management territorial', 35], ['Gestion des carrières dans la fonction publique', 'Gestion RH', 14], ['Rédaction administrative', 'Communication', 7],
      ['Contrôle de légalité des actes locaux', 'Droit administratif', 21], ['Bureautique avancée & tableaux de bord', 'Systèmes d\'information', 14], ['Finances locales', 'Management territorial', 21],
      ['Accueil et relation avec l\'usager', 'Communication', 7], ['Marchés publics : exécution et contrôle', 'Marchés publics', 14], ['Transformation digitale de l\'administration', 'Systèmes d\'information', 21], ['Droit des associations', 'Droit administratif', 7], ['Archivage et gestion documentaire', 'Gestion RH', 14],
    ];
    const target = { termine: 9, cours: 3, plan: 2 };
    const lieux = ['Salle de conférences - Wilaya', 'Centre de formation - Dakhla', 'Visioconférence'];
    const pickEmps = (n) => [...actifs].sort(() => rnd() - 0.5).slice(0, n);
    for (const [i, c] of catalog.entries()) {
      const kind = i < 9 ? 'termine' : i < 12 ? 'cours' : 'plan';
      let d1, d2, st;
      if (kind === 'termine') { d1 = U.addDays(yStart, 10 + i * 30); d2 = U.addDays(d1, Math.ceil(c[2] / 7)); st = 'terminee'; }
      else if (kind === 'cours') { d1 = U.addDays(today, -2); d2 = U.addDays(today, 3 + (i - 9)); st = 'en_cours'; }
      else { d1 = U.addDays(today, 20 + (i - 12) * 14); d2 = U.addDays(d1, 3); st = 'planifiee'; }
      const size = kind === 'cours' ? [44, 40, 40][i - 9] : kind === 'termine' ? ri(30, 45) : 0;
      const tid = Number((await insT.run(c[0], c[1], d1, d2, c[2], pick(lieux), kind === 'plan' ? 40 : Math.max(size, 40), pick(forms), st, `Session de renforcement des capacités : ${c[1]}.`)).lastInsertRowid);
      if (kind === 'termine') for (const e of pickEmps(size)) { const pres = rnd() < 0.86; await insEn.run(tid, e.id, pres ? 'present' : 'absent', pres ? wpick([[5, 38], [4, 44], [3, 14], [2, 4]]) : null, dt(U.addDays(d1, -14))); }
      if (kind === 'cours') for (const e of pickEmps(size)) await insEn.run(tid, e.id, rnd() < 0.85 ? 'confirme' : 'convoque', null, dt(U.addDays(d1, -10)));
    }
    // convocations à venir (dont l'agent démo)
    const planned = await db.prepare("SELECT id FROM trainings WHERE statut='planifiee'").all();
    for (const t of planned) { for (const e of pickEmps(18)) await insEn.run(t.id, e.id, 'convoque', null, dt(U.addDays(today, -1))); }
    await db.prepare("INSERT INTO enrollments (training_id,employee_id,statut,convoque_at) VALUES (?,?,'convoque',?) ON CONFLICT (training_id,employee_id) DO UPDATE SET statut='convoque', convoque_at=EXCLUDED.convoque_at").run(planned[0].id, agent.id, dt(today));

    // --- Recrutements
    const insR = db.prepare('INSERT INTO recruitments (poste,source,candidat,date_candidature,date_offre,date_acceptation,statut,cout,employee_id) VALUES (?,?,?,?,?,?,?,?,?)');
    const hires = await db.prepare("SELECT id, nom, prenom, corps, date_recrutement h FROM employees WHERE date_recrutement >= ? AND date_recrutement <= ?").all(`${Y - 1}-01-01`, today);
    for (const e of hires) {
      const acc = U.addDays(e.h, -ri(5, 20)); const off = U.addDays(acc, -ri(3, 10)); const cand = U.addDays(off, -ri(25, 70));
      await insR.run(e.corps, 'externe', `${e.prenom} ${e.nom}`, cand, off, acc, 'acceptee', ri(4500, 11000), e.id);
    }
    for (let i = 0; i < 8; i++) { const off = randDate(yStart, U.addDays(today, -10)); await insR.run(pick(Object.keys(R.CORPS)), 'externe', `${pick(PRENOMS_H.concat(PRENOMS_F))} ${pick(NOMS)}`, U.addDays(off, -ri(20, 60)), off, null, 'refusee', ri(3500, 8000), null); }
    for (let i = 0; i < 4; i++) { const off = U.addDays(today, -ri(2, 12)); await insR.run(pick(Object.keys(R.CORPS)), 'externe', `${pick(PRENOMS_H.concat(PRENOMS_F))} ${pick(NOMS)}`, U.addDays(off, -ri(20, 40)), off, null, 'emise', ri(3500, 8000), null); }
    const chefs = await db.prepare("SELECT id, nom, prenom FROM employees WHERE statut='actif' ORDER BY RANDOM() LIMIT 9").all();
    for (const c of chefs) { const acc = randDate(yStart, U.addDays(today, -5)); const off = U.addDays(acc, -ri(2, 5)); await insR.run('Chef de service (nomination interne)', 'interne', `${c.prenom} ${c.nom}`, U.addDays(off, -ri(10, 30)), off, acc, 'acceptee', ri(600, 2000), c.id); }

    // --- Attestations (e-services)
    const insAt = db.prepare('INSERT INTO attestations (employee_id,type,code,params,statut,requested_at,signed_at,signed_by) VALUES (?,?,?,?,?,?,?,?)');
    const codeGen = () => 'AT-' + Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[ri(0, 31)]).join('');
    const monthsElapsed = Number(today.slice(5, 7));
    for (let m = 1; m <= monthsElapsed; m++) {
      const ms = `${Y}-${String(m).padStart(2, '0')}-01`; const me = m === monthsElapsed ? today : U.addDays(U.addMonths(ms, 1), -1);
      const n = ri(30, 55);
      for (let i = 0; i < n; i++) {
        const e = pick(actifs); const type = wpick([['travail', 45], ['salaire', 30], ['mission', 12], ['conge', 13]]);
        const d = nextWork(randDate(ms, me)); const d0 = d > today ? today : d; const req = dt(d0);
        if (type === 'travail' || type === 'salaire') await insAt.run(e.id, type, codeGen(), '{}', 'signee', req, req, 'Signature électronique automatique');
        else { const delayH = wpick([[ri(2, 8), 50], [ri(9, 30), 35], [ri(31, 72), 15]]); const sg = new Date(new Date(req + 'Z').getTime() + delayH * 3600e3).toISOString().slice(0, 19); const pend = d0 >= U.addDays(today, -1) && rnd() < 0.7; await insAt.run(e.id, type, codeGen(), type === 'mission' ? JSON.stringify({ destination: 'Laâyoune', objet: 'Réunion de coordination', date_debut: U.addDays(d0, 5), date_fin: U.addDays(d0, 6) }) : '{}', pend ? 'en_attente' : 'signee', req, pend ? null : sg, pend ? null : 'Chef DRH'); }
      }
    }
    await insAt.run(agent.id, 'travail', codeGen(), '{}', 'signee', dt(U.addDays(today, -9)), dt(U.addDays(today, -9)), 'Signature électronique automatique');

    // --- Notifications de démonstration
    const nU = await db.prepare('SELECT id, username FROM users').all(); const ins = db.prepare('INSERT INTO notifications (user_id,message,lien,created_at) VALUES (?,?,?,?)');
    for (const u of nU) if (u.username === 'drh') await ins.run(u.id, 'Des propositions d\'avancement sont en attente de validation.', '#/avancements', dt(today));
    for (const u of nU) if (u.username === 'agent') await ins.run(u.id, 'Vous êtes convoqué(e) à une session de formation : veuillez confirmer votre présence.', '#/formations', dt(today));
  });
}

module.exports = { seed };

if (require.main === module) {
  (async () => {
    const db = await open();
    if (process.argv.includes('--reset')) await reset(db);
    if ((await db.prepare('SELECT COUNT(*) c FROM employees').get()).c) { console.log('Base déjà peuplée (utiliser --reset).'); await db.close(); return; }
    await seed(db);
    const c = async (t, w = 'TRUE') => (await db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${w}`).get()).c;
    const n = { a: await c('employees', "statut='actif'"), p: await c('employees', "statut='parti'"), l: await c('leaves'), b: await c('absences'), v: await c('promotions'), f: await c('trainings'), t: await c('attestations') };
    await db.close();
    console.log(`OK: ${n.a} actifs, ${n.p} partis, ${n.l} congés, ${n.b} absences, ${n.v} avancements, ${n.f} formations, ${n.t} attestations`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
