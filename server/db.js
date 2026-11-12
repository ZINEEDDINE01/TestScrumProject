'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = process.env.SIGRH_DB || path.join(__dirname, '..', 'data', 'sigrh.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, nom TEXT NOT NULL, division TEXT NOT NULL,
  localisation TEXT NOT NULL, type_entite TEXT NOT NULL, chef_id INTEGER
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY, ppr TEXT UNIQUE NOT NULL, cin TEXT, nom TEXT NOT NULL, prenom TEXT NOT NULL,
  sexe TEXT NOT NULL CHECK (sexe IN ('F','H')), date_naissance TEXT NOT NULL, date_recrutement TEXT NOT NULL,
  email TEXT, telephone TEXT, situation_familiale TEXT, nb_enfants INTEGER DEFAULT 0, diplome TEXT,
  corps TEXT NOT NULL, echelle TEXT NOT NULL, echelon INTEGER NOT NULL, grade TEXT NOT NULL,
  rythme TEXT NOT NULL DEFAULT 'moyen', poste TEXT, service_id INTEGER REFERENCES services(id),
  cadre_sup INTEGER NOT NULL DEFAULT 0, temps_plein INTEGER NOT NULL DEFAULT 1,
  statut TEXT NOT NULL DEFAULT 'actif', date_depart TEXT, motif_depart TEXT,
  solde_conges REAL NOT NULL DEFAULT 22, date_dernier_echelon TEXT, date_dernier_grade TEXT,
  date_prise_service TEXT, onboarding TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('wali','drh','chef','fonctionnaire')), employee_id INTEGER REFERENCES employees(id),
  nom_affichage TEXT NOT NULL, must_change INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, jours REAL NOT NULL, motif TEXT,
  statut TEXT NOT NULL, avis_chef TEXT, commentaire_chef TEXT, commentaire_drh TEXT,
  created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
  date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, jours REAL NOT NULL, type TEXT NOT NULL,
  statut_justif TEXT NOT NULL DEFAULT 'aucune', justification TEXT, commentaire_drh TEXT,
  declared_by INTEGER, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS regles_echelon (rythme TEXT PRIMARY KEY, duree_mois INTEGER NOT NULL, part_effectif_pct REAL NOT NULL);
CREATE TABLE IF NOT EXISTS regles_grade (
  id INTEGER PRIMARY KEY, grade_from TEXT NOT NULL, grade_to TEXT NOT NULL, echelon_min INTEGER NOT NULL,
  anciennete_min_ans REAL NOT NULL, mode TEXT NOT NULL, quota_pct REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS caps (id INTEGER PRIMARY KEY, date_session TEXT NOT NULL, objet TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'planifiee');
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  de_valeur TEXT NOT NULL, a_valeur TEXT NOT NULL, mode TEXT, cap_id INTEGER, statut TEXT NOT NULL,
  ref_decision TEXT, opened_at TEXT NOT NULL, decided_at TEXT, annee INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS formateurs (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, organisme TEXT, specialite TEXT, email TEXT);
CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY, titre TEXT NOT NULL, domaine TEXT NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL,
  heures REAL NOT NULL, lieu TEXT, capacite INTEGER NOT NULL DEFAULT 30, formateur_id INTEGER REFERENCES formateurs(id),
  statut TEXT NOT NULL DEFAULT 'planifiee', publie INTEGER NOT NULL DEFAULT 1, description TEXT
);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY, training_id INTEGER NOT NULL REFERENCES trainings(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
  statut TEXT NOT NULL DEFAULT 'convoque', note_satisfaction INTEGER, convoque_at TEXT, UNIQUE(training_id, employee_id)
);
CREATE TABLE IF NOT EXISTS recruitments (
  id INTEGER PRIMARY KEY, poste TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('externe','interne')),
  candidat TEXT NOT NULL, date_candidature TEXT NOT NULL, date_offre TEXT, date_acceptation TEXT,
  statut TEXT NOT NULL, cout REAL NOT NULL DEFAULT 0, employee_id INTEGER REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS attestations (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, params TEXT, statut TEXT NOT NULL, requested_at TEXT NOT NULL, signed_at TEXT, signed_by TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), message TEXT NOT NULL, lien TEXT,
  lu INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_decisions (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, type_diagnostic TEXT NOT NULL, priorite TEXT NOT NULL,
  service_id INTEGER REFERENCES services(id), titre TEXT NOT NULL, diagnostic TEXT NOT NULL, impact TEXT NOT NULL,
  cause TEXT, recommandation TEXT NOT NULL, action_type TEXT NOT NULL, params TEXT NOT NULL, methode TEXT,
  statut TEXT NOT NULL DEFAULT 'en_attente', valide_par TEXT, note TEXT, resultat TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS affectations_temporaires (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), service_origine INTEGER NOT NULL,
  service_accueil INTEGER NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, decision_id INTEGER, statut TEXT NOT NULL DEFAULT 'en_cours'
);
CREATE INDEX IF NOT EXISTS ix_leaves_emp ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS ix_abs_emp ON absences(employee_id);
CREATE INDEX IF NOT EXISTS ix_enr_emp ON enrollments(employee_id);
`;

function open(file = DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}
function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, hashPassword, checkPassword, tx, DB_PATH };
