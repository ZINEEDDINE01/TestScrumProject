// Graphiques SVG sobres (une teinte, 2 teintes max pour F/H), avec infobulles natives et alternative tabulaire.
import { h, raw, esc, num } from './core.js';

export const COL = { main: 'var(--c-main)', f: 'var(--c-f)', h: 'var(--c-h)', muted: 'var(--c-muted)' };

// Barres horizontales : rows = [{label, value}]
export function hbar(rows, { unit = '', max = null, color = COL.main, labelW = 190, valueFmt = (v) => num(v) } = {}) {
  if (!rows.length) return h`<p class="muted">Aucune donnée.</p>`;
  const W = 640, rh = 26, pad = 4, H = rows.length * rh + pad * 2, m = max ?? Math.max(...rows.map((r) => r.value), 1), bw = W - labelW - 60;
  return h`<svg viewBox="0 0 ${W} ${H}" role="img" class="chart">${rows.map((r, i) => { const y = pad + i * rh, w = Math.max(r.value > 0 ? 2 : 0, (r.value / m) * bw); return h`<g><title>${r.label} : ${valueFmt(r.value)}${unit}</title>
    <text x="0" y="${y + 17}" class="lbl">${r.label.length > 30 ? r.label.slice(0, 29) + '…' : r.label}</text>
    <rect x="${labelW}" y="${y + 4}" width="${w}" height="16" rx="3" fill="${color}"/>
    <text x="${labelW + w + 6}" y="${y + 17}" class="val">${valueFmt(r.value)}${unit}</text></g>`; })}</svg>`;
}

// Colonnes verticales : rows = [{label, value}] ; option series = [{key, color, name}] pour barres groupées
export function columns(rows, { series = [{ key: 'value', color: COL.main, name: '' }], unit = '', h: Hh = 190, valueFmt = (v) => num(v, v % 1 ? 1 : 0), showVals = true } = {}) {
  const W = 640, padL = 34, padB = 26, padT = 18, ph = Hh - padB - padT, pw = W - padL - 8;
  const m = Math.max(...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0)), 1); const ticks = [0, 0.5, 1].map((t) => t * m);
  const gw = pw / rows.length, bw = Math.min(34, (gw - 8) / series.length);
  return h`<svg viewBox="0 0 ${W} ${Hh}" role="img" class="chart">
  ${ticks.map((t) => h`<g><line x1="${padL}" x2="${W - 8}" y1="${padT + ph - (t / m) * ph}" y2="${padT + ph - (t / m) * ph}" class="grid"/><text x="${padL - 6}" y="${padT + ph - (t / m) * ph + 4}" class="axis" text-anchor="end">${valueFmt(t)}</text></g>`)}
  ${rows.map((r, i) => { const cx = padL + gw * i + gw / 2; return h`<g>${series.map((s, k) => { const v = r[s.key] ?? 0, bh = (v / m) * ph, x = cx - (bw * series.length) / 2 + k * bw; return h`<g><title>${r.label}${s.name ? ' — ' + s.name : ''} : ${valueFmt(v)}${unit}</title><rect x="${x + 1}" y="${padT + ph - bh}" width="${bw - 2}" height="${Math.max(bh, v ? 1 : 0)}" rx="3" fill="${s.color}"/>${showVals && v ? h`<text x="${x + bw / 2}" y="${padT + ph - bh - 4}" text-anchor="middle" class="val">${valueFmt(v)}</text>` : ''}</g>`; })}<text x="${cx}" y="${Hh - 8}" text-anchor="middle" class="axis">${r.label}</text></g>`; })}</svg>`;
}

// Pyramide des âges : rows = [{tranche, F, H}]
export function pyramid(rows) {
  const W = 640, rh = 30, H = rows.length * rh + 26, mid = W / 2, m = Math.max(...rows.flatMap((r) => [r.F, r.H]), 1), bw = mid - 70;
  return h`<svg viewBox="0 0 ${W} ${H}" role="img" class="chart">${rows.slice().reverse().map((r, i) => { const y = 6 + i * rh, wf = (r.F / m) * bw, wh = (r.H / m) * bw; return h`<g>
    <title>${r.tranche} ans — Femmes : ${r.F} · Hommes : ${r.H}</title>
    <rect x="${mid - 30 - wf}" y="${y}" width="${wf}" height="22" rx="3" fill="${COL.f}"/><text x="${mid - 34 - wf}" y="${y + 15}" text-anchor="end" class="val">${r.F}</text>
    <rect x="${mid + 30}" y="${y}" width="${wh}" height="22" rx="3" fill="${COL.h}"/><text x="${mid + 34 + wh}" y="${y + 15}" class="val">${r.H}</text>
    <text x="${mid}" y="${y + 15}" text-anchor="middle" class="axis">${r.tranche}</text></g>`; })}
    <text x="${mid - 30}" y="${H - 4}" text-anchor="end" class="axis">◄ Femmes</text><text x="${mid + 30}" y="${H - 4}" class="axis">Hommes ►</text></svg>`;
}

// Courbe : rows = [{label, value}]
export function line(rows, { unit = '', h: Hh = 170, valueFmt = (v) => num(v, 2) } = {}) {
  const W = 640, padL = 40, padB = 26, padT = 16, ph = Hh - padB - padT, pw = W - padL - 14; const vals = rows.map((r) => r.value ?? 0); const m = Math.max(...vals, 0.1) * 1.15;
  const x = (i) => padL + (rows.length === 1 ? pw / 2 : (pw * i) / (rows.length - 1)); const y = (v) => padT + ph - (v / m) * ph;
  return h`<svg viewBox="0 0 ${W} ${Hh}" role="img" class="chart">${[0, 0.5, 1].map((t) => h`<g><line x1="${padL}" x2="${W - 14}" y1="${y(t * m)}" y2="${y(t * m)}" class="grid"/><text x="${padL - 6}" y="${y(t * m) + 4}" class="axis" text-anchor="end">${valueFmt(t * m)}</text></g>`)}
  <polyline fill="none" stroke="${COL.main}" stroke-width="2.5" stroke-linejoin="round" points="${rows.map((r, i) => `${x(i)},${y(r.value ?? 0)}`).join(' ')}"/>
  ${rows.map((r, i) => h`<g><title>${r.label} : ${valueFmt(r.value ?? 0)}${unit}</title><circle cx="${x(i)}" cy="${y(r.value ?? 0)}" r="4.5" fill="${COL.main}" stroke="var(--surface)" stroke-width="2"/><text x="${x(i)}" y="${Hh - 8}" text-anchor="middle" class="axis">${r.label}</text></g>`)}</svg>`;
}

// Barre de progression (part d'un tout)
export const meter = (value, max = 100, label = '') => h`<div class="meter" role="meter" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${max}" aria-label="${label}"><span style="width:${Math.min(100, (value / max) * 100)}%"></span></div>`;

export const legend = (items) => h`<ul class="legend">${items.map(([c, l]) => h`<li><i style="background:${c}"></i>${l}</li>`)}</ul>`;

// Alternative tabulaire accessible
export function dataTable(head, rows) {
  return h`<details class="tview"><summary>Voir en tableau</summary><table class="t"><thead><tr>${head.map((x) => h`<th>${x}</th>`)}</tr></thead><tbody>${rows.map((r) => h`<tr>${r.map((c) => h`<td>${c}</td>`)}</tr>`)}</tbody></table></details>`;
}
export const card = (title, body, { note = '', cls = '' } = {}) => h`<section class="card ${cls}"><h3>${title}</h3>${note ? h`<p class="note">${note}</p>` : ''}${body}</section>`;
