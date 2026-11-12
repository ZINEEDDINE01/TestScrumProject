'use strict';
const { open } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');

const db = open();
if (!db.prepare('SELECT COUNT(*) c FROM employees').get().c) { console.log('Base vide : chargement du jeu de données de démonstration…'); seed(db); }
const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => console.log(`SIGRH — http://localhost:${port}  (comptes démo : wali / drh / chef / agent — mot de passe : demo1234)`));
