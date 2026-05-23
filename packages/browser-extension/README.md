# DanteClicky Browser Bridge

Chrome (MV3) / Firefox extension that sends the active tab URL and title to DanteClicky for AI context awareness.

## Features

- Automatically sends `browser.tab.context` webhook to DanteClicky on every tab change / navigation
- Badge indicator: green (DC online), red (DC offline/error), grey (unknown)
- Popup with manual "Send Current Tab Now" button and health status
- Content script extracts page meta (description, OG tags, H1) for richer context
- Debounced sends (1.5s) to avoid flooding on rapid navigation

## Install (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this directory
4. The DanteClicky Bridge icon appears in your toolbar

## Firefox

1. Open `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `manifest.json` from this directory

## Data sent

Each tab change sends a webhook POST to `http://127.0.0.1:9002/v1/webhook`:

```json
{
  "topic": "browser.tab.context",
  "url": "https://example.com/page",
  "title": "Page Title",
  "tabId": 123,
  "windowId": 1,
  "source": "browser-extension"
}
```

DanteClicky's AI can then reference the current page when answering questions.

## Privacy

- Only sends to `http://127.0.0.1:9002` (local machine only)
- No external telemetry, no cloud upload
- Extension only activates when DanteClicky is running
