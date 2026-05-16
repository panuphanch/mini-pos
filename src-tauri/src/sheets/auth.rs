use anyhow::{anyhow, Context, Result};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
pub struct ServiceAccount {
    pub client_email: String,
    pub private_key: String,
    pub token_uri: String,
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: u64,
    iat: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

pub struct AuthClient {
    sa: ServiceAccount,
    http: reqwest::Client,
    cache: Mutex<Option<(String, Instant)>>,
}

impl AuthClient {
    pub fn from_file(path: &std::path::Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("Reading service account file {}", path.display()))?;
        let sa: ServiceAccount = serde_json::from_str(&raw)
            .context("Parsing service account JSON")?;
        Ok(Self {
            sa,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()?,
            cache: Mutex::new(None),
        })
    }

    /// Service-account email — intended for the Settings UI to surface
    /// "share the sheet with this email". Not wired yet.
    #[allow(dead_code)]
    pub fn client_email(&self) -> &str { &self.sa.client_email }

    pub async fn access_token(&self) -> Result<String> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some((tok, exp)) = cache.as_ref() {
                if Instant::now() + Duration::from_secs(60) < *exp {
                    return Ok(tok.clone());
                }
            }
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?.as_secs();
        let claims = Claims {
            iss: &self.sa.client_email,
            scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
            aud: &self.sa.token_uri,
            iat: now,
            exp: now + 3600,
        };
        let key = EncodingKey::from_rsa_pem(self.sa.private_key.as_bytes())
            .context("Parsing service account RSA private key")?;
        let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)
            .context("Signing JWT")?;
        let res = self.http.post(&self.sa.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", &jwt),
            ])
            .send().await?;
        if !res.status().is_success() {
            let s = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow!("Token endpoint returned {}: {}", s, body));
        }
        let tr: TokenResponse = res.json().await?;
        let exp = Instant::now() + Duration::from_secs(tr.expires_in);
        *self.cache.lock().unwrap() = Some((tr.access_token.clone(), exp));
        Ok(tr.access_token)
    }
}
