'use strict';
// Documents administratifs : page HTML imprimable et PDF (pdfkit), tous deux avec QR code de vérification.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtDt = (s) => `${fmtDate(s)} à ${s.slice(11, 16)}`;
const mad = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, ' ') + ' MAD';

// Un paragraphe = liste de segments : texte simple ou { b: 'texte en gras' }
const B = (t) => ({ b: String(t) });

function content(a, e, ctx, p) {
  const nom = `${e.prenom} ${e.nom}`; const civ = e.sexe === 'F' ? ['Madame', 'née'] : ['Monsieur', 'né'];
  const id = [`${civ[0]} `, B(nom), `, ${civ[1]} le ${fmtDate(e.date_naissance)}, titulaire de la CIN n° ${e.cin || '—'}, matricule PPR n° `, B(e.ppr)];
  const decl = 'Le Chef de la Division des Ressources Humaines de la Wilaya de la Région Dakhla-Oued Ed-Dahab atteste que :';
  switch (a.type) {
    case 'travail': return { titre: 'Attestation de travail', paras: [[decl], [...id, ','], ['exerce ses fonctions en qualité de ', B(e.corps), ` (${e.grade}, échelle ${e.echelle}, échelon ${e.echelon}), affecté(e) à : `, B(e.service), ` — ${e.division}, depuis le ${fmtDate(e.date_prise_service || e.date_recrutement)}.`], ["La présente attestation est délivrée à l'intéressé(e) pour servir et valoir ce que de droit."]] };
    case 'salaire': return { titre: 'Attestation de salaire', paras: [[decl], [...id, `, ${e.corps} — échelle ${e.echelle}, échelon ${e.echelon},`], ['perçoit un traitement de base mensuel brut de ', B(mad(ctx.salaire)), ', versé par la Trésorerie Régionale.'], ["Cette attestation est délivrée à la demande de l'intéressé(e) pour servir et valoir ce que de droit, ", B("sans engagement de l'Administration à maintenir ce niveau de rémunération"), '.'], { note: 'Montant indicatif calculé par le SIGRH (barème de démonstration).' }] };
    case 'mission': return { titre: 'Ordre de mission', paras: [['Il est ordonné à :'], [...id, `, ${e.corps} au sein de ${e.service},`], ['de se rendre à ', B(p.destination), ' du ', B(fmtDate(p.date_debut)), ' au ', B(fmtDate(p.date_fin)), `, afin d'accomplir la mission suivante : ${p.objet}.`], ['Les frais de déplacement seront pris en charge conformément à la réglementation en vigueur.']] };
    case 'conge': return { titre: 'Titre de congé', paras: [['Un congé ', B({ annuel: 'annuel', exceptionnel: 'exceptionnel', pelerinage: 'de pèlerinage' }[p.type] || p.type), ' de ', B(p.jours), ' jour(s) ouvré(s) est accordé à :'], [...id, `, ${e.corps} au sein de ${e.service},`], ['du ', B(fmtDate(p.date_debut)), ' au ', B(fmtDate(p.date_fin)), ' inclus.']] };
    default: return { titre: a.type, paras: [] };
  }
}

const baseUrl = (ctx) => (process.env.PUBLIC_URL || ctx.host || '').replace(/\/+$/, '');
const verifyUrl = (a, ctx) => `${baseUrl(ctx)}/verify/${a.code}`;

const CSS = `body{font:15px/1.6 "Times New Roman",serif;color:#111;margin:0;background:#eee}
.page{max-width:780px;margin:24px auto;background:#fff;padding:48px 56px;border:1px solid #ccc}
.head{text-align:center;line-height:1.35}.head b{display:block;letter-spacing:.04em}
.titre{margin:36px 0 28px;text-align:center;font-size:22px;text-decoration:underline;font-weight:bold;text-transform:uppercase}
.sig{margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.cachet{border:2px solid #0b5d3b;color:#0b5d3b;padding:8px 14px;font:12px/1.4 Arial,sans-serif}
.qr{text-align:center;font:11px/1.3 Arial,sans-serif;color:#444}.qr svg{width:120px;height:120px;display:block;margin:0 auto 4px}
.foot{margin-top:28px;border-top:1px solid #999;padding-top:10px;font:11px/1.5 Arial,sans-serif;color:#444}.note{font-size:12px;color:#555}
.bar{max-width:780px;margin:12px auto;text-align:right;font:14px Arial}.bar a,.bar button{padding:6px 14px;margin-left:6px;border:1px solid #999;background:#fff;border-radius:4px;text-decoration:none;color:#111;cursor:pointer}
@media print{body{background:#fff}.page{border:0;margin:0}.bar{display:none}}`;

const segHtml = (segs) => segs.map((s) => (typeof s === 'string' ? esc(s) : `<b>${esc(s.b)}</b>`)).join('');

