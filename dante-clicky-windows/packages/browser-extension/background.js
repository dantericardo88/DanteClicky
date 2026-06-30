// DanteClicky Browser Bridge — service worker (MV3)
// Sends active tab context to DanteClicky on navigation / activation.

const DC_BASE = 'http://127.0.0.1:9002';
const DEBOUNCE_MS = 1500;
let debounceTimer = null;
let lastUrl = null;

async function sendTabContext(tab) {
  if (!tab || !tab.url) return;
  // Skip chrome:// / about:// / extension pages
  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return;
  // Debounce rapid navigation
  if (tab.url === lastUrl) return;
  lastUrl = tab.url;

  const payload = {
    topic: 'browser.tab.context',
    url: tab.url,
    title: tab.title ?? '',
    tabId: tab.id,
    windowId: tab.windowId,
    source: 'browser-extension',
  };

  try {
    await fetch(`${DC_BASE}/v1/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    chrome.action.setBadgeBackgroundColor({ color: '#4ec9b0' });
    chrome.action.setBadgeText({ text: '●' });
  } catch {
    chrome.action.setBadgeBackgroundColor({ color: '#f48771' });
    chrome.action.setBadgeText({ text: '!' });
  }
}

function debounced(tab) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => sendTabContext(tab), DEBOUNCE_MS);
}

// Listen for tab activation
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, debounced);
});

// Listen for URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    debounced(tab);
  }
});

// Periodic health poll to update badge
async function pollHealth() {
  try {
    const r = await fetch(`${DC_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      chrome.action.setBadgeBackgroundColor({ color: '#4ec9b0' });
      chrome.action.setBadgeText({ text: '' });
      return;
    }
  } catch {}
  chrome.action.setBadgeBackgroundColor({ color: '#888' });
  chrome.action.setBadgeText({ text: '?' });
}

// Poll every 30s
setInterval(pollHealth, 30_000);
pollHealth();
