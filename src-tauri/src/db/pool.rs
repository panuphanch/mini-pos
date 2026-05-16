use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteConnectOptions};
use std::path::Path;
use std::str::FromStr;

pub async fn init_pool(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }
    let url = format!("sqlite://{}?mode=rwc", db_path.display());
    let opts = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
pub async fn init_memory_pool() -> Result<SqlitePool, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")?
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_apply_and_tables_exist() {
        let pool = init_memory_pool().await.unwrap();
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='order'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, 1);
        for t in ["product", "customer", "product_alias", "customer_alias",
                  "order_item", "sync_log", "tab_week_mapping"] {
            let r: (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{}'", t))
                .fetch_one(&pool).await.unwrap();
            assert_eq!(r.0, 1, "missing table {}", t);
        }
    }
}
