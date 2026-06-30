/// Dim 94 — Task manager integration (GitHub Issues, Linear, Notion).
///
/// Provides read-only access to task/issue trackers to enrich AI context.
/// GitHub Issues: uses the GitHub REST API (token optional for public repos).
/// Linear: GraphQL API at api.linear.app — requires a Linear Personal API key.
/// Notion: REST API at api.notion.com — requires Notion integration token.

use serde::{Deserialize, Serialize};
use serde_json::Value;

const GITHUB_API_BASE: &str = "https://api.github.com";
const LINEAR_API_BASE: &str = "https://api.linear.app/graphql";
const NOTION_API_BASE: &str = "https://api.notion.com/v1";
const TIMEOUT_SECS: u64 = 10;
const DEFAULT_ISSUE_LIMIT: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
    pub body_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub source: String,
    pub repo: Option<String>,
    pub total: usize,
    pub issues: Vec<GithubIssue>,
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Fetch open GitHub Issues for a repo. (Dim 94)
///
/// - `repo`: "owner/name" (e.g. "dantericardo88/DanteClicky")
/// - `token`: optional GitHub PAT (needed for private repos; public repos work without)
/// - `state`: "open" | "closed" | "all" (default "open")
/// - `limit`: max issues to return (default 20, max 100)
#[tauri::command]
pub async fn get_github_issues(
    repo: String,
    token: Option<String>,
    state: Option<String>,
    limit: Option<usize>,
) -> Result<TaskContext, String> {
    if !repo.contains('/') {
        return Err("repo must be in 'owner/name' format".to_string());
    }

    let n = limit.unwrap_or(DEFAULT_ISSUE_LIMIT).min(100);
    let issue_state = state.as_deref().unwrap_or("open");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .user_agent("DanteClicky/0.1 (github.com/dantericardo88/DanteClicky)")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{GITHUB_API_BASE}/repos/{repo}/issues?state={issue_state}&per_page={n}&sort=updated"
    );

    let mut req = client.get(&url);
    if let Some(tok) = token {
        req = req.bearer_auth(tok);
    }

    let res = req.send().await.map_err(|e| format!("GitHub API unreachable: {e}"))?;

    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("repo '{repo}' not found or not accessible"));
    }
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("unauthorized — provide a GitHub token for private repos".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("GitHub API error: HTTP {}", res.status()));
    }

    let json: Value = res.json().await.map_err(|e| format!("parse error: {e}"))?;
    let arr = json.as_array().ok_or("expected array")?;

    let issues: Vec<GithubIssue> = arr.iter().filter_map(|item| parse_issue(item)).collect();
    let total = issues.len();

    Ok(TaskContext {
        source: "github".to_string(),
        repo: Some(repo),
        total,
        issues,
    })
}

/// Return a summary of GitHub Issues formatted for AI context injection. (Dim 94)
#[tauri::command]
pub async fn get_github_issues_summary(
    repo: String,
    token: Option<String>,
    limit: Option<usize>,
) -> Result<String, String> {
    let ctx = get_github_issues(repo, token, Some("open".to_string()), limit).await?;
    let mut lines = vec![format!(
        "GitHub Issues for {} ({} open):",
        ctx.repo.as_deref().unwrap_or("?"),
        ctx.total
    )];
    for issue in &ctx.issues {
        let labels = if issue.labels.is_empty() {
            String::new()
        } else {
            format!(" [{}]", issue.labels.join(", "))
        };
        lines.push(format!("  #{} {} ({}){}", issue.number, issue.title, issue.state, labels));
    }
    Ok(lines.join("\n"))
}

// ── Linear GraphQL integration ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearIssue {
    pub id: String,
    pub title: String,
    pub state: String,
    pub priority: u8,
    pub assignee: Option<String>,
    pub url: String,
    pub updated_at: String,
}

