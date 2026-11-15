use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Instruction SQL avec ses paramètres (chaîne, nombre ou null), telle que l'envoie `src/db/tauri.ts`.
#[derive(serde::Deserialize)]
struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
}

/// Mots du SQL hors commentaires, chaînes et identifiants entre guillemets, en majuscules.
fn sql_words(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '-' && next == Some('-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            i += 2;
            while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i += 1;
        } else if c == '\'' || c == '"' || c == '`' || c == '[' {
            // Chaîne ou identifiant cité : son contenu n'est pas du SQL (un guillemet doublé l'échappe).
            let close = if c == '[' { ']' } else { c };
            i += 1;
            while i < chars.len() {
                if chars[i] == close {
                    if close != ']' && chars.get(i + 1) == Some(&close) {
                        i += 1;
                    } else {
                        break;
                    }
                }
                i += 1;
            }
        } else if c.is_alphanumeric() || c == '_' {
            word.push(c.to_ascii_uppercase());
            i += 1;
            continue;
        }
        if !word.is_empty() {
            words.push(std::mem::take(&mut word));
        }
        i += 1;
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// Refuse ce dont l'application n'a pas besoin et qu'un script injecté dans la fenêtre pourrait
/// détourner : ouvrir ou écrire un autre fichier (ATTACH, VACUUM INTO), charger une extension, ou
/// changer un réglage de SQLite (seuls `user_version` et `table_info` servent, cf. src/db/schema.ts).
fn check_sql(sql: &str) -> Result<(), String> {
    let words = sql_words(sql);
    for (i, word) in words.iter().enumerate() {
        let refused = match word.as_str() {
            "ATTACH" | "DETACH" | "VACUUM" | "LOAD_EXTENSION" => true,
            "PRAGMA" => !matches!(
                words.get(i + 1).map(String::as_str),
                Some("USER_VERSION") | Some("TABLE_INFO")
            ),
            _ => false,
        };
        if refused {
            return Err(format!("instruction SQL refusée : {word}"));
        }
    }
    Ok(())
}

fn bind_params<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    params: &'q [serde_json::Value],
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    for value in params {
        query = match value {
            serde_json::Value::Null => query.bind(None::<String>),
            serde_json::Value::String(text) => query.bind(text.as_str()),
            serde_json::Value::Number(number) => match number.as_i64() {
                Some(int) => query.bind(int),
                None => query.bind(number.as_f64().unwrap_or_default()),
            },
            serde_json::Value::Bool(flag) => query.bind(*flag),
            other => query.bind(other.to_string()),
        };
    }
    query
}

/// Applique les instructions dans une transaction : tout est validé ensemble, ou rien (retour arrière
/// à la première erreur, car `tx` est alors abandonné sans `commit`).
async fn run_transaction(pool: &sqlx::Pool<sqlx::Sqlite>, statements: &[Statement]) -> Result<(), String> {
    for statement in statements {
        check_sql(&statement.sql)?;
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for statement in statements {
        bind_params(sqlx::query(&statement.sql), &statement.params)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Lignes d'une requête, en objets JSON (colonne → valeur), comme les rendait le greffon SQL.
async fn run_select(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    sql: &str,
    params: &[serde_json::Value],
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    use sqlx::{Column, Row, TypeInfo, ValueRef};
    check_sql(sql)?;
    let rows = bind_params(sqlx::query(sql), params)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut object = serde_json::Map::new();
        for (i, column) in row.columns().iter().enumerate() {
            let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
            let value = if raw.is_null() {
                serde_json::Value::Null
            } else {
                match raw.type_info().name() {
                    "INTEGER" | "BOOLEAN" => row.try_get::<i64, _>(i).map(serde_json::Value::from),
                    "REAL" => row.try_get::<f64, _>(i).map(serde_json::Value::from),
                    "BLOB" => row.try_get::<Vec<u8>, _>(i).map(serde_json::Value::from),
                    _ => row.try_get::<String, _>(i).map(serde_json::Value::from),
                }
                .map_err(|e| e.to_string())?
            };
            object.insert(column.name().to_string(), value);
        }
        out.push(object);
    }
    Ok(out)
}

/// Pool SQLite ouvert par le greffon SQL (`Database.load` dans src/db/tauri.ts).
macro_rules! nautila_pool {
    ($instances:expr, $pools:ident, $pool:ident) => {
        let $pools = $instances.0.read().await;
        let Some(DbPool::Sqlite($pool)) = $pools.get("sqlite:nautila.db") else {
            return Err("base de données non chargée".into());
        };
    };
}

/// Transaction sur UNE connexion du pool du greffon SQL. Les appels séparés du greffon (`BEGIN`,
/// requêtes, `COMMIT`) peuvent passer par des connexions différentes du pool, d'où cette commande
/// (appelée par `batch` dans src/db/tauri.ts).
#[tauri::command]
async fn db_transaction(
    instances: tauri::State<'_, DbInstances>,
    statements: Vec<Statement>,
) -> Result<(), String> {
    nautila_pool!(instances, pools, pool);
    run_transaction(pool, &statements).await
}

/// Écriture isolée (`run` dans src/db/tauri.ts). Remplace `sql:allow-execute`, qui laissait passer
/// n'importe quel SQL : l'instruction est d'abord vérifiée par `check_sql`.
#[tauri::command]
async fn db_execute(
    instances: tauri::State<'_, DbInstances>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<(), String> {
    nautila_pool!(instances, pools, pool);
    run_transaction(pool, &[Statement { sql, params }]).await
}

/// Lecture (`all` dans src/db/tauri.ts), vérifiée de même : remplace `sql:allow-select`.
#[tauri::command]
async fn db_select(
    instances: tauri::State<'_, DbInstances>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    nautila_pool!(instances, pools, pool);
    run_select(pool, &sql, &params).await
}

/// Extensions qu'un export de l'application peut avoir (voir les appels à `download(` dans src/).
const DOWNLOAD_EXTENSIONS: &[&str] = &["html", "md", "json", "csv", "tsv", "txt", "pdf", "ics"];

fn download_name(name: &str) -> Result<String, String> {
    let safe: String = name
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let safe = safe.trim().trim_end_matches('.').to_string();
    let allowed = safe
        .rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && DOWNLOAD_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()));
    if allowed {
        Ok(safe)
    } else {
        Err(format!("type de fichier refusé : {name}"))
    }
}

