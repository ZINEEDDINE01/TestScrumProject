'use strict';
const { open } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');

(async () => {
  const db = await open();
  if (!(await db.prepare('SELECT COUNT(*) c FROM employees').get()).c) { console.log('Base vide : chargement du jeu de données de démonstration…'); await seed(db); }
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => console.log(`SIGRH — http://localhost:${port}  (comptes démo : wali / drh / chef / agent — mot de passe : demo1234)`));
})().catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