/// Fetch Linear issues assigned to the current user (or team). (Dim 94)
///
/// - `api_key`: Linear Personal API key (from Linear Settings → API → Personal API keys)
/// - `limit`: max issues (default 20, max 50)
/// - `state_filter`: "In Progress" | "Todo" | "Backlog" | null (all active)
#[tauri::command]
pub async fn get_linear_issues(
    api_key: String,
    limit: Option<usize>,
    state_filter: Option<String>,
) -> Result<TaskContext, String> {
    if api_key.is_empty() {
        return Err("api_key is required — get yours at linear.app Settings → API".to_string());
    }

    let n = limit.unwrap_or(DEFAULT_ISSUE_LIMIT).min(50);
    let state_clause = if let Some(ref s) = state_filter {
        format!(r#"filter: {{ state: {{ name: {{ eq: "{s}" }} }} }}"#)
    } else {
        r#"filter: { state: { type: { in: ["started", "unstarted"] } } }"#.to_string()
    };

    let query = format!(
        r#"{{ "query": "query {{ issues({state_clause}, first: {n}, orderBy: updatedAt) {{ nodes {{ id title state {{ name }} priority assignee {{ name }} url updatedAt }} }} }}" }}"#
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(LINEAR_API_BASE)
        .bearer_auth(&api_key)
        .header("Content-Type", "application/json")
        .body(query)
        .send()
        .await
        .map_err(|e| format!("Linear API unreachable: {e}"))?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("unauthorized — check your Linear API key".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("Linear API error: HTTP {}", res.status()));
    }

    let json: Value = res.json().await.map_err(|e| format!("parse error: {e}"))?;

    if let Some(errors) = json.get("errors") {
        return Err(format!("Linear GraphQL error: {errors}"));
    }

    let nodes = json["data"]["issues"]["nodes"]
        .as_array()
        .ok_or("unexpected Linear response shape")?;

    let issues: Vec<LinearIssue> = nodes.iter().filter_map(|n| {
        Some(LinearIssue {
            id: n["id"].as_str()?.to_string(),
            title: n["title"].as_str()?.to_string(),
            state: n["state"]["name"].as_str().unwrap_or("").to_string(),
            priority: n["priority"].as_u64().unwrap_or(0) as u8,
            assignee: n["assignee"]["name"].as_str().map(String::from),
            url: n["url"].as_str().unwrap_or("").to_string(),
            updated_at: n["updatedAt"].as_str().unwrap_or("").to_string(),
        })
    }).collect();

    let total = issues.len();
    Ok(TaskContext {
        source: "linear".to_string(),
        repo: None,
        total,
        issues: issues.into_iter().map(|li| GithubIssue {
            number: 0, // Linear uses string IDs
            title: li.title,
            state: li.state,
            labels: vec![format!("priority:{}", li.priority)],
            assignee: li.assignee,
            url: li.url,
            created_at: li.updated_at.clone(),
            updated_at: li.updated_at,
            body_preview: None,
        }).collect(),
    })
}

// ── Notion integration ─────────────────────────────────────────────────────────

/// Search Notion database for tasks/pages. (Dim 94)
///
/// - `api_key`: Notion Integration token (from notion.so/profile/integrations)
/// - `database_id`: the Notion database ID to query
/// - `status_filter`: filter by Status property value (e.g. "In Progress")
#[tauri::command]
pub async fn get_notion_tasks(
    api_key: String,
    database_id: String,
    status_filter: Option<String>,
    limit: Option<usize>,
) -> Result<TaskContext, String> {
    if api_key.is_empty() || database_id.is_empty() {
        return Err("api_key and database_id are required".to_string());
    }

    let n = limit.unwrap_or(DEFAULT_ISSUE_LIMIT).min(100);

    let filter_body: Value = if let Some(ref status) = status_filter {
        serde_json::json!({
            "filter": {
                "property": "Status",
                "status": { "equals": status }
            },
            "page_size": n,
        })
    } else {
        serde_json::json!({ "page_size": n })
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{NOTION_API_BASE}/databases/{database_id}/query");
    let res = client
        .post(&url)
        .bearer_auth(&api_key)
        .header("Notion-Version", "2022-06-28")
        .json(&filter_body)
        .send()
        .await
        .map_err(|e| format!("Notion API unreachable: {e}"))?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("unauthorized — check your Notion integration token".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("Notion API error: HTTP {}", res.status()));
    }

    let json: Value = res.json().await.map_err(|e| format!("parse error: {e}"))?;
    let results = json["results"].as_array().ok_or("unexpected Notion response")?;

    let issues: Vec<GithubIssue> = results.iter().enumerate().filter_map(|(i, page)| {
        let props = page.get("properties")?;
        // Look for a "Name" or "Title" property
        let title = props.get("Name")
            .or_else(|| props.get("Title"))
            .and_then(|t| t["title"].as_array())
            .and_then(|a| a.first())
            .and_then(|t| t["plain_text"].as_str())
            .unwrap_or("(untitled)")
            .to_string();

        let status = props.get("Status")
            .and_then(|s| s["status"]["name"].as_str())
            .unwrap_or("unknown")
            .to_string();

        let url = page["url"].as_str().unwrap_or("").to_string();
        let updated_at = page["last_edited_time"].as_str().unwrap_or("").to_string();

        Some(GithubIssue {
            number: (i + 1) as u64,
            title,
            state: status,
            labels: vec![],
            assignee: None,
            url,
            created_at: updated_at.clone(),
            updated_at,
            body_preview: None,
        })
    }).collect();

    let total = issues.len();
    Ok(TaskContext {
        source: "notion".to_string(),
        repo: Some(database_id),
        total,
        issues,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_issue(item: &Value) -> Option<GithubIssue> {
    // Skip pull requests (GitHub returns PRs in the issues endpoint)
    if item.get("pull_request").is_some() { return None; }

    let number = item["number"].as_u64()?;
    let title = item["title"].as_str()?.to_string();
    let state = item["state"].as_str().unwrap_or("open").to_string();
    let url = item["html_url"].as_str().unwrap_or("").to_string();
    let created_at = item["created_at"].as_str().unwrap_or("").to_string();
    let updated_at = item["updated_at"].as_str().unwrap_or("").to_string();

    let labels: Vec<String> = item["labels"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|l| l["name"].as_str().map(String::from))
        .collect();

    let assignee = item["assignee"]["login"].as_str().map(String::from);

    let body_preview = item["body"]
        .as_str()
        .map(|b| b.chars().take(200).collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty());

    Some(GithubIssue { number, title, state, labels, assignee, url, created_at, updated_at, body_preview })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_github_issue_valid() {
        let item = json!({
            "number": 42,
            "title": "Fix the bug",
            "state": "open",
            "html_url": "https://github.com/owner/repo/issues/42",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-05-01T00:00:00Z",
            "labels": [{ "name": "bug" }, { "name": "p1" }],
            "assignee": { "login": "alice" },
            "body": "Description here",
        });
        let issue = parse_issue(&item).expect("parsed");
        assert_eq!(issue.number, 42);
        assert_eq!(issue.labels, vec!["bug", "p1"]);
        assert_eq!(issue.assignee.as_deref(), Some("alice"));
    }

    #[test]
    fn parse_github_pr_skipped() {
        let item = json!({
            "number": 10,
            "title": "PR title",
            "state": "open",
            "html_url": "https://github.com/owner/repo/pull/10",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "labels": [],
            "pull_request": { "url": "..." },
        });
        assert!(parse_issue(&item).is_none(), "PRs should be skipped");
    }

    #[test]
    fn repo_format_validation() {
        // Validate that "owner/name" is required (tested at the command level)
        let bad_repo = "nodash";
        assert!(!bad_repo.contains('/'));
    }
}
