const DC_BASE = 'http://127.0.0.1:9002';

async function checkStatus() {
  const dot = document.getElementById('dot');
  const st = document.getElementById('status');
  try {
    const r = await fetch(`${DC_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const data = await r.json();
      dot.className = 'dot online';
      st.textContent = `Online · ${data.sessions ?? 0} SSE`;
      return true;
    }
  } catch {}
  dot.className = 'dot offline';
  st.textContent = 'DanteClicky offline';
  return false;
}

async function sendTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  document.getElementById('info').textContent = `Sending: ${tab.title}`;
  try {
    await fetch(`${DC_BASE}/v1/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'browser.tab.context',
        url: tab.url,
        title: tab.title,
        source: 'browser-extension-popup',
      }),
    });
    document.getElementById('info').textContent = `Sent: ${tab.url?.slice(0, 60)}`;
  } catch (e) {
    document.getElementById('info').textContent = `Error: ${e.message}`;
  }
}

checkStatus();
document.getElementById('send').addEventListener('click', sendTab);
