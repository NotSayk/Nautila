# Nautila

Un espace de notes **hors connexion, gratuit et open source**, pensé pour les étudiants.
Tes notes restent sur ton appareil : pas de compte, pas de télémétrie.

## Ce qui existe aujourd'hui

**Éditeur**
- Blocs : titres, listes, cases à cocher, citations, tableaux, images, fichiers, blocs repliables.
- Encadrés, sommaire automatique, colonnes, code avec coloration syntaxique.
- Formules LaTeX en bloc et dans le texte, croquis à main levée, PDF intégré, enregistrement audio.
- Commandes `/`, raccourcis Markdown, couleurs, glisser-déposer des blocs.

**Pages**
- Semestres, matières et pages imbriqués ; favoris, fil d'Ariane, sous-pages.
- Icône, couverture, police et largeur par page, verrouillage, compteur de mots.
- Renommer, dupliquer, déplacer et réordonner par glisser-déposer.
- Liens entre pages (`@`) et rétroliens, recherche plein texte (`Ctrl K`).
- Modèles fournis et modèles personnalisés, historique des versions, corbeille.

**Bases de données**
- Une page peut devenir une base dont chaque ligne est une page.
- Propriétés : texte, nombre, sélection simple ou multiple, date, case à cocher, lien.
- Vues tableau, kanban, calendrier, liste et galerie, avec filtres et tri.

**Études**
- Flashcards à répétition espacée (FSRS) créées depuis les notes.
- Devoirs et examens avec rappels, emploi du temps, notes et moyennes pondérées.
- Minuteur Pomodoro, tableau de bord du jour.

**Données**
- Tout est stocké sur l'appareil. Export Markdown, HTML et PDF par page.
- Import Markdown, sauvegarde et restauration complètes en JSON.
- Interface en français et en anglais, thème clair et sombre.

## Pas encore fait

- Synchronisation entre appareils via un serveur auto-hébergé (le contenu est déjà au format Yjs).
- Annotation des PDF (surlignage lié aux notes) ; le PDF est pour l'instant seulement affiché.
- Applications Android et iOS ; l'application de bureau Tauri est prête mais n'a pas encore été compilée.
- Bases de données : relations, formules, vue chronologie, bases intégrées dans une page.
- Blocs synchronisés, commentaires, étiquettes de pages, filtres de recherche.
- Import depuis Notion ou Word, citations BibTeX/Zotero.

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

## Héberger la version web

`dist/` est un site statique : n'importe quel serveur web suffit. Après une première visite,
l'application fonctionne hors connexion et les notes sont stockées dans le navigateur.
Exemple avec Caddy :

```
notes.example.org {
    root * /var/www/nautila
    try_files {path} /index.html
    file_server
}
```

HTTPS est obligatoire : sans lui, le navigateur refuse le stockage local persistant.

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
- `src-tauri/` : enveloppe de l'application de bureau.

## Licence

[AGPL-3.0-or-later](LICENSE).
