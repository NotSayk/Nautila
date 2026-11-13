# Nautila

Un espace de notes **hors connexion, gratuit et open source**, pensé pour les étudiants.
Tes notes restent sur ton appareil : pas de compte, pas de télémétrie.

## Ce qui existe aujourd'hui

**Éditeur**
- Blocs : titres, listes, cases à cocher, citations, tableaux, images, fichiers, blocs repliables.
- Encadrés, sommaire automatique, colonnes, code avec coloration syntaxique.
- Formules LaTeX en bloc et dans le texte, croquis à main levée, enregistrement audio.
- PDF lisible dans la page, avec surlignage et citation des extraits dans la note.
- Commandes `/`, raccourcis Markdown, couleurs, glisser-déposer des blocs.
- Code coloré dans 81 langages.

**Pages**
- Semestres, matières et pages imbriqués ; favoris, fil d'Ariane, sous-pages.
- Icône, couverture, police et largeur par page, verrouillage, compteur de mots.
- Renommer, dupliquer, déplacer et réordonner par glisser-déposer.
- Liens entre pages (`@`) et rétroliens, recherche plein texte (`Ctrl K`).
- Modèles fournis et modèles personnalisés, historique des versions, corbeille.

**Bases de données**
- Une page peut devenir une base dont chaque ligne est une page.
- Propriétés : texte, nombre, sélection simple ou multiple, date, case à cocher, lien, formule, relation.
- Vues tableau, kanban, calendrier, liste, galerie et chronologie, avec filtres et tri.
- Une base peut être intégrée dans une page.

**Études**
- Flashcards à répétition espacée (FSRS) créées depuis les notes, rangées en paquets par page.
- Modes d'étude : cartes, QCM, écriture, association ; quiz à choix multiples.
- Devoirs et examens avec rappels, emploi du temps, notes et moyennes pondérées.
- Minuteur Pomodoro, tableau de bord du jour.

**Données**
- Tout est stocké sur l'appareil. Export Markdown, HTML et PDF par page.
- Import Markdown, Word (.docx) et export Notion (.zip) ; sauvegarde et restauration complètes en JSON.
- Synchronisation entre appareils via un serveur auto-hébergé, avec comptes.
- Partage en direct : plusieurs comptes modifient la même page, avec curseurs nommés.
- Connecteur MCP : Claude ou Codex lisent les notes et créent flashcards, quiz et fiches.
- Interface en français et en anglais, thème clair et sombre.

## Pas encore fait

- Applications Android et iOS ; l'application de bureau Tauri est prête mais n'a pas encore été compilée.
- Blocs synchronisés, commentaires, étiquettes de pages, onglets, équations numérotées.
- Bases de données : regroupements dans le tableau, formules sur du texte ou des dates.
- Import Notion : le texte et l'arborescence sont repris, pas les images ni les bases de données.
- Citations BibTeX/Zotero.
- Les rappels d'échéances ne se déclenchent que lorsque Nautila est ouvert.

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

Fonctionnement : chaque appareil garde toutes ses données et travaille hors connexion ; les
modifications partent dès que le serveur est joignable. Le contenu des pages est fusionné (Yjs),
donc deux appareils peuvent modifier la même page. Pour le reste (titres, devoirs, notes…), la
modification la plus récente l'emporte, d'après l'horloge des appareils.
Le serveur stocke les notes en clair : il n'y a pas de chiffrement de bout en bout.
Pour sauvegarder le serveur, copie le volume `nautila-data`.

## Partage en direct et connecteur IA

Les deux passent par le serveur de synchronisation, donc demandent un compte.

- **Partager une page** : bouton « Partager » en haut de la page, puis envoie le lien. Toute personne
  connectée au même serveur qui possède le lien peut lire et modifier la page.
- **Connecteur MCP** : icône nuage, « Créer un jeton d'accès ». L'application affiche les réglages à
  copier pour Claude Code, Codex et claude.ai. Le jeton donne accès à tout le compte.

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
