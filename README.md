# Nautila

Un espace de notes **hors connexion, gratuit et open source**, pensé pour les étudiants.
Tes notes restent sur ton appareil : pas de compte, pas de télémétrie.

## Ce qui existe aujourd'hui

**Éditeur**
- Blocs : titres, listes, cases à cocher, citations, tableaux, images, fichiers, blocs repliables.
- Encadrés, sommaire automatique, colonnes, code avec coloration syntaxique.
- Formules LaTeX en bloc et dans le texte, croquis à main levée, enregistrement audio.
- PDF lisible dans la page, avec surlignage (un clic pour retirer, Ctrl+Z pour annuler) et citation des extraits dans la note.
- Commandes `/`, raccourcis Markdown, couleurs, glisser-déposer des blocs.
- Code coloré dans 81 langages.
- Blocs synchronisés, citations BibTeX et bibliographie, équations numérotées.

**Pages**
- Semestres, matières et pages imbriqués ; favoris, fil d'Ariane, sous-pages.
- Icône, couverture, police et largeur par page, verrouillage, compteur de mots.
- Renommer, dupliquer, déplacer et réordonner par glisser-déposer.
- Liens entre pages (`@`) et rétroliens, recherche plein texte (`Ctrl K`).
- Modèles fournis et modèles personnalisés, historique des versions, corbeille.
- Étiquettes (`#étiquette` dans la recherche), commentaires sur un bloc, sélection de plusieurs pages.

**Bases de données**
- Une page peut devenir une base dont chaque ligne est une page.
- Propriétés : texte, nombre, sélection simple ou multiple, date, case à cocher, lien, formule, relation.
- Formules sur nombres, textes et dates : `if`, `round`, `concat`, `days`, `today`, comparaisons.
- Vues tableau, kanban, calendrier, liste, galerie et chronologie, avec filtres, tri et regroupement.
- Une base peut être intégrée dans une page.
- Colonnes redimensionnables, réordonnables et masquables par vue ; calculs en pied de colonne ; tris
  multiples, filtres ET/OU, dates relatives ; groupes repliables ; import et export CSV.
- Types supplémentaires : date avec heure ou plage, URL, e-mail, téléphone, dates de création et de
  modification, format des nombres, cumul à travers une relation, fichier joint, relation bidirectionnelle.

**Études**
- Flashcards à répétition espacée (FSRS), rangées en paquets par page : créées dans les notes (`/flashcard`)
  ou directement dans Révisions, une par une ou en collant une liste (tableur, « question ; réponse »).
- Quiz à choix multiples créés et modifiés dans Révisions (ou par le connecteur MCP).
- Modes d'étude : cartes, QCM, écriture, association ; quiz à choix multiples.
- Devoirs et examens avec rappels, emploi du temps.
- Emploi du temps semaine par semaine, comme un agenda : import d'un fichier iCal (.ics) exporté d'ADE,
  HyperPlanning, Celcat ou d'un agenda, avec les vacances, les cours annulés, la salle, l'enseignant et le
  type de séance. Réimporter le fichier met le calendrier à jour ; les cours du jour sont sur l'accueil.
- Minuteur Pomodoro (avec choix de la matière), tableau de bord du jour.
- Cartes à trous : `{{c1::réponse}}` ou `{{c1::réponse::indice}}`, une révision par numéro de trou.
  Formules `$…$` et `$$…$$` rendues dans les cartes et les quiz. Import et export au format texte d'Anki.
- Statistiques : série de jours et record, carte des révisions sur 26 semaines, réussite globale et par
  paquet, prévision sur 14 jours, temps d'étude par matière ; objectif du jour réglable sur l'accueil.
- Examens : compte à rebours sur l'accueil, plan de révision (charge quotidienne jusqu'à l'examen) et
  séance « Réviser pour cet examen ». Examen blanc chronométré tiré des cartes et des quiz, corrigé à la
  fin, sans effet sur la répétition espacée sauf option.
- Devoirs récurrents (jour, semaine, deux semaines, mois) ; note du jour (`Ctrl Alt J`), rangée dans « Journal ».

**Données**
- Tout est stocké sur l'appareil. Export Markdown, HTML autonome (images et formules intégrées) et PDF par page.
- Import Markdown, Word (.docx), PDF (une page par document) et export Notion (.zip : pages, images, bases de données, relations
  entre bases, choix multiples et liens entre pages) ; sauvegarde et restauration complètes en JSON.