async function renderDocument(a, e, ctx) {
  const p = JSON.parse(a.params || '{}'); const c = content(a, e, ctx, p); const url = verifyUrl(a, ctx);
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(c.titre)} — ${esc(e.nom)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
<div class="bar"><a href="/doc/${a.id}.pdf">Télécharger le PDF</a><button id="pb">Imprimer</button></div>
<div class="page"><div class="head"><b>ROYAUME DU MAROC</b><b>Ministère de l'Intérieur</b>Wilaya de la Région Dakhla-Oued Ed-Dahab<br>Division des Ressources Humaines</div>
<div class="titre">${esc(c.titre)}</div>${c.paras.map((x) => (Array.isArray(x) ? `<p>${segHtml(x)}</p>` : `<p class="note">${esc(x.note)}</p>`)).join('')}
<p style="margin-top:28px">Fait à Dakhla, le ${fmtDate(a.signed_at)}.</p>
<div class="sig"><div class="cachet"><b>Signé électroniquement</b><br>${esc(a.signed_by)}<br>le ${fmtDt(a.signed_at)}<br>Réf. ${esc(a.code)}</div><div class="qr">${qr}Scanner pour vérifier<br>l'authenticité</div></div>
<div class="foot">Authenticité vérifiable sur <b>${esc(url)}</b> avec le code <b>${esc(a.code)}</b>.</div></div>
<script src="/print.js"></script></body></html>`;
}

// PDF A4 (polices standard PDF : latin-1 / WinAnsi suffisent pour le français)
async function renderPdf(a, e, ctx) {
  const p = JSON.parse(a.params || '{}'); const c = content(a, e, ctx, p); const url = verifyUrl(a, ctx);
  const qr = await QRCode.toBuffer(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 64, right: 64 }, info: { Title: `${c.titre} — ${e.prenom} ${e.nom}`, Author: 'Wilaya de la Région Dakhla-Oued Ed-Dahab — DRH', Subject: a.code } });
  const chunks = []; doc.on('data', (d) => chunks.push(d)); const done = new Promise((r) => doc.on('end', r));
  const W = doc.page.width - 128;
  doc.font('Helvetica-Bold').fontSize(11).text('ROYAUME DU MAROC', { align: 'center' }).text("Ministère de l'Intérieur", { align: 'center' });
  doc.font('Helvetica').text('Wilaya de la Région Dakhla-Oued Ed-Dahab', { align: 'center' }).text('Division des Ressources Humaines', { align: 'center' });
  doc.moveDown(2.2).font('Helvetica-Bold').fontSize(17).text(c.titre.toUpperCase(), { align: 'center', underline: true });
  doc.moveDown(1.6).fontSize(12);
  for (const para of c.paras) {
    if (!Array.isArray(para)) { doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555555').text(para.note, { width: W }).fillColor('#000000').fontSize(12).moveDown(0.6); continue; }
    para.forEach((s, i) => { const last = i === para.length - 1; doc.font(typeof s === 'string' ? 'Helvetica' : 'Helvetica-Bold').text(typeof s === 'string' ? s : s.b, { continued: !last, width: W, lineGap: 3, align: 'left' }); });
    doc.moveDown(0.8);
  }
  doc.font('Helvetica').moveDown(0.6).text(`Fait à Dakhla, le ${fmtDate(a.signed_at)}.`);
  const y = Math.max(doc.y + 24, 520); const boxH = 100;
  doc.roundedRect(64, y, 230, boxH, 4).lineWidth(1.5).strokeColor('#0b5d3b').stroke();
  doc.fillColor('#0b5d3b').font('Helvetica-Bold').fontSize(10).text('Signé électroniquement', 74, y + 10, { width: 210 }).font('Helvetica').text(String(a.signed_by), { width: 210 }).text(`le ${fmtDt(a.signed_at)}`).text(`Réf. ${a.code}`);
  doc.image(qr, doc.page.width - 64 - 100, y - 4, { width: 100 }); doc.fillColor('#444444').fontSize(8).text("Scanner pour vérifier l'authenticité", doc.page.width - 64 - 130, y + 98, { width: 130, align: 'center' });
  doc.fillColor('#444444').fontSize(8).text(`Authenticité vérifiable sur ${url} avec le code ${a.code}.`, 64, doc.page.height - 80, { width: W });
  doc.end(); await done; return Buffer.concat(chunks);
}

function renderVerify(a) {
  const ok = a && a.statut === 'signee';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vérification de document</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 Arial,sans-serif;background:#f4f6f5;margin:0}.c{max-width:520px;margin:60px auto;background:#fff;padding:28px;border-radius:10px;border:1px solid #d5dbd8}h1{font-size:20px;margin:0 0 12px}.ok{color:#0b5d3b}.ko{color:#b3261e}</style></head><body><div class="c">
<p style="margin:0 0 8px;color:#555">Wilaya de la Région Dakhla-Oued Ed-Dahab — DRH</p>
${ok ? `<h1 class="ok">✔ Document authentique</h1><p><b>${esc(a.label)}</b><br>Délivré à : ${esc(a.prenom)} ${esc(a.nom)}<br>Signé le ${fmtDt(a.signed_at)} par ${esc(a.signed_by)}<br>Référence : ${esc(a.code)}</p>` : `<h1 class="ko">✖ Document non reconnu</h1><p>Aucun document signé ne correspond à ce code.</p>`}
</div></body></html>`;
}

module.exports = { renderDocument, renderPdf, renderVerify };
