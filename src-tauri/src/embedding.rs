use serde_json::json;

/// Call OpenAI text-embedding-3-small to generate a 384-dim embedding vector.
/// Compatible with the all-MiniLM-L6-v2 WASM embeddings (same dimensionality),
/// so both tracks share the same `search_semantic` cosine-similarity search.
#[tauri::command]
pub async fn generate_embedding(text: String, api_key: String) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post("https://api.openai.com/v1/embeddings")
        .bearer_auth(&api_key)
        .json(&json!({
            "model": "text-embedding-3-small",
            "input": text,
            "dimensions": 384
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    resp["data"][0]["embedding"]
        .as_array()
        .ok_or_else(|| format!("missing embedding in response: {resp}"))?
        .iter()
        .map(|v| {
            v.as_f64()
                .ok_or_else(|| "non-numeric embedding value".to_string())
                .map(|f| f as f32)
        })
        .collect()
}
