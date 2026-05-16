use crate::db::ids::{new_id, now_iso};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    pub nickname: Option<String>,
    pub phone: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerLite {
    pub id: String,
    pub name: String,
    pub nickname: Option<String>,
}

pub async fn create(pool: &SqlitePool, name: &str) -> Result<Customer, sqlx::Error> {
    let id = new_id();
    let now = now_iso();
    sqlx::query("INSERT INTO customer (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&id).bind(name).bind(&now).bind(&now)
        .execute(pool).await?;
    get_by_id(pool, &id).await.map(Option::unwrap)
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Customer>, sqlx::Error> {
    sqlx::query_as::<_, Customer>("SELECT * FROM customer WHERE id = ?")
        .bind(id).fetch_optional(pool).await
}

pub async fn search(pool: &SqlitePool, q: &str, limit: i64) -> Result<Vec<CustomerLite>, sqlx::Error> {
    if q.is_empty() {
        return sqlx::query_as::<_, CustomerLite>(
            "SELECT id, name, nickname FROM customer ORDER BY name LIMIT ?"
        ).bind(limit).fetch_all(pool).await;
    }
    let like = format!("%{}%", q);
    sqlx::query_as::<_, CustomerLite>(
        r#"SELECT id, name, nickname FROM customer
           WHERE name LIKE ? OR COALESCE(nickname, '') LIKE ?
           ORDER BY name LIMIT ?"#,
    ).bind(&like).bind(&like).bind(limit).fetch_all(pool).await
}

pub async fn find_by_alias(pool: &SqlitePool, alias: &str) -> Result<Option<Customer>, sqlx::Error> {
    sqlx::query_as::<_, Customer>(
        r#"SELECT c.* FROM customer c
           JOIN customer_alias ca ON ca.customer_id = c.id
           WHERE ca.alias = ?"#,
    )
    .bind(alias).fetch_optional(pool).await
}

pub async fn upsert_alias(pool: &SqlitePool, alias: &str, customer_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO customer_alias (id, alias, customer_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(alias) DO UPDATE SET customer_id = excluded.customer_id"#,
    )
    .bind(new_id()).bind(alias).bind(customer_id).bind(now_iso())
    .execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::init_memory_pool;

    #[tokio::test]
    async fn create_search_alias_roundtrip() {
        let pool = init_memory_pool().await.unwrap();
        let c = create(&pool, "K.Parin").await.unwrap();
        let r = search(&pool, "Parin", 5).await.unwrap();
        assert_eq!(r.len(), 1);
        upsert_alias(&pool, "K.Parin (Aom)", &c.id).await.unwrap();
        let found = find_by_alias(&pool, "K.Parin (Aom)").await.unwrap().unwrap();
        assert_eq!(found.id, c.id);
    }
}