/// Enregistre un fichier exporté dans le dossier Téléchargements, sans écraser un fichier existant.
/// Renvoie le chemin écrit. (Dans la fenêtre de bureau, un lien de téléchargement ne fait rien.)
/// Seules les extensions des exports sont acceptées : pas de .exe, .bat, .lnk… dans Téléchargements.
#[tauri::command]
fn save_download(app: tauri::AppHandle, name: String, content: String) -> Result<String, String> {
    let safe = download_name(&name)?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (stem, ext) = match safe.rfind('.') {
        Some(i) if i > 0 => (&safe[..i], &safe[i..]),
        _ => (safe.as_str(), ""),
    };
    let mut path = dir.join(&safe);
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Vrai si l'installation actuelle peut se mettre à jour toute seule. Sous Linux, le greffon ne sait
/// remplacer qu'une AppImage (variable `APPIMAGE` fournie par son lanceur) : pour un .deb ou un .rpm,
/// l'interface propose d'ouvrir la page des versions à la place.
#[tauri::command]
fn self_update_supported() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Mise à jour signée (clé publique dans tauri.conf.json) et relance : bureau seulement.
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
                app.handle().plugin(tauri_plugin_opener::init())?;
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_download,
            db_transaction,
            db_execute,
            db_select,
            self_update_supported
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Nautila");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;

    fn statement(sql: &str, params: Vec<serde_json::Value>) -> Statement {
        Statement { sql: sql.into(), params }
    }

    #[test]
    fn transaction_validee_ou_annulee() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
            sqlx::query("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)").execute(&pool).await.unwrap();

            let ok = [
                statement("INSERT INTO t (id, n) VALUES (?, ?)", vec!["a".into(), 1.into()]),
                statement("INSERT INTO t (id, n) VALUES (?, ?)", vec!["b".into(), 2.into()]),
            ];
            run_transaction(&pool, &ok).await.unwrap();

            // La deuxième instruction viole la clé primaire : la première est annulée avec elle.
            let bad = [
                statement("INSERT INTO t (id, n) VALUES (?, ?)", vec!["c".into(), 3.into()]),
                statement("INSERT INTO t (id, n) VALUES (?, ?)", vec!["a".into(), 4.into()]),
            ];
            assert!(run_transaction(&pool, &bad).await.is_err());

            let rows = sqlx::query("SELECT id, n FROM t ORDER BY id").fetch_all(&pool).await.unwrap();
            let ids: Vec<String> = rows.iter().map(|r| r.get::<String, _>("id")).collect();
            assert_eq!(ids, vec!["a", "b"]);
            assert_eq!(rows[0].get::<i64, _>("n"), 1);
        });
    }

    #[test]
    fn sql_refuse_les_instructions_dangereuses() {
        for sql in [
            "ATTACH DATABASE '/tmp/x.db' AS x",
            "attach '/tmp/x.db' as x",
            "/* commentaire */ DETACH x",
            "VACUUM INTO '/tmp/copie.db'",
            "SELECT load_extension('/tmp/lib')",
            "PRAGMA writable_schema = 1",
            "PRAGMA journal_mode = OFF",
            "SELECT 1; ATTACH 'x' AS y",
        ] {
            assert!(check_sql(sql).is_err(), "{sql}");
        }
        for sql in [
            "PRAGMA user_version",
            "PRAGMA user_version = 12",
            "PRAGMA table_info(pages)",
            "SELECT 'ATTACH DATABASE' AS texte, \"vacuum\" FROM pages -- attach",
            "INSERT INTO pages (id, title) VALUES (?, 'pragma, attach, vacuum')",
        ] {
            assert!(check_sql(sql).is_ok(), "{sql}");
        }
    }

    #[test]
    fn lecture_en_objets_json() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
            run_transaction(&pool, &[statement("CREATE TABLE t (id TEXT, n INTEGER, x REAL, v TEXT)", vec![])])
                .await
                .unwrap();
            run_transaction(
                &pool,
                &[statement("INSERT INTO t VALUES (?, ?, ?, ?)", vec!["a".into(), 2.into(), 1.5.into(), serde_json::Value::Null])],
            )
            .await
            .unwrap();
            let rows = run_select(&pool, "SELECT * FROM t WHERE id = ?", &["a".into()]).await.unwrap();
            assert_eq!(serde_json::Value::Object(rows[0].clone()), serde_json::json!({ "id": "a", "n": 2, "x": 1.5, "v": null }));
            assert!(run_select(&pool, "ATTACH ':memory:' AS autre", &[]).await.is_err());
        });
    }

    #[test]
    fn telechargement_limite_aux_exports() {
        assert_eq!(download_name("Cours.html").unwrap(), "Cours.html");
        assert_eq!(download_name("nautila-2026-01-01.json").unwrap(), "nautila-2026-01-01.json");
        assert_eq!(download_name("a/b.CSV").unwrap(), "a-b.CSV");
        for name in ["piege.exe", "piege.html.bat", "raccourci.lnk", "sans-extension", ".md", "piege.exe."] {
            assert!(download_name(name).is_err(), "{name}");
        }
    }
}
