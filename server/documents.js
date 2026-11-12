'use strict';
// Documents administratifs imprimables (HTML -> impression / PDF navigateur).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtDt = (s) => `${fmtDate(s)} à ${s.slice(11, 16)}`;
const mad = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/ | /g, ' ') + ' MAD';

const CSS = `body{font:15px/1.6 "Times New Roman",serif;color:#111;margin:0;background:#eee}
.page{max-width:780px;margin:24px auto;background:#fff;padding:48px 56px;border:1px solid #ccc}
.head{text-align:center;line-height:1.35}.head b{display:block;letter-spacing:.04em}
.titre{margin:36px 0 28px;text-align:center;font-size:22px;text-decoration:underline;font-weight:bold;text-transform:uppercase}
.sig{margin-top:48px;text-align:right}.cachet{display:inline-block;border:2px solid #0b5d3b;color:#0b5d3b;padding:8px 14px;font:12px/1.4 Arial,sans-serif;text-align:left}
.foot{margin-top:40px;border-top:1px solid #999;padding-top:10px;font:11px/1.5 Arial,sans-serif;color:#444}
table{border-collapse:collapse;margin:12px 0}td{padding:3px 14px 3px 0;vertical-align:top}
.bar{max-width:780px;margin:12px auto;text-align:right;font:14px Arial}button{padding:6px 14px}
@media print{body{background:#fff}.page{border:0;margin:0}.bar{display:none}}`;

function body(a, e, ctx, p) {
  const nom = `${esc(e.prenom)} ${esc(e.nom)}`; const sexe = e.sexe === 'F' ? ['Madame', 'née', 'nommée', 'titulaire'] : ['Monsieur', 'né', 'nommé', 'titulaire'];
  const id = `${sexe[0]} <b>${nom}</b>, ${sexe[1]} le ${fmtDate(e.date_naissance)}, titulaire de la CIN n° ${esc(e.cin || '—')}, matricule PPR n° <b>${esc(e.ppr)}</b>`;
  switch (a.type) {
    case 'travail': return { titre: 'Attestation de travail', html: `<p>Le Chef de la Division des Ressources Humaines de la Wilaya de la Région Dakhla-Oued Ed-Dahab atteste que :</p><p>${id},</p><p>exerce ses fonctions en qualité de <b>${esc(e.corps)}</b> (${esc(e.grade)}, échelle ${esc(e.echelle)}, échelon ${e.echelon}), affecté(e) à : <b>${esc(e.service)}</b> — ${esc(e.division)}, depuis le ${fmtDate(e.date_prise_service || e.date_recrutement)}.</p><p>La présente attestation est délivrée à l'intéressé(e) pour servir et valoir ce que de droit.</p>` };
    case 'salaire': return { titre: 'Attestation de salaire', html: `<p>Le Chef de la Division des Ressources Humaines de la Wilaya de la Région Dakhla-Oued Ed-Dahab atteste que :</p><p>${id}, ${esc(e.corps)} — échelle ${esc(e.echelle)}, échelon ${e.echelon},</p><p>perçoit un traitement de base mensuel brut de <b>${mad(ctx.salaire)}</b>, versé par la Trésorerie Régionale.</p><p>Cette attestation est délivrée à la demande de l'intéressé(e) pour servir et valoir ce que de droit, <b>sans engagement de l'Administration à maintenir ce niveau de rémunération</b>.</p><p style="font-size:12px;color:#555">Montant indicatif calculé par le SIGRH (barème de démonstration).</p>` };
    case 'mission': return { titre: 'Ordre de mission', html: `<p>Il est ordonné à :</p><p>${id}, ${esc(e.corps)} au sein de ${esc(e.service)},</p><p>de se rendre à <b>${esc(p.destination)}</b> du <b>${fmtDate(p.date_debut)}</b> au <b>${fmtDate(p.date_fin)}</b>, afin d'accomplir la mission suivante : ${esc(p.objet)}.</p><p>Les frais de déplacement seront pris en charge conformément à la réglementation en vigueur.</p>` };
    case 'conge': return { titre: 'Titre de congé', html: `<p>Un congé <b>${esc({ annuel: 'annuel', exceptionnel: 'exceptionnel', pelerinage: 'de pèlerinage' }[p.type] || p.type)}</b> de <b>${p.jours}</b> jour(s) ouvré(s) est accordé à :</p><p>${id}, ${esc(e.corps)} au sein de ${esc(e.service)},</p><p>du <b>${fmtDate(p.date_debut)}</b> au <b>${fmtDate(p.date_fin)}</b> inclus.</p>` };
    default: return { titre: a.type, html: '' };
  }
}

function renderDocument(a, e, ctx) {
  const p = JSON.parse(a.params || '{}'); const b = body(a, e, ctx, p); const url = `${ctx.host}/verify/${a.code}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(b.titre)} — ${esc(e.nom)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
<div class="bar"><button id="pb">Imprimer / Enregistrer en PDF</button></div>
<div class="page"><div class="head"><b>ROYAUME DU MAROC</b><b>Ministère de l'Intérieur</b>Wilaya de la Région Dakhla-Oued Ed-Dahab<br>Division des Ressources Humaines</div>
<div class="titre">${esc(b.titre)}</div>${b.html}
<p style="margin-top:28px">Fait à Dakhla, le ${fmtDate(a.signed_at)}.</p>
<div class="sig"><div class="cachet"><b>Signé électroniquement</b><br>${esc(a.signed_by)}<br>le ${fmtDt(a.signed_at)}<br>Réf. ${esc(a.code)}</div></div>
<div class="foot">Authenticité vérifiable sur <b>${esc(url)}</b> avec le code <b>${esc(a.code)}</b>.</div></div>
<script src="/print.js"></script></body></html>`;
}

function renderVerify(a) {
  const ok = a && a.statut === 'signee';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vérification de document</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 Arial,sans-serif;background:#f4f6f5;margin:0}.c{max-width:520px;margin:60px auto;background:#fff;padding:28px;border-radius:10px;border:1px solid #d5dbd8}h1{font-size:20px;margin:0 0 12px}.ok{color:#0b5d3b}.ko{color:#b3261e}</style></head><body><div class="c">
<p style="margin:0 0 8px;color:#555">Wilaya de la Région Dakhla-Oued Ed-Dahab — DRH</p>
${ok ? `<h1 class="ok">✔ Document authentique</h1><p><b>${esc(a.label)}</b><br>Délivré à : ${esc(a.prenom)} ${esc(a.nom)}<br>Signé le ${fmtDt(a.signed_at)} par ${esc(a.signed_by)}<br>Référence : ${esc(a.code)}</p>` : `<h1 class="ko">✖ Document non reconnu</h1><p>Aucun document signé ne correspond à ce code.</p>`}
</div></body></html>`;
}

module.exports = { renderDocument, renderVerify };
