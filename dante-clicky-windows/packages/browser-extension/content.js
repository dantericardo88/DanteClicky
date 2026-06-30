// DanteClicky Browser Bridge — content script
// Runs on every page. Responds to messages from the service worker.
// Extracts page metadata (meta description, OG tags, heading) to enrich context.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'get_page_meta') {
    const meta = extractPageMeta();
    sendResponse(meta);
  }
  return true; // keep channel open for async response
});

function extractPageMeta() {
  const head = document.head;
  const getMeta = (name) =>
    head.querySelector(`meta[name="${name}"]`)?.content ??
    head.querySelector(`meta[property="${name}"]`)?.content ?? null;

  return {
    title:       document.title,
    description: getMeta('description') ?? getMeta('og:description'),
    ogTitle:     getMeta('og:title'),
    canonical:   head.querySelector('link[rel="canonical"]')?.href ?? null,
    h1:          document.querySelector('h1')?.textContent?.trim().slice(0, 200) ?? null,
    lang:        document.documentElement.lang || null,
  };
}
