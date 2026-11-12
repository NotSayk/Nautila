# Nautila

Un espace de notes **hors connexion, gratuit et open source**, pensé pour les étudiants.
Tes notes restent sur ton appareil : pas de compte, pas de télémétrie.

## Ce qui existe aujourd'hui

- **Éditeur par blocs** : titres, listes, cases à cocher, citations, code, tableaux, images,
  commandes `/`, glisser-déposer des blocs.
- **Semestres, matières et pages** imbriqués dans la barre latérale.
- **Formules LaTeX** en bloc et dans le texte (`/formule`).
- **Flashcards à répétition espacée** (algorithme FSRS) : un bloc `/flashcard` dans une note
  devient une carte à réviser.
- **Devoirs et examens** avec échéances, et un tableau de bord d'accueil.
- **Liens entre pages** (`@`) et rétroliens.
- **Recherche plein texte** (`Ctrl K`), insensible aux accents.
- **Modèles** : notes de cours, méthode Cornell, fiche de révision, compte-rendu de TP.
- Corbeille, thème clair/sombre, interface en français et en anglais.
- **Données ouvertes** : export Markdown par page, sauvegarde et restauration complètes en JSON.

## Feuille de route

1. **Bases de données** : vues tableau, kanban et calendrier, avec filtres et tris.
2. **PDF** : annotation des supports de cours, extraits liés aux notes.
3. **Emploi du temps** hebdomadaire et calcul de moyennes par matière.
4. **Synchronisation** entre appareils via un serveur auto-hébergé (le contenu est déjà
   stocké au format CRDT Yjs, ce qui la rend possible sans réécriture).
5. Dessin et schémas, minuteur Pomodoro, citations BibTeX/Zotero, enregistrement audio.
6. Réorganisation des pages par glisser-déposer, historique des versions, import Notion/Markdown.
7. Applications Android et iOS.

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