- Synchronisation entre appareils via un serveur auto-hébergé, avec comptes.
- Partage en direct : plusieurs comptes modifient la même page, avec curseurs nommés. Le propriétaire
  choisit qui peut modifier, qui ne fait que lire, et peut retirer un participant. Une page partagée se
  met à jour même fermée (au lancement, à la reconnexion), et ses images et fichiers sont visibles de tous.
- Onglets : plusieurs pages ouvertes côte à côte, rouvertes au lancement.
- Lien public en lecture seule, consultable sans compte.
- Connecteur MCP : Claude ou Codex lisent les notes et créent flashcards, quiz et fiches.
- Interface en français et en anglais, thème clair et sombre.

## Pas encore fait

- Applications Android et iOS.
- Application de bureau : les installateurs sont construits automatiquement, mais ils ne sont pas
  signés et n'ont pas été essayés à la main sous Windows et macOS.
- Les rappels d'échéances ne se déclenchent que lorsque Nautila est ouvert.
- Import Notion : l'export de Notion ne contient que le résultat des formules, pas leur expression ;
  elles arrivent donc comme des valeurs fixes.

## Télécharger l'application de bureau

Les installateurs Windows (`.exe`, `.msi`), macOS (`.dmg`, Intel et Apple Silicon) et Linux (`.AppImage`,
`.deb`, `.rpm`) sont sur la page [Releases](https://github.com/NotSayk/Nautila/releases). Ils ne sont pas
signés : Windows demande « Informations complémentaires → Exécuter quand même », et macOS un clic droit
sur l'application puis « Ouvrir » la première fois.

Pour publier une nouvelle version : `npm run version:set -- X.Y.Z`, commit, puis pousse l'étiquette `vX.Y.Z`.
Le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` doit exister, et le workflow échoue si l'étiquette ne
correspond pas aux versions des fichiers.

## Mises à jour

- **Navigateur** : la version web se met à jour toute seule. Le bouton « Télécharger l'application » de la
  barre latérale ouvre la page des versions.
- **Application de bureau** : Nautila cherche une mise à jour au lancement puis toutes les 6 heures et
  affiche une carte en bas de la barre latérale (« Mettre à jour » ou « Plus tard »). On peut aussi la
  chercher à la main : Paramètres, « Rechercher des mises à jour ». Les mises à jour sont vérifiées par une
  signature propre à Nautila, mais les installateurs restent non signés au sens de Windows et de macOS.
  Avec un `.deb` ou un `.rpm`, la mise à jour intégrée n'est pas disponible : télécharge la nouvelle
  version depuis la page des versions.

## Développement

```bash
npm install
npm run dev        # version web sur http://localhost:5173
npm test           # tests unitaires
npm run build      # version web de production dans dist/
```

Application de bureau (nécessite [Rust et les prérequis Tauri](https://tauri.app/start/prerequisites/)) :

```bash
npm run tauri dev
npm run tauri build
```

## Héberger Nautila (application web et synchronisation)

Un seul conteneur sert l'application web et l'API de synchronisation. Sur un serveur avec Docker et Caddy :

```bash
git clone https://github.com/NotSayk/Nautila && cd Nautila
# Choisis le code d'invitation dans deploy/docker-compose.yml, puis :
docker compose -f deploy/docker-compose.yml up -d --build
```

Ajoute ensuite à ton Caddyfile le contenu de `deploy/Caddyfile` avec ton domaine, et recharge Caddy.
HTTPS est obligatoire : sans lui, le navigateur refuse le stockage local persistant.

Chaque étudiant crée son compte depuis l'icône nuage de la barre latérale. Réglages du serveur :

| Variable | Rôle | Défaut |
|---|---|---|
| `REGISTRATION` | `open`, `invite` ou `closed` | `open`, ou `invite` si un code est défini |
| `INVITE_CODE` | Code demandé à l'inscription | aucun |
| `MAX_USER_MB` | Espace maximal par compte | 1024 |
| `DATA_FILE` | Base SQLite du serveur | `/data/nautila.db` |
| `TRUST_PROXY` | `1` si un relais (Caddy) est devant le serveur : l'adresse du visiteur est lue dans `X-Forwarded-For` | désactivé |
| `CORS_ORIGINS` | Origines autorisées à appeler l'API, séparées par des virgules | `*` |
| `TOKEN_TTL_DAYS` | Un jeton inutilisé expire après ce nombre de jours | 90 |
| `MAX_SHARES` / `MAX_SHARE_MB` | Pages partagées par compte, taille d'un document partagé | 200 / 64 |
| `LOGIN_MAX_PER_IP` / `LOGIN_MAX_PER_USER` | Échecs de connexion tolérés en 15 minutes | 30 / 10 |
| `PUBLIC_MAX_PER_MINUTE` / `MCP_MAX_PER_MINUTE` | Requêtes par minute sur les liens publics, appels MCP par compte | 600 / 240 |
| `TOMBSTONE_DAYS` | Oubli des anciennes suppressions (0 pour désactiver) | 365 |

Sécurité :

- Un code d'invitation vide ou laissé à la valeur d'exemple (`change-moi`) ferme les inscriptions ; les
  comptes existants continuent de fonctionner. Derrière Caddy, définis `TRUST_PROXY=1`, sinon les limites
  par adresse visent Caddy, donc tout le monde à la fois.
- Les mots de passe trop faibles sont refusés à l'inscription. Depuis l'icône nuage, chacun peut changer
  son mot de passe et déconnecter ses autres appareils.
- Les fichiers d'une page publique ou partagée ne s'affichent en ligne que s'il s'agit d'images, d'audio,
  de vidéo ou de PDF ; les autres sont proposés au téléchargement. Les documents partagés comptent dans
  l'espace du propriétaire.
- Le serveur demande Node 22.13 ou plus récent (l'image Docker fournie convient).

Fonctionnement : chaque appareil garde toutes ses données et travaille hors connexion ; les
modifications partent dès que le serveur est joignable. Le contenu des pages est fusionné (Yjs),
donc deux appareils peuvent modifier la même page. Pour le reste (titres, devoirs, notes…), la
modification la plus récente l'emporte, d'après l'horloge des appareils.
Le serveur stocke les notes en clair : il n'y a pas de chiffrement de bout en bout.
Pour sauvegarder le serveur, copie le volume `nautila-data`.

## Partage en direct et connecteur IA

Les deux passent par le serveur de synchronisation, donc demandent un compte.

- **Partager une page** : bouton « Partager » en haut de la page, puis envoie le lien. Toute personne
  connectée au même serveur qui possède le lien peut rejoindre la page. Dans la même boîte, le
  propriétaire règle ce que permet le lien (modifier ou lire seulement) et le droit de chaque participant.
- **Connecteur MCP** : icône nuage, « Créer un jeton d'accès ». L'application affiche les réglages à
  copier pour Claude Code, Codex et claude.ai. Le jeton donne accès à tout le compte ; il est distinct
  du jeton de synchronisation et se révoque depuis la même boîte.

Outils exposés : `search_notes`, `list_pages`, `read_page`, `create_flashcards`, `create_quiz`,
`create_page`, `list_tasks`, `list_files`, `get_file`.

## Raccourcis

`Ctrl K` rechercher ou changer de page · `Ctrl Alt N` nouvelle page · `Ctrl \` barre latérale ·
`Ctrl Maj L` thème · `Ctrl /` liste complète des raccourcis.

## Architecture

| Couche | Choix |
|---|---|
| Interface | React, TypeScript, Vite, Tailwind |
| Éditeur | BlockNote (ProseMirror), contenu stocké en Yjs |
| Données | SQLite : WASM + OPFS dans le navigateur, natif dans l'application de bureau |
| Recherche | SQLite FTS5 |
| Révisions | ts-fsrs |
| Bureau | Tauri 2 |

- `src/db/` : accès SQLite, avec une interface commune au navigateur et à Tauri.
- `src/data/` : pages, cartes, devoirs, sauvegarde.
- `src/editor/` : éditeur, blocs personnalisés, modèles.
- `src/views/` : écrans.
- `src/sync/` : synchronisation côté appareil.
- `server/` : serveur de synchronisation (Node, SQLite).
- `src-tauri/` : enveloppe de l'application de bureau.

## Licence

[AGPL-3.0-or-later](LICENSE).
