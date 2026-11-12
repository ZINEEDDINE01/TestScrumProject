import { h, raw, api, num, pctf, state, actions, MOIS } from './core.js';
import { mountCopilot } from './copilot.js';
import { hbar, columns, pyramid, line, meter, legend, dataTable, card, COL } from './charts.js';

const tile = (label, value, { sub = '', freq = '', formula = '', big = false } = {}) => h`<div class="tile ${big ? 'big' : ''}" ${raw(formula ? `title="${formula.replace(/"/g, '&quot;')}"` : '')}><div class="t-label">${label}</div><div class="t-value">${value}</div>${sub ? h`<div class="t-sub">${sub}</div>` : ''}${freq ? h`<div class="t-freq">${freq}</div>` : ''}</div>`;
const F = {}; // formules indexées
const fm = (id) => (F[id] ? `${F[id].formule}` : '');

export async function dashboard(root) {
  const d = await api('/dashboard'); d.formules.forEach((f) => (F[f.id] = f));
  const e = d.effectifs, a = d.assiduite, rh = d.rh, rc = d.recrutement, ca = d.carriere, fo = d.formation, es = d.eservices;
  const sections = [['effectifs', 'Effectifs'], ['assiduite', 'Assiduité & congés'], ['mouvements', 'Mouvements & rétention'], ['recrutement', 'Recrutement'], ['carriere', 'Carrière'], ['formation', 'Formation'], ['eservices', 'E-services'], ['formules', 'Formules']];
  const lowCov = a.couverture.slice(0, 8);
  const alerts = state.user.role === 'drh' ? await api('/alerts') : [];
  root.innerHTML = String(h`
  <div class="page-h"><div><h1>${state.user.role === 'wali' ? 'Tableau de bord de Monsieur le Wali' : 'Tableau de bord exécutif'}</h1><p class="muted">Situation au ${d.as_of.split('-').reverse().join('/')} · ${num(e.total)} fonctionnaires · Wilaya de la Région Dakhla-Oued Ed-Dahab</p></div>
  <button class="ghost" data-act="print">Imprimer la synthèse</button></div>
  <nav class="chips" aria-label="Sections">${sections.map(([id, l]) => h`<a href="#/dashboard" data-act="jump" data-to="${id}">${l}</a>`)}</nav>

  <div class="tiles hero">
    ${tile('Effectifs totaux', h`${num(e.total)} <small>fonctionnaires</small>`, { big: true, sub: `${num(rh.embauches)} entrées · ${num(rh.departs)} sorties en ${d.annee}`, freq: 'Temps réel' })}
    ${tile('Taux de présence', pctf(d.entete.presence_mois), { big: true, sub: `Ce mois · aujourd'hui ${pctf(d.entete.taux_presence_aujourdhui)} (${num(a.absents_aujourdhui)} absents)`, freq: 'Quotidienne' })}
    ${tile('Sessions de formation en cours', h`${num(d.entete.sessions_en_cours)} <small>sessions</small>`, { big: true, sub: `${num(d.entete.inscrits_en_cours)} inscrits`, freq: 'Par session' })}
  </div>
  <div id="copilot"></div>
  ${alerts.length ? h`<section class="card alerts"><h3>Alertes</h3><ul>${alerts.slice(0, 6).map((x) => h`<li class="al ${x.niveau}"><span aria-hidden="true">${x.niveau === 'critique' ? '✖' : x.niveau === 'alerte' ? '▲' : 'ℹ'}</span> ${x.message} ${x.lien ? h`<a href="${x.lien}">Traiter</a>` : ''}</li>`)}</ul></section>` : ''}

  <h2 id="effectifs" class="sec">1. Effectifs & structure</h2>
  <div class="tiles">
    ${tile('Taux de féminisation', pctf(e.feminisation), { sub: `${num(e.femmes)} femmes · ${num(e.hommes)} hommes`, freq: 'Trimestrielle' })}
    ${tile("Part de l'encadrement supérieur", pctf(e.cadres_sup_pct), { sub: `${num(e.cadres_sup)} cadres · dont ${pctf(e.cadres_femmes_pct, 0)} de femmes`, freq: 'Trimestrielle' })}
    ${tile("Ratio d'encadrement", pctf(e.encadrement_pct), { sub: `${num(e.cadres_ing)} administrateurs et ingénieurs`, freq: 'Trimestrielle', formula: fm('encad') })}
    ${tile('Âge moyen', h`${num(e.age_moyen, 1)} <small>ans</small>`, { sub: `Ancienneté moyenne ${num(e.anciennete_moyenne, 1)} ans`, freq: 'Mensuelle' })}
    ${tile('Départs à la retraite (5 ans)', num(e.retraites[4].cumul), { sub: `dont ${num(e.retraites[0].value)} dans les 12 mois · âge légal ${state.refs.age_retraite} ans`, freq: 'Mensuelle' })}
  </div>
  <div class="grid2">
    ${card('Répartition par division', hbar(e.byDivision, { labelW: 250 }), { note: 'Fonctionnaires actifs' })}
    <div class="stack">
      ${card('Répartition territoriale', hbar(e.byLocalisation, { labelW: 190 }))}
      ${card('Par type d’entité', hbar(e.byEntite, { labelW: 220 }), { note: 'Services, annexes, pachaliks et caïdats' })}
    </div>
  </div>
  <div class="grid2">
    ${card('Pyramide des âges', h`${pyramid(e.pyramide)}${legend([[COL.f, 'Femmes'], [COL.h, 'Hommes']])}`)}
    ${card('Départs à la retraite anticipés', h`${columns(e.retraites.map((r) => ({ label: `+${r.horizon} an${r.horizon > 1 ? 's' : ''}`, value: r.value })), { h: 190 })}`, { note: `Fonctionnaires atteignant ${state.refs.age_retraite} ans, par année d’horizon (cumul : ${e.retraites.map((r) => r.cumul).join(' → ')})` })}
  </div>
  <div class="grid2">
    ${card('Ancienneté', columns(e.anciennete))}
    ${card('Répartition par corps', hbar(e.byCorps, { labelW: 170 }))}
  </div>

  <h2 id="assiduite" class="sec">2. Assiduité & congés</h2>
  <div class="tiles">
    ${tile("Taux d'absentéisme (mois)", pctf(a.mois.absenteisme, 2), { sub: `Total, justifiées incluses : ${pctf(a.mois.absences_totales, 2)}`, freq: 'Hebdomadaire', formula: fm('absenteisme') })}
    ${tile("Taux d'absentéisme (année)", pctf(a.annee.absenteisme, 2), { sub: `${num(a.annee.abs_non_justifiees)} jours non justifiés sur ${num(a.annee.jours_ouvres)} jours ouvrés`, freq: 'Hebdomadaire', formula: fm('absenteisme') })}
    ${tile('Solde moyen des congés', h`${num(a.solde_moyen, 1)} <small>jours</small>`, { sub: 'Jours de congé annuel non consommés', freq: 'Mensuelle' })}
    ${tile('Couverture des services', pctf(d.entete.taux_presence_aujourdhui, 1), { sub: `Présents aujourd'hui : ${num(d.entete.presents_aujourdhui)} / ${num(e.total)}`, freq: 'Quotidienne' })}
  </div>
  <div class="grid2">
    ${card("Évolution mensuelle de l'absentéisme", h`${line(a.trend.map((t) => ({ label: MOIS[t.mois - 1], value: t.absenteisme })), { unit: ' %' })}`, { note: 'Journées d’absence non justifiées / jours ouvrés (%)' })}
    ${card("Absentéisme par entité (30 derniers jours)", h`${hbar(a.par_entite.map((x) => ({ label: x.service, value: x.taux })), { unit: ' %', labelW: 210, valueFmt: (v) => num(v, 1) })}${dataTable(['Entité', 'Effectif', 'Jours d\'absence', 'Taux'], a.par_entite.map((x) => [x.service, x.effectif, x.jours, x.taux + ' %']))}`, { note: 'Jours d\'absence / (effectif × jours ouvrés) — 10 entités les plus touchées' })}
    ${card('Couverture des services — les plus tendus aujourd’hui', h`${hbar(lowCov.map((s) => ({ label: s.service, value: s.taux })), { unit: ' %', max: 100, labelW: 210 })}${dataTable(['Service', 'Effectif', 'Présents', 'Taux'], a.couverture.map((s) => [s.service, s.effectif, s.presents, s.taux + ' %']))}`)}
  </div>

  <h2 id="mouvements" class="sec">3. Mouvements & rétention du personnel</h2>
  <div class="tiles">
    ${tile('Turnover', pctf(rh.turnover), { sub: `${num(rh.departs)} départs · effectif moyen ${num((rh.effectif_debut + rh.effectif_fin) / 2)}`, freq: 'Trimestrielle', formula: fm('turnover') })}
    ${tile('Rétention des employés', pctf(rh.retention), { sub: `Effectif ${num(rh.effectif_debut)} → ${num(rh.effectif_fin)} dont ${num(rh.embauches)} nouveaux`, freq: 'Trimestrielle', formula: fm('retention') })}
    ${tile("Taux d'attrition sur 1 an", pctf(rh.attrition_12m), { sub: `${num(rh.departs_12m)} départs sur 12 mois glissants`, freq: 'Mensuelle', formula: fm('attrition12') })}
    ${tile('Rétention sur 1 an', pctf(rh.retention_1an), { sub: `Cohorte de ${num(rh.cohorte)} recrues`, freq: 'Annuelle', formula: fm('retention12') })}
    ${tile('Ratio RH / employé', pctf(rh.ratio_rh * 100, 1), { sub: `${num(rh.personnel_rh)} agents RH · 1 pour ${num(Math.round(1 / rh.ratio_rh))} fonctionnaires`, freq: 'Annuelle', formula: fm('ratiorh') })}
  </div>
  <div class="grid2">
    ${card(`Entrées et sorties ${d.annee}`, h`${columns(rh.mouvements.map((m) => ({ label: MOIS[m.mois - 1], entrees: m.entrees, sorties: m.sorties })), { series: [{ key: 'entrees', color: COL.main, name: 'Entrées' }, { key: 'sorties', color: COL.h, name: 'Sorties' }] })}${legend([[COL.main, 'Entrées (recrutements)'], [COL.h, 'Sorties']])}`)}
    ${card('Motifs de départ', hbar(rh.motifs), { note: `Départs ${d.annee}` })}
  </div>

  <h2 id="recrutement" class="sec">4. Recrutement</h2>
  <div class="tiles">
    ${tile('Postes pourvus', num(rc.postes_pourvus), { sub: `${num(rc.pourvus_externes)} externes · ${num(rc.pourvus_internes)} internes`, freq: 'Mensuelle' })}
    ${tile('Taux de promotion interne', pctf(rc.taux_promotion_interne), { sub: 'Part des postes pourvus en interne', freq: 'Annuelle', formula: fm('promo') })}
    ${tile('Coût par embauche', h`${num(rc.cout_par_embauche)} <small>MAD</small>`, { sub: `Coût total ${num(rc.cout_total)} MAD`, freq: 'Annuelle', formula: fm('cout') })}
    ${tile('Délai de recrutement', h`${num(rc.delai_moyen_jours, 1)} <small>jours</small>`, { sub: 'Candidature → acceptation de l’offre', freq: 'Mensuelle', formula: fm('delai') })}
    ${tile("Taux d'acceptation des offres", pctf(rc.taux_acceptation), { sub: `${num(rc.offres_acceptees)} acceptées / ${num(rc.offres_emises)} émises`, freq: 'Trimestrielle', formula: fm('acceptation') })}
  </div>

  <h2 id="carriere" class="sec">5. Carrière & promotion</h2>
  <div class="tiles">
    ${tile('Avancements éligibles vs validés', h`${num(ca.valides)} <small>/ ${num(ca.eligibles)}</small>`, { sub: `Taux de réalisation ${pctf(ca.taux_realisation)}`, freq: 'Annuelle', formula: fm('avanc') })}
    ${tile('Délai moyen de traitement', h`${num(ca.delai_moyen_jours)} <small>jours</small>`, { sub: 'Instruction d’un dossier d’avancement', freq: 'Mensuelle' })}
    ${tile('Dossiers en attente de décision', num(ca.en_attente), { sub: `${num(ca.rejetes)} rejetés cette année`, freq: 'Temps réel' })}
  </div>
  <div class="grid2">
    ${card('Réalisation des avancements', h`<div class="meter-row"><span>Échelon</span>${meter(ca.echelon.valides, ca.echelon.eligibles, 'Échelon')}<b>${ca.echelon.valides} / ${ca.echelon.eligibles}</b></div><div class="meter-row"><span>Grade</span>${meter(ca.grade.valides, ca.grade.eligibles, 'Grade')}<b>${ca.grade.valides} / ${ca.grade.eligibles}</b></div>`)}
  </div>

  <h2 id="formation" class="sec">6. Formation continue</h2>
  <div class="tiles">
    ${tile('Taux de participation', pctf(fo.participation), { sub: `${num(fo.beneficiaires)} fonctionnaires formés en ${d.annee}`, freq: 'Trimestrielle', formula: fm('form') })}
    ${tile('Satisfaction & impact', h`${num(fo.satisfaction, 2)} <small>/ 5</small>`, { sub: `${num(fo.evaluations)} évaluations`, freq: 'Par session' })}
    ${tile('Heures de formation par fonctionnaire', h`${num(fo.heures_par_employe, 1)} <small>h</small>`, { sub: `${num(fo.heures_total)} h suivies au total`, freq: 'Trimestrielle', formula: fm('heures') })}
    ${tile('Sessions', h`${fo.sessions_terminees} <small>terminées</small>`, { sub: `${fo.sessions_en_cours} en cours · ${fo.sessions_planifiees} planifiées`, freq: 'Par session' })}
  </div>
  <div class="grid2">${card('Heures suivies par domaine', hbar(fo.heures_par_domaine, { unit: ' h', labelW: 200 }))}</div>

  <h2 id="eservices" class="sec">7. E-services</h2>
  <div class="tiles">
    ${tile('Documents délivrés (mois)', num(es.volume_mois), { sub: `${num(es.volume_annee)} depuis janvier · ${es.part_automatique} % en libre-service automatique`, freq: 'Mensuelle' })}
    ${tile('Délai de délivrance', h`${num(es.delai_moyen_heures, 1)} <small>h</small>`, { sub: `${num(es.en_attente)} document(s) en attente de signature`, freq: 'Hebdomadaire' })}
  </div>
  <div class="grid2">${card('Documents délivrés ce mois, par type', hbar(es.par_type, { labelW: 190 }))}</div>

  <h2 id="formules" class="sec">Formules des indicateurs</h2>
  <section class="card"><table class="t"><thead><tr><th>Indicateur</th><th>Formule</th><th>Précisions</th></tr></thead><tbody>${d.formules.map((f) => h`<tr><td><b>${f.nom}</b></td><td><code>${f.formule}</code></td><td>${f.note}</td></tr>`)}</tbody></table></section>`);
  mountCopilot(root.querySelector('#copilot'));
}
actions.jump = (el) => { document.getElementById(el.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
actions.print = () => window.print();
