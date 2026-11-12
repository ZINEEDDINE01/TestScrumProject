# SIGRH — Système intégré de gestion des ressources humaines

Prototype fonctionnel du SIGRH et du tableau de bord exécutif de la **Wilaya de la Région Dakhla-Oued Ed-Dahab** (DRH), d'après le cahier des charges et les formules de KPI fournis.

**Aucune dépendance** : Node ≥ 22.5 (SQLite intégré `node:sqlite`), front en JavaScript natif.

```bash
npm start        # http://localhost:3000 — la base de démonstration est créée au premier lancement
npm run seed     # réinitialise les données fictives
npm test         # 13 tests d'intégration (API, droits, circuits, formules)
```

Comptes de démonstration (mot de passe `demo1234`) : `wali`, `drh`, `chef`, `agent`. Toutes les données sont fictives.

## Fonctionnalités
| Espace | Contenu |
|---|---|
| **Wali** (lecture seule) | Tableau de bord : effectifs, pyramide des âges, retraites à 5 ans, assiduité, turnover, rétention, recrutement, carrière, formation, e-services, tableau des formules |
| **DRH** (back-office) | Dossiers et création de fonctionnaires (PPR, compte portail, intégration), recrutements (candidature → offre → acceptation → intégration), congés (validation finale), absences et justifications, avancements (règles paramétrables, génération, validation, CAP), ingénierie de formation (formateurs, ciblage/convocation, émargement), signature des documents |
| **Chef de service** | Équipe, avis sur les congés, déclaration d'absences, alertes |
| **Fonctionnaire** | Dossier, solde de congés, demandes, justification d'absence, éligibilité à l'avancement, invitations de formation (confirmation, heures cumulées, évaluation), attestations de travail / salaire, ordre de mission, titre de congé |

## Indicateurs (`server/kpi.js`)
Les formules du cahier des charges (absentéisme, turnover, rétention, promotion interne, coût et délai de recrutement, taux d'acceptation, heures de formation, attrition, ratio RH, rétention à 1 an) sont implémentées et affichées dans l'application avec leurs précisions. Choix d'interprétation :
- **Absentéisme** : jours ouvrés d'absence dont la justification n'est *pas validée* ; le taux total est affiché en complément. Les congés ne sont pas des absences.
- Turnover / rétention : année en cours ; attrition : 12 mois glissants ; rétention à 1 an : cohorte des recrues des mois −24 à −12.
- Coût par embauche : coûts de toutes les procédures de l'année / postes pourvus.

## Limites connues
- Les **QR codes** des documents ne sont pas générés : chaque document porte un code de référence vérifiable sur `/verify/<code>`.
- La signature électronique est un cachet applicatif, pas une signature qualifiée.
- Le barème de traitement, les durées d'avancement (24/30/36 mois), quotas et âge de retraite (63 ans) sont indicatifs et paramétrables (`server/rules.js`, écran « Règles d'avancement »). Les fêtes religieuses mobiles ne sont pas dans le calendrier des jours fériés.
- Sessions en mémoire (perdues au redémarrage) ; HTTPS et reverse proxy à prévoir en production.
