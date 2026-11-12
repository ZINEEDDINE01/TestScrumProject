'use strict';
// Utilitaires de dates (format ISO YYYY-MM-DD, calcul en UTC pour éviter les décalages).
const D = 86400000;
const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const today = () => process.env.SIGRH_TODAY || new Date().toISOString().slice(0, 10);
const addDays = (s, n) => iso(parse(s) + n * D);
const addMonths = (s, n) => { const t = new Date(parse(s)); t.setUTCMonth(t.getUTCMonth() + n); return iso(t.getTime()); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / D);
const diffMonths = (a, b) => { const x = new Date(parse(a)), y = new Date(parse(b)); let m = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); if (y.getUTCDate() < x.getUTCDate()) m--; return m; };
const yearsBetween = (a, b) => diffMonths(a, b) / 12;

// Jours fériés civils fixes au Maroc (les fêtes religieuses mobiles sont à paramétrer).
const FERIES = ['01-01', '01-11', '05-01', '07-30', '08-14', '08-20', '08-21', '11-06', '11-18'];
const isWorkday = (s) => { const t = parse(s); const wd = new Date(t).getUTCDay(); return wd !== 0 && wd !== 6 && !FERIES.includes(s.slice(5)); };
// Nombre de jours ouvrés dans [a, b] (bornes incluses)
function workdays(a, b) { if (b < a) return 0; let n = 0; for (let t = parse(a); t <= parse(b); t += D) if (isWorkday(iso(t))) n++; return n; }
// Jours ouvrés de l'intervalle [s,e] compris dans la fenêtre [ws,we]
const overlapWork = (s, e, ws, we) => workdays(s > ws ? s : ws, e < we ? e : we);

module.exports = { parse, iso, today, addDays, addMonths, diffDays, diffMonths, yearsBetween, isWorkday, workdays, overlapWork };
