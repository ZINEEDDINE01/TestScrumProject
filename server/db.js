'use strict';
// Accès PostgreSQL. L'API reste proche d'un « prepare/get/all/run » mais asynchrone ;
// les transactions utilisent un client dédié propagé via AsyncLocalStorage.
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

types.setTypeParser(20, (v) => Number(v)); // COUNT/SUM (int8) -> number

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://sigrh:sigrh@localhost:5432/sigrh';
const als = new AsyncLocalStorage();

// Les dates sont stockées en TEXT ISO (AAAA-MM-JJ / AAAA-MM-JJTHH:MM:SS) : comparables lexicalement.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY, nom TEXT NOT NULL, division TEXT NOT NULL,
  localisation TEXT NOT NULL, type_entite TEXT NOT NULL, chef_id INTEGER
);
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY, ppr TEXT UNIQUE NOT NULL, cin TEXT, nom TEXT NOT NULL, prenom TEXT NOT NULL,
  sexe TEXT NOT NULL CHECK (sexe IN ('F','H')), date_naissance TEXT NOT NULL, date_recrutement TEXT NOT NULL,
  email TEXT, telephone TEXT, situation_familiale TEXT, nb_enfants INTEGER DEFAULT 0, diplome TEXT,
  corps TEXT NOT NULL, echelle TEXT NOT NULL, echelon INTEGER NOT NULL, grade TEXT NOT NULL,
  rythme TEXT NOT NULL DEFAULT 'moyen', poste TEXT, service_id INTEGER REFERENCES services(id),
  cadre_sup INTEGER NOT NULL DEFAULT 0, temps_plein INTEGER NOT NULL DEFAULT 1,
  statut TEXT NOT NULL DEFAULT 'actif', date_depart TEXT, motif_depart TEXT,
  solde_conges DOUBLE PRECISION NOT NULL DEFAULT 22, date_dernier_echelon TEXT, date_dernier_grade TEXT,
  date_prise_service TEXT, onboarding TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('wali','drh','chef','fonctionnaire')), employee_id INTEGER REFERENCES employees(id),
  nom_affichage TEXT NOT NULL, must_change INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leaves (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, jours DOUBLE PRECISION NOT NULL, motif TEXT,
  statut TEXT NOT NULL, avis_chef TEXT, commentaire_chef TEXT, commentaire_drh TEXT,
  created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS absences (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
  date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, jours DOUBLE PRECISION NOT NULL, type TEXT NOT NULL,
  statut_justif TEXT NOT NULL DEFAULT 'aucune', justification TEXT, commentaire_drh TEXT,
  declared_by INTEGER, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS regles_echelon (rythme TEXT PRIMARY KEY, duree_mois INTEGER NOT NULL, part_effectif_pct DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS regles_grade (
  id SERIAL PRIMARY KEY, grade_from TEXT NOT NULL, grade_to TEXT NOT NULL, echelon_min INTEGER NOT NULL,
  anciennete_min_ans DOUBLE PRECISION NOT NULL, mode TEXT NOT NULL, quota_pct DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS caps (id SERIAL PRIMARY KEY, date_session TEXT NOT NULL, objet TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'planifiee');
CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  de_valeur TEXT NOT NULL, a_valeur TEXT NOT NULL, mode TEXT, cap_id INTEGER, statut TEXT NOT NULL,
  ref_decision TEXT, opened_at TEXT NOT NULL, decided_at TEXT, annee INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS formateurs (id SERIAL PRIMARY KEY, nom TEXT NOT NULL, organisme TEXT, specialite TEXT, email TEXT);
CREATE TABLE IF NOT EXISTS trainings (
  id SERIAL PRIMARY KEY, titre TEXT NOT NULL, domaine TEXT NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL,
  heures DOUBLE PRECISION NOT NULL, lieu TEXT, capacite INTEGER NOT NULL DEFAULT 30, formateur_id INTEGER REFERENCES formateurs(id),
  statut TEXT NOT NULL DEFAULT 'planifiee', publie INTEGER NOT NULL DEFAULT 1, description TEXT
);
CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY, training_id INTEGER NOT NULL REFERENCES trainings(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
  statut TEXT NOT NULL DEFAULT 'convoque', note_satisfaction INTEGER, convoque_at TEXT, UNIQUE(training_id, employee_id)
);
CREATE TABLE IF NOT EXISTS recruitments (
  id SERIAL PRIMARY KEY, poste TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('externe','interne')),
  candidat TEXT NOT NULL, date_candidature TEXT NOT NULL, date_offre TEXT, date_acceptation TEXT,
  statut TEXT NOT NULL, cout DOUBLE PRECISION NOT NULL DEFAULT 0, employee_id INTEGER REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS attestations (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, params TEXT, statut TEXT NOT NULL, requested_at TEXT NOT NULL, signed_at TEXT, signed_by TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), message TEXT NOT NULL, lien TEXT,
  lu INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_decisions (
  id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type_diagnostic TEXT NOT NULL, priorite TEXT NOT NULL,
  service_id INTEGER REFERENCES services(id), titre TEXT NOT NULL, diagnostic TEXT NOT NULL, impact TEXT NOT NULL,
  cause TEXT, recommandation TEXT NOT NULL, action_type TEXT NOT NULL, params TEXT NOT NULL, methode TEXT,
  statut TEXT NOT NULL DEFAULT 'en_attente', valide_par TEXT, note TEXT, resultat TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS affectations_temporaires (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), service_origine INTEGER NOT NULL,
  service_accueil INTEGER NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, decision_id INTEGER, statut TEXT NOT NULL DEFAULT 'en_cours'
);
CREATE INDEX IF NOT EXISTS ix_leaves_emp ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS ix_abs_emp ON absences(employee_id);
CREATE INDEX IF NOT EXISTS ix_enr_emp ON enrollments(employee_id);
CREATE INDEX IF NOT EXISTS ix_emp_service ON employees(service_id);
CREATE INDEX IF NOT EXISTS ix_promo_emp ON promotions(employee_id);
`;

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const withReturning = (sql) => (/^\s*INSERT\s+INTO\s+(?!regles_echelon)/i.test(sql) && !/RETURNING|ON CONFLICT/i.test(sql) ? sql.replace(/;?\s*$/, '') + ' RETURNING id' : sql);

class Db {
  constructor(pool, schema) { this.pool = pool; this.schema = schema; }
  _q(sql, params) { return (als.getStore()?.client || this.pool).query(toPg(sql), params); }
  exec(sql) { return (als.getStore()?.client || this.pool).query(sql); }
  prepare(sql) {
    return {
      all: async (...p) => (await this._q(sql, p)).rows,
      get: async (...p) => (await this._q(sql, p)).rows[0],
      run: async (...p) => { const r = await this._q(withReturning(sql), p); return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id }; },
    };
  }
  async close() { await this.pool.end(); }
}

// opts.schema : schéma PostgreSQL dédié (tests) ; créé à la demande.
async function open(opts = {}) {
  const schema = opts.schema || null;
  if (schema) { const admin = new Pool({ connectionString: DATABASE_URL, max: 1 }); await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`); await admin.end(); }
  const pool = new Pool({ connectionString: DATABASE_URL, max: 10, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  const db = new Db(pool, schema);
  await db.exec(SCHEMA);
  return db;
}
async function dropSchema(db) {
  if (!db.schema) throw new Error('Refus : pas de schéma dédié');
  await db.pool.end();
  const admin = new Pool({ connectionString: DATABASE_URL, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS ${db.schema} CASCADE`); await admin.end();
}
// Vide toutes les tables (réinitialisation de la démo)
async function reset(db) {
  const t = (await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname=COALESCE(?, current_schema())").all(db.schema)).map((r) => r.tablename);
  if (t.length) await db.exec(`TRUNCATE ${t.map((x) => `"${x}"`).join(',')} RESTART IDENTITY CASCADE`);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}
function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}
async function tx(db, fn) {
  if (als.getStore()) return fn(); // déjà dans une transaction
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await als.run({ client }, fn);
    await client.query('COMMIT');
    return r;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

module.exports = { open, dropSchema, reset, hashPassword, checkPassword, tx, DATABASE_URL };
