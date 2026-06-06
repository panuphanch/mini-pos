//! Per-tab ignore lists for the Google Sheet sync.
//!
//! See migration 0004 for the schema rationale. Menu aliases and order rows the
//! cashier marks as "ignore" are filtered out of every sync preview/apply for
//! that tab so they never become products, orders, or unresolved-unknown noise.

use sqlx::SqlitePool;
use std::collections::HashSet;

pub async fn list_ignored_menu(pool: &SqlitePool, tab: &str) -> Result<HashSet<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT alias FROM sync_ignored_menu WHERE source_tab = ?"#,
    )
    .bind(tab)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(a,)| a).collect())
}

pub async fn list_ignored_rows(pool: &SqlitePool, tab: &str) -> Result<HashSet<i64>, sqlx::Error> {
    let rows: Vec<(i64,)> = sqlx::query_as(
        r#"SELECT source_row FROM sync_ignored_row WHERE source_tab = ?"#,
    )
    .bind(tab)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(r,)| r).collect())
}

pub async fn ignore_menu(pool: &SqlitePool, tab: &str, alias: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT OR IGNORE INTO sync_ignored_menu (source_tab, alias) VALUES (?, ?)"#,
    )
    .bind(tab)
    .bind(alias)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn unignore_menu(pool: &SqlitePool, tab: &str, alias: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM sync_ignored_menu WHERE source_tab = ? AND alias = ?"#,
    )
    .bind(tab)
    .bind(alias)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn ignore_row(pool: &SqlitePool, tab: &str, source_row: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT OR IGNORE INTO sync_ignored_row (source_tab, source_row) VALUES (?, ?)"#,
    )
    .bind(tab)
    .bind(source_row)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn unignore_row(pool: &SqlitePool, tab: &str, source_row: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM sync_ignored_row WHERE source_tab = ? AND source_row = ?"#,
    )
    .bind(tab)
    .bind(source_row)
    .execute(pool)
    .await?;
    Ok(())
}
