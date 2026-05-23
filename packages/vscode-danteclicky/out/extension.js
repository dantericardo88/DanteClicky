"use strict";
/**
 * DanteClicky VS Code Extension
 * Integrates DanteClicky's AI computer-use API into VS Code via the sidebar.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const DC_API = () => vscode.workspace.getConfiguration('danteclicky').get('apiBase', 'http://127.0.0.1:9002');
async function dcFetch(path, init) {
    const res = await fetch(`${DC_API()}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok)
        throw new Error(`DanteClicky HTTP ${res.status} at ${path}`);
    return res.json();
}
async function checkDcRunning() {
    try {
        await dcFetch('/health');
        return true;
    }
    catch {
        return false;
    }
}
async function askDanteClicky(prompt) {
    const result = await dcFetch('/v1/tool/clicky_ask', {
        method: 'POST',
        body: JSON.stringify({ name: 'clicky_ask', input: { prompt, provider: 'anthropic' } }),
    });
    return result?.result ?? '(no response)';
}
// ── Sidebar WebviewViewProvider ───────────────────────────────────────────────
class DanteClickySidebarProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._dcRunning = false;
    }
    resolveWebviewView(webviewView, _ctx, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtml();
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'refresh':
                    await this._refresh();
                    break;
                case 'ask':
                    if (msg.prompt)
                        await this._handleAsk(msg.prompt);
                    break;
                case 'screenshot':
                    await this._handleScreenshot();
                    break;
            }
        });
        // Initial state load
        this._refresh();
    }
    async _refresh() {
        const view = this._view;
        if (!view)
            return;
        try {
            const health = await dcFetch('/health');
            const tools = await dcFetch('/v1/tools');
            this._dcRunning = !!health.ok;
            view.webview.postMessage({
                type: 'state',
                running: this._dcRunning,
                sessions: health.sessions ?? 0,
                tools: tools.tools ?? [],
                apiBase: DC_API(),
            });
        }
        catch {
            this._dcRunning = false;
            view.webview.postMessage({ type: 'state', running: false, sessions: 0, tools: [], apiBase: DC_API() });
        }
    }
    async _handleAsk(prompt) {
        const view = this._view;
        if (!view)
            return;
        view.webview.postMessage({ type: 'thinking' });
        try {
            const answer = await askDanteClicky(prompt);
            view.webview.postMessage({ type: 'answer', text: answer });
        }
        catch (e) {
            view.webview.postMessage({ type: 'error', text: String(e) });
        }
    }
    async _handleScreenshot() {
        const view = this._view;
        if (!view)
            return;
        try {
            const result = await dcFetch('/v1/screenshot?monitor=0');
            view.webview.postMessage({ type: 'screenshot', data: result.data, width: result.width, height: result.height });
        }
        catch (e) {
            view.webview.postMessage({ type: 'error', text: String(e) });
        }
    }
    _getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<title>DanteClicky</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px; margin: 0; }
  .status { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 11px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex-shrink: 0; }
  .dot.online { background: #4ec9b0; }
  .dot.offline { background: #f48771; }
  textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 6px; font-family: inherit; font-size: inherit; resize: vertical; min-height: 64px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; padding: 5px 10px; cursor: pointer; font-size: 12px; margin-top: 4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .answer { margin-top: 10px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; }
  .tools { margin-top: 10px; }
  .tool-item { font-size: 11px; padding: 2px 0; color: var(--vscode-descriptionForeground); }
  .section-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); margin: 10px 0 4px; }
  img.screenshot { width: 100%; border: 1px solid var(--vscode-panel-border); border-radius: 3px; margin-top: 8px; }
  .thinking { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 12px; }
</style>
</head>
<body>
<div class="status">
  <div class="dot" id="dot"></div>
  <span id="status-text">Connecting…</span>
  <button class="secondary" style="margin-left:auto;margin-top:0;padding:2px 7px;font-size:11px" onclick="refresh()">↻</button>
</div>

<div class="section-header">Ask AI</div>
<textarea id="prompt" placeholder="Ask DanteClicky anything…"></textarea>
<div class="actions">
  <button onclick="askAI()">Ask</button>
  <button class="secondary" onclick="captureScreen()">Screenshot</button>
</div>
<div id="answer"></div>

<div class="section-header">Tools</div>
<div id="tools" class="tools"><div class="thinking">Loading…</div></div>

<script>
const vscode = acquireVsCodeApi();

function refresh() { vscode.postMessage({ type: 'refresh' }); }
function askAI() {
  const p = document.getElementById('prompt').value.trim();
  if (!p) return;
  vscode.postMessage({ type: 'ask', prompt: p });
}
function captureScreen() { vscode.postMessage({ type: 'screenshot' }); }

document.getElementById('prompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { askAI(); }
});

window.addEventListener('message', e => {
  const msg = e.data;
  const dot = document.getElementById('dot');
  const st  = document.getElementById('status-text');
  const ans = document.getElementById('answer');
  const tools = document.getElementById('tools');

  if (msg.type === 'state') {
    dot.className = 'dot ' + (msg.running ? 'online' : 'offline');
    st.textContent = msg.running
      ? 'Online · ' + msg.sessions + ' SSE · ' + msg.apiBase
      : 'Offline — start DanteClicky';
    if (msg.tools && msg.tools.length > 0) {
      tools.innerHTML = msg.tools.map(t =>
        '<div class="tool-item">• ' + t.name + '</div>'
      ).join('');
    } else {
      tools.innerHTML = '<div class="tool-item">No tools registered</div>';
    }
  } else if (msg.type === 'thinking') {
    ans.innerHTML = '<div class="thinking">Thinking…</div>';
  } else if (msg.type === 'answer') {
    ans.innerHTML = '<div class="answer">' + escapeHtml(msg.text) + '</div>';
  } else if (msg.type === 'error') {
    ans.innerHTML = '<div class="answer" style="color:var(--vscode-errorForeground)">' + escapeHtml(msg.text) + '</div>';
  } else if (msg.type === 'screenshot') {
    if (msg.data) {
      ans.innerHTML = '<img class="screenshot" src="data:image/jpeg;base64,' + msg.data + '" title="' + msg.width + '×' + msg.height + '">';
    }
  }
});

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

refresh();
</script>
</body>
</html>`;
    }
}
// ── Extension activation ──────────────────────────────────────────────────────
function activate(context) {
    // Sidebar webview
    const sidebarProvider = new DanteClickySidebarProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('danteclicky.sidebar', sidebarProvider));
    // Status bar indicator
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(robot) DC';
    statusBar.tooltip = 'DanteClicky AI Companion';
    statusBar.command = 'danteclicky.status';
    statusBar.show();
    context.subscriptions.push(statusBar);
    const refreshStatus = async () => {
        const running = await checkDcRunning();
        statusBar.color = running ? new vscode.ThemeColor('statusBarItem.prominentForeground') : undefined;
        statusBar.text = running ? '$(robot) DC' : '$(robot) DC (offline)';
    };
    refreshStatus();
    const interval = setInterval(refreshStatus, 30000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
    // Command: Ask about selection
    context.subscriptions.push(vscode.commands.registerCommand('danteclicky.ask', async () => {
        const editor = vscode.window.activeTextEditor;
        const selection = editor?.document.getText(editor.selection);
        const input = selection ? `Regarding this code:\n\`\`\`\n${selection}\n\`\`\`\n` : '';
        const question = await vscode.window.showInputBox({
            prompt: 'Ask DanteClicky about the selected code',
            placeHolder: 'What does this function do?',
        });
        if (!question)
            return;
        const running = await checkDcRunning();
        if (!running) {
            vscode.window.showErrorMessage('DanteClicky is not running. Start the app first.');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Asking DanteClicky…', cancellable: false }, async () => {
            try {
                const answer = await askDanteClicky(input + question);
                const doc = await vscode.workspace.openTextDocument({
                    content: `# DanteClicky Response\n\n**Q:** ${question}\n\n${answer}`,
                    language: 'markdown',
                });
                vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
            }
            catch (e) {
                vscode.window.showErrorMessage(`DanteClicky error: ${e}`);
            }
        });
    }));
    // Command: Screenshot
    context.subscriptions.push(vscode.commands.registerCommand('danteclicky.screenshot', async () => {
        try {
            const result = await dcFetch('/v1/screenshot?monitor=0');
            vscode.window.showInformationMessage(`Screenshot captured: ${result.width}×${result.height}`);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Screenshot failed: ${e}`);
        }
    }));
    // Command: Status
    context.subscriptions.push(vscode.commands.registerCommand('danteclicky.status', async () => {
        try {
            const health = await dcFetch('/health');
            const tools = await dcFetch('/v1/tools');
            vscode.window.showInformationMessage(`DanteClicky: ${health.ok ? 'Running' : 'Error'} | ${tools.tools.length} tools | ${health.sessions} SSE sessions`);
        }
        catch {
            vscode.window.showWarningMessage('DanteClicky is not running at ' + DC_API());
        }
    }));
    // Command: Send current file as webhook context
    context.subscriptions.push(vscode.commands.registerCommand('danteclicky.sendWebhook', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const fileName = editor.document.fileName;
        const language = editor.document.languageId;
        try {
            await dcFetch('/v1/webhook', {
                method: 'POST',
                body: JSON.stringify({
                    topic: 'vscode.file.context',
                    fileName,
                    language,
                    lineCount: editor.document.lineCount,
                    source: 'vscode-danteclicky',
                }),
            });
            vscode.window.showInformationMessage(`File context sent to DanteClicky: ${fileName}`);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to send context: ${e}`);
        }
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map