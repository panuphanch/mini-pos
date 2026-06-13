use crate::db::ids::{new_id, now_iso};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub name_th: String,
    pub name_en: Option<String>,
    pub selling_price: i64,
    pub category: Option<String>,
    pub is_active: bool,
    pub image_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProductLite {
    pub id: String,
    pub name_th: String,
    pub name_en: Option<String>,
    pub selling_price: i64,
}

pub async fn create(
    pool: &SqlitePool,
    name_th: &str,
    name_en: Option<&str>,
    selling_price: i64,
) -> Result<Product, sqlx::Error> {
    let id = new_id();
    let now = now_iso();
    sqlx::query(
        r#"INSERT INTO product (id, name_th, name_en, selling_price, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)"#,
    )
    .bind(&id).bind(name_th).bind(name_en).bind(selling_price).bind(&now).bind(&now)
    .execute(pool).await?;
    get_by_id(pool, &id).await.map(Option::unwrap)
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Product>, sqlx::Error> {
    sqlx::query_as::<_, Product>("SELECT * FROM product WHERE id = ?")
        .bind(id).fetch_optional(pool).await
}

pub async fn search(pool: &SqlitePool, q: &str, limit: i64) -> Result<Vec<ProductLite>, sqlx::Error> {
    if q.is_empty() {
        return sqlx::query_as::<_, ProductLite>(
            "SELECT id, name_th, name_en, selling_price FROM product WHERE is_active = 1 ORDER BY name_th LIMIT ?"
        ).bind(limit).fetch_all(pool).await;
    }
    let like = format!("%{}%", q);
    sqlx::query_as::<_, ProductLite>(
        r#"SELECT id, name_th, name_en, selling_price FROM product
           WHERE is_active = 1 AND (name_th LIKE ? OR COALESCE(name_en, '') LIKE ?)
           ORDER BY name_th LIMIT ?"#,
    ).bind(&like).bind(&like).bind(limit).fetch_all(pool).await
}

pub async fn find_by_alias(pool: &SqlitePool, alias: &str) -> Result<Option<Product>, sqlx::Error> {
    sqlx::query_as::<_, Product>(
        r#"SELECT p.* FROM product p
           JOIN product_alias pa ON pa.product_id = p.id
           WHERE pa.alias = ?"#,
    )
    .bind(alias).fetch_optional(pool).await
}

pub async fn update_price(pool: &SqlitePool, id: &str, selling_price: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE product SET selling_price = ?, updated_at = ? WHERE id = ?")
        .bind(selling_price).bind(now_iso()).bind(id)
        .execute(pool).await?;
    Ok(())
}

pub async fn upsert_alias(pool: &SqlitePool, alias: &str, product_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO product_alias (id, alias, product_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(alias) DO UPDATE SET product_id = excluded.product_id"#,
    )
    .bind(new_id()).bind(alias).bind(product_id).bind(now_iso())
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
        let p = create(&pool, "เค้กช็อคฟัดจ์", Some("Choco Fudge"), 85).await.unwrap();
        let results = search(&pool, "ช็อค", 10).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, p.id);

        upsert_alias(&pool, "เค้กช็อคฟัดจ์", &p.id).await.unwrap();
        let found = find_by_alias(&pool, "เค้กช็อคฟัดจ์").await.unwrap().unwrap();
        assert_eq!(found.id, p.id);

        // Alias is idempotent.
        upsert_alias(&pool, "เค้กช็อคฟัดจ์", &p.id).await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM product_alias")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 1);
    }
}
