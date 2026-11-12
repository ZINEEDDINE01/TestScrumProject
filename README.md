# SIGRH — Système intégré de gestion des ressources humaines

Prototype fonctionnel du SIGRH et du tableau de bord exécutif de la **Wilaya de la Région Dakhla-Oued Ed-Dahab** (DRH), d'après le cahier des charges et les formules de KPI fournis.

**Pile** : Node ≥ 20, **PostgreSQL ≥ 14** (pilote `pg`), front en JavaScript natif.

```bash
docker compose up -d db   # PostgreSQL seul (ou utiliser votre serveur existant)
npm install
npm start              # http://localhost:3000 — schéma et données de démonstration créés au premier lancement
npm run seed           # vide les tables et recharge les données fictives
npm test               # 21 tests d'intégration, dans un schéma PostgreSQL jetable
```

Si le port 5432 est déjà utilisé (PostgreSQL installé en local), lancer Docker sur un autre port : `SIGRH_DB_PORT=55432 docker compose up -d`, puis `DATABASE_URL=postgres://sigrh:sigrh@127.0.0.1:55432/sigrh` (PowerShell : `$env:SIGRH_DB_PORT=55432` et `$env:DATABASE_URL="…"`).

Connexion : variable `DATABASE_URL` (défaut `postgres://sigrh:sigrh@localhost:5432/sigrh`). Les tests créent puis suppriment un schéma `t_xxxx` dans cette base ; l'utilisateur doit pouvoir créer des schémas.

Comptes de démonstration (mot de passe `demo1234`) : `wali`, `drh`, `chef`, `agent`. Toutes les données sont fictives.

## Fonctionnalités
| Espace | Contenu |
|---|---|
| **Wali** (lecture seule) | Tableau de bord : effectifs, pyramide des âges, retraites à 5 ans, assiduité, turnover, rétention, recrutement, carrière, formation, e-services, tableau des formules |
| **DRH** (back-office) | Dossiers et création de fonctionnaires (PPR, compte portail, intégration), recrutements (candidature → offre → acceptation → intégration), congés (validation finale), absences et justifications, avancements (règles paramétrables, génération, validation, CAP), ingénierie de formation (formateurs, ciblage/convocation, émargement), signature des documents |
| **Chef de service** | Équipe, avis sur les congés, déclaration d'absences, alertes |
| **Fonctionnaire** | Dossier, solde de congés, demandes, justification d'absence, éligibilité à l'avancement, invitations de formation (confirmation, heures cumulées, évaluation), attestations de travail / salaire, ordre de mission, titre de congé |

## Circuits de validation
| Circuit | Étapes |
|---|---|
| Congé | agent → avis du chef (favorable / défavorable) → validation finale DRH (solde mis à jour) |
| Évaluation annuelle | chef saisit la note et l'appréciation → DRH valide ou renvoie avec motif → visible par l'agent. Pas d'auto-évaluation. Une note validée de l'année est **requise pour valider un avancement de grade** |
| Besoin de formation | agent exprime le besoin (éventuellement lié à une session) → avis du chef → la DRH retient (convocation automatique si session choisie) ou rejette avec motif |
| Absence | déclaration (chef/DRH) → justificatif de l'agent → validation/rejet DRH (impact direct sur le taux d'absentéisme) |

## Documents PDF
Les attestations, ordres de mission et titres de congé signés sont téléchargeables en **PDF** (`/doc/<id>.pdf`) et en aperçu imprimable (`/doc/<id>`). Chaque document porte un **QR code** pointant vers `/verify/<code>`, page publique qui confirme l'authenticité (sans salaire ni donnée sensible). Définir `PUBLIC_URL` (ex. `https://sigrh.wilaya-dakhla.ma`) pour que les QR codes pointent vers l'adresse publique ; à défaut, l'adresse de la requête est utilisée.

## Déploiement
`docker compose up -d --build` lance PostgreSQL et l'application (http://localhost:3000). Le `Dockerfile` construit l'image Node ; la CI GitHub (`.github/workflows/ci.yml`) exécute les tests sur un PostgreSQL de service puis construit l'image. Variables : `POSTGRES_PASSWORD`, `SIGRH_DB_PORT`, `SIGRH_APP_PORT`. **Changer le mot de passe par défaut et mettre un reverse proxy HTTPS devant l'application en production** ; le Dockerfile et le compose n'ont pas pu être exécutés dans l'environnement de développement (pas de démon Docker).

## Copilote décisionnel (`server/copilot.js`)
File de recommandations priorisée (haute / moyenne / optimisation) affichée en carrousel sur le tableau de bord du Wali et de la DRH, avec **Valider & exécuter**, **Ajuster** et **Ignorer**. Quatre règles : pic d'absentéisme d'une entité (renfort temporaire avec retour automatique), avancements de grade en attente (convocation de la CAP), couverture de formation des annexes et caïdats (convocations), départs à la retraite à remplacer (ouverture de postes). Chaque fiche indique sa méthode de calcul ; seuils dans `SEUILS`. Toute décision est journalisée (table `ai_decisions`) et jamais exécutée sans validation.

**Écart avec le cahier des charges technique** : le moteur est un système de règles explicites, pas un LLM ni un modèle d'apprentissage ; il n'a pas été développé sur la pile Angular / FastAPI / PostgreSQL (prototype Node, API REST équivalente, `/api/copilot/*`).

## Indicateurs (`server/kpi.js`)
Les formules du cahier des charges (absentéisme, turnover, rétention, promotion interne, coût et délai de recrutement, taux d'acceptation, heures de formation, attrition, ratio RH, rétention à 1 an) sont implémentées et affichées dans l'application avec leurs précisions. Choix d'interprétation :
- **Absentéisme** : jours ouvrés d'absence dont la justification n'est *pas validée* ; le taux total est affiché en complément. Les congés ne sont pas des absences.
- Turnover / rétention : année en cours ; attrition : 12 mois glissants ; rétention à 1 an : cohorte des recrues des mois −24 à −12.
- Coût par embauche : coûts de toutes les procédures de l'année / postes pourvus.

## Base de données
Le schéma est dans `server/db.js` (création idempotente au démarrage, pas encore de migrations versionnées). Les dates sont stockées en `TEXT` ISO (`AAAA-MM-JJ`) pour rester comparables lexicalement ; à passer en `DATE`/`TIMESTAMPTZ` si la base est exploitée par d'autres outils. Les transactions utilisent un client dédié (`tx`).

## Non réalisé par rapport au cahier des charges d'architecture
- **Keycloak / OIDC (SSO, JWT)** : l'authentification reste locale (mots de passe hachés scrypt, session par cookie). L'intégrer demande un serveur Keycloak et le mappage des rôles (`ROLE_WALI`, `ROLE_DRH`…) vers `wali/drh/chef/fonctionnaire` : à faire séparément.
- **Téléversement de justificatifs** : la justification d'absence est un texte (référence du certificat), pas un fichier.
- Pile Angular / FastAPI : non utilisée (voir plus haut).

## Limites connues
- Les **QR codes** des documents ne sont pas générés : chaque document porte un code de référence vérifiable sur `/verify/<code>`.
- La signature électronique est un cachet applicatif, pas une signature qualifiée.
- Le barème de traitement, les durées d'avancement (24/30/36 mois), quotas et âge de retraite (63 ans) sont indicatifs et paramétrables (`server/rules.js`, écran « Règles d'avancement »). Les fêtes religieuses mobiles ne sont pas dans le calendrier des jours fériés.
- Sessions en mémoire (perdues au redémarrage) ; HTTPS et reverse proxy à prévoir en production.
