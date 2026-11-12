'use strict';
const { open, DATABASE_URL } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');

(async () => {
  const db = await open();
  if (!(await db.prepare('SELECT COUNT(*) c FROM employees').get()).c) { console.log('Base vide : chargement du jeu de données de démonstration…'); await seed(db); }
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => console.log(`SIGRH — http://localhost:${port}  (comptes démo : wali / drh / chef / agent — mot de passe : demo1234)`));
})().catch((e) => { let cible = 'base inconnue'; try { const u = new URL(DATABASE_URL); cible = `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`; } catch { /* ignore */ }
  console.error(`Démarrage impossible (connexion PostgreSQL ${cible}) : ${e.message}`);
  console.error("Vérifiez DATABASE_URL, que le serveur écoute bien sur ce port, et qu'un autre PostgreSQL n'occupe pas le port 5432.");
  process.exit(1); });
