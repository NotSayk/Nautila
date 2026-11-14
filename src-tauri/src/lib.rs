use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Instruction SQL avec ses paramètres (chaîne, nombre ou null), telle que l'envoie `src/db/tauri.ts`.
#[derive(serde::Deserialize)]
struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
}

/// Applique les instructions dans une transaction : tout est validé ensemble, ou rien (retour arrière
/// à la première erreur, car `tx` est alors abandonné sans `commit`).
async fn run_transaction(pool: &sqlx::Pool<sqlx::Sqlite>, statements: &[Statement]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for value in &statement.params {
            query = match value {
                serde_json::Value::Null => query.bind(None::<String>),
                serde_json::Value::String(text) => query.bind(text.clone()),
                serde_json::Value::Number(number) => match number.as_i64() {
                    Some(int) => query.bind(int),
                    None => query.bind(number.as_f64().unwrap_or_default()),
                },
                serde_json::Value::Bool(flag) => query.bind(*flag),
                other => query.bind(other.to_string()),
            };
        }
        query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Transaction sur UNE connexion du pool du greffon SQL. Les appels séparés du greffon (`BEGIN`,
/// requêtes, `COMMIT`) peuvent passer par des connexions différentes du pool, d'où cette commande
/// (appelée par `batch` dans src/db/tauri.ts).
#[tauri::command]
async fn db_transaction(
    instances: tauri::State<'_, DbInstances>,
    statements: Vec<Statement>,
) -> Result<(), String> {
    let pools = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = pools.get("sqlite:nautila.db") else {
        return Err("base de données non chargée".into());
    };
    run_transaction(pool, &statements).await
}

/// Enregistre un fichier exporté dans le dossier Téléchargements, sans écraser un fichier existant.
/// Renvoie le chemin écrit. (Dans la fenêtre de bureau, un lien de téléchargement ne fait rien.)
#[tauri::command]
fn save_download(app: tauri::AppHandle, name: String, content: String) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) || c.is_control() { '-' } else { c })
        .collect();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![save_download, db_transaction])
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
}
