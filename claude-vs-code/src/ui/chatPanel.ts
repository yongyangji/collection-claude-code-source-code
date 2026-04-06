/**
 * Chat Webview Provider
 */

import * as vscode from 'vscode';
import { createLLMClient, getModelName, getMaxTokens, getThinkingConfig, getTemperature } from '../api/clientFactory';
import { QueryEngine, createQueryEngine, QueryEvent } from '../core/queryEngine';
import { getHistoryManager, initHistoryManager, type ChatSession, type ChatMessage } from '../utils/historyManager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private queryEngine?: QueryEngine;
  private isProcessing = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    // 初始化历史管理器
    initHistoryManager(_context);
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    // 处理前端消息
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'sendMessage':
          await this.handleUserMessage(message.text);
          break;
        case 'cancelRequest':
          this.cancelRequest();
          break;
        case 'clearHistory':
          await this.clearHistory();
          break;
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCode');
          break;
        case 'newSession':
          await this.createNewSession();
          break;
        case 'loadSession':
          await this.loadSession(message.sessionId);
          break;
        case 'deleteSession':
          await this.deleteSession(message.sessionId);
          break;
        case 'getSessions':
          await this.sendSessionsList();
          break;
        case 'ready':
          await this.onWebviewReady();
          break;
      }
    });
  }

  /**
   * Webview 准备就绪
   */
  private async onWebviewReady() {
    // 发送会话列表
    await this.sendSessionsList();
    
    // 加载当前会话（如果有）
    const historyManager = getHistoryManager();
    const currentSession = historyManager.getCurrentSession();
    
    if (currentSession) {
      this._view?.webview.postMessage({
        type: 'loadSessionData',
        session: currentSession,
      });
    }
  }

  /**
   * 发送会话列表
   */
  private async sendSessionsList() {
    const historyManager = getHistoryManager();
    const sessions = await historyManager.getSessions();
    this._view?.webview.postMessage({
      type: 'sessionsList',
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      })),
    });
  }

  /**
   * 创建新会话
   */
  private async createNewSession() {
    const historyManager = getHistoryManager();
    await historyManager.createSession();
    this.queryEngine = undefined; // 重置查询引擎
    
    this._view?.webview.postMessage({ type: 'sessionCleared' });
    await this.sendSessionsList();
  }

  /**
   * 加载会话
   */
  private async loadSession(sessionId: string) {
    const historyManager = getHistoryManager();
    const session = await historyManager.loadSession(sessionId);
    
    if (session) {
      // 重新创建查询引擎并加载历史消息
      this.queryEngine = await createQueryEngine();
      this.queryEngine.loadMessages(session.messages.map(m => ({
        role: m.role,
        content: m.content,
      })));
      
      this._view?.webview.postMessage({
        type: 'loadSessionData',
        session,
      });
    }
  }

  /**
   * 删除会话
   */
  private async deleteSession(sessionId: string) {
    const historyManager = getHistoryManager();
    await historyManager.deleteSession(sessionId);
    
    // 如果删除的是当前会话，清空显示
    if (!historyManager.getCurrentSession()) {
      this.queryEngine = undefined;
      this._view?.webview.postMessage({ type: 'sessionCleared' });
    }
    
    await this.sendSessionsList();
  }

  public show() {
    this._view?.show?.(true);
  }

  public async sendMessage(text: string) {
    if (this._view) {
      this._view.webview.postMessage({ type: 'addUserMessage', text });
      await this.handleUserMessage(text);
    }
  }

  public async clearHistory() {
    const historyManager = getHistoryManager();
    await historyManager.clearCurrentSession();
    this.queryEngine?.clearHistory();
    this._view?.webview.postMessage({ type: 'clearHistory' });
  }

  public notifyApiKeyChanged() {
    this._view?.webview.postMessage({ type: 'apiKeyChanged' });
  }

  public notifyConfigChanged() {
    this._view?.webview.postMessage({ type: 'configChanged' });
  }

  private cancelRequest() {
    if (this.queryEngine) {
      this.queryEngine.cancel();
      this.isProcessing = false;
      this._view?.webview.postMessage({ type: 'requestCancelled' });
    }
  }

  private async handleUserMessage(text: string) {
    if (this.isProcessing) {
      this._view?.webview.postMessage({
        type: 'error',
        message: 'A request is already in progress. Please wait or cancel it.',
      });
      return;
    }

    this.isProcessing = true;
    this._view?.webview.postMessage({ type: 'requestStarted' });

    try {
      // 如果没有查询引擎，创建新的；否则复用现有的（保持对话历史）
      if (!this.queryEngine) {
        this.queryEngine = await createQueryEngine();
      }
      const stream = this.queryEngine.run(text);

      for await (const event of stream) {
        if (!this.isProcessing) {
          // 已取消
          break;
        }
        this._view?.webview.postMessage({
          type: 'streamDelta',
          data: event,
        });
      }

      this._view?.webview.postMessage({ type: 'streamEnd' });
    } catch (error: any) {
      this._view?.webview.postMessage({
        type: 'error',
        message: error.message || 'Request failed',
      });
    } finally {
      this.isProcessing = false;
      this._view?.webview.postMessage({ type: 'requestEnded' });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Code Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── header ─────────────────────────────────── */
    #header {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 5px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    #title {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
    }

    .hbtn {
      background: none;
      color: var(--vscode-foreground);
      border: none;
      padding: 3px 7px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 14px;
      opacity: 0.7;
      line-height: 1;
    }
    .hbtn:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }

    /* ── content ─────────────────────────────────── */
    #content-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    }

    /* ── history panel (absolute overlay) ──────── */
    #history-panel {
      position: absolute;
      inset: 0;
      background: var(--vscode-editor-background);
      z-index: 20;
      display: flex;
      flex-direction: column;
    }
    #history-panel.hidden { display: none; }

    #history-header {
      display: flex;
      align-items: center;
      padding: 7px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600;
      font-size: 13px;
      flex-shrink: 0;
    }
    #history-header span { flex: 1; }

    #session-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }

    .empty-state {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      padding: 32px 12px;
      font-size: 12px;
      line-height: 1.6;
    }

    .session-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 2px;
    }
    .session-item:hover { background: var(--vscode-list-hoverBackground); }
    .session-item.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .session-info { flex: 1; min-width: 0; }

    .session-title {
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .session-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .session-item.active .session-meta { color: inherit; opacity: 0.75; }

    .del-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      opacity: 0;
      cursor: pointer;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 12px;
      flex-shrink: 0;
    }
    .session-item:hover .del-btn { opacity: 0.6; }
    .del-btn:hover { opacity: 1 !important; background: var(--vscode-inputValidation-errorBackground); }

    /* ── messages ────────────────────────────────── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .message {
      margin: 6px 0;
      padding: 8px 12px;
      border-radius: 6px;
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.5;
    }
    .user-message {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      margin-left: 14%;
    }
    .assistant-message {
      background: var(--vscode-editor-inactiveSelectionBackground);
      margin-right: 14%;
    }

    .tool-call {
      font-size: 0.88em;
      border-left: 3px solid var(--vscode-textLink-foreground);
      background: var(--vscode-textBlockQuote-background);
      padding: 6px 10px;
      margin: 4px 0;
      border-radius: 0 4px 4px 0;
    }
    .tool-call pre { margin: 4px 0 0; max-height: 100px; overflow-y: auto; }

    .tool-result {
      font-size: 0.85em;
      background: var(--vscode-textCodeBlock-background);
      padding: 6px 10px;
      margin: 4px 0;
      border-radius: 4px;
    }
    .tool-result.error { border-left: 3px solid var(--vscode-errorForeground); }
    .tool-result pre { margin: 4px 0 0; max-height: 100px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }

    .thinking {
      font-style: italic;
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
      border-left: 2px solid var(--vscode-descriptionForeground);
      padding: 4px 8px;
      margin: 4px 0;
      opacity: 0.8;
    }

    .error-msg {
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
      padding: 8px 12px;
      border-radius: 4px;
      margin: 6px 0;
    }

    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 6px 8px;
      border-radius: 3px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    /* ── status ──────────────────────────────────── */
    #status {
      font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
      padding: 2px 8px;
      text-align: center;
      min-height: 18px;
      flex-shrink: 0;
    }
    #status.proc { color: var(--vscode-notificationsInfoIcon-foreground); }

    /* ── input ───────────────────────────────────── */
    #input-area {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 7px 8px;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    #input {
      width: 100%;
      min-height: 54px;
      max-height: 160px;
      resize: vertical;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px 8px;
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      outline: none;
      line-height: 1.4;
    }
    #input:focus { border-color: var(--vscode-focusBorder); }

    #input-btns { display: flex; justify-content: flex-end; gap: 6px; }

    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 5px 12px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 12px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn.sec {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn.sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    #usage {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      text-align: right;
      min-height: 14px;
    }
  </style>
</head>
<body>
  <!-- ── header ── -->
  <div id="header">
    <button class="hbtn" id="history-btn" title="Chat History">☰</button>
    <div id="title">Claude Code</div>
    <button class="hbtn" id="new-chat-btn" title="New Chat">＋</button>
    <button class="hbtn" id="settings-btn" title="Settings">⚙</button>
  </div>

  <!-- ── content area ── -->
  <div id="content-area">
    <!-- history overlay -->
    <div id="history-panel" class="hidden">
      <div id="history-header">
        <span>Chat History</span>
        <button class="hbtn" id="close-hist-btn" title="Close">✕</button>
      </div>
      <div id="session-list"></div>
    </div>

    <!-- messages -->
    <div id="messages"></div>
  </div>

  <div id="status"></div>

  <!-- ── input ── -->
  <div id="input-area">
    <textarea id="input" placeholder="Ask Claude… (Enter to send, Shift+Enter for newline)" rows="3"></textarea>
    <div id="input-btns">
      <button class="btn sec" id="cancel-btn" disabled>Cancel</button>
      <button class="btn" id="send-btn">Send</button>
    </div>
    <div id="usage"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const messagesDiv = document.getElementById('messages');
    const inputEl     = document.getElementById('input');
    const sendBtn     = document.getElementById('send-btn');
    const cancelBtn   = document.getElementById('cancel-btn');
    const newChatBtn  = document.getElementById('new-chat-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const historyBtn  = document.getElementById('history-btn');
    const closeHist   = document.getElementById('close-hist-btn');
    const histPanel   = document.getElementById('history-panel');
    const sessionList = document.getElementById('session-list');
    const statusDiv   = document.getElementById('status');
    const usageDiv    = document.getElementById('usage');

    let currentAssistantDiv = null;
    let isProcessing        = false;
    let currentSessionId    = null;
    let sessions            = [];

    // ── utils ───────────────────────────────────────────────────

    function esc(text) {
      const d = document.createElement('div');
      d.textContent = String(text ?? '');
      return d.innerHTML;
    }

    function scrollBottom() { messagesDiv.scrollTop = messagesDiv.scrollHeight; }

    function setStatus(text, proc) {
      statusDiv.textContent = text;
      statusDiv.className   = proc ? 'proc' : '';
    }

    function setUsage(inp, out) {
      usageDiv.textContent = (inp || out)
        ? 'Tokens: ' + inp + ' in / ' + out + ' out'
        : '';
    }

    // ── message rendering ────────────────────────────────────────

    function addMsg(role, text) {
      const d = document.createElement('div');
      d.className   = 'message ' + role + '-message';
      d.textContent = text;
      messagesDiv.appendChild(d);
      scrollBottom();
      return d;
    }

    function addToolCall(name, toolInput) {
      const d   = document.createElement('div');
      d.className = 'tool-call';
      const str = (typeof toolInput === 'object' && toolInput !== null)
        ? JSON.stringify(toolInput, null, 2)
        : String(toolInput ?? '');
      d.innerHTML = '<strong>🔧 ' + esc(name) + '</strong>'
        + '<pre>' + esc(str) + '</pre>';
      messagesDiv.appendChild(d);
      scrollBottom();
      return d;
    }

    function addToolResult(name, result, isError) {
      const d     = document.createElement('div');
      d.className = 'tool-result' + (isError ? ' error' : '');
      const preview = String(result ?? '').slice(0, 3000);
      d.innerHTML = '<strong>' + (isError ? '❌' : '✅') + ' ' + esc(name) + '</strong>'
        + '<pre>' + esc(preview) + '</pre>';
      messagesDiv.appendChild(d);
      scrollBottom();
      return d;
    }

    function addThinking(thinking) {
      if (!thinking) return null;
      const d     = document.createElement('div');
      d.className = 'thinking';
      d.textContent = '💭 ' + thinking;
      messagesDiv.appendChild(d);
      scrollBottom();
      return d;
    }

    function addError(message) {
      const d     = document.createElement('div');
      d.className = 'error-msg';
      d.textContent = '❌ ' + message;
      messagesDiv.appendChild(d);
      scrollBottom();
      return d;
    }

    // ── render historical session ────────────────────────────────

    function renderSession(session) {
      messagesDiv.innerHTML   = '';
      currentAssistantDiv     = null;
      currentSessionId        = session.id;

      for (const msg of session.messages) {
        if (msg.role === 'user') {
          const text = typeof msg.content === 'string'
            ? msg.content
            : msg.content.filter(b => b.type === 'text').map(b => b.text || '').join('');
          if (text) addMsg('user', text);
        } else if (msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            if (msg.content) addMsg('assistant', msg.content);
          } else {
            let textDiv = null;
            for (const block of msg.content) {
              if (block.type === 'thinking' && block.thinking) {
                addThinking(block.thinking);
              } else if (block.type === 'text' && block.text) {
                if (!textDiv) { textDiv = addMsg('assistant', ''); }
                textDiv.textContent += block.text;
              } else if (block.type === 'tool_use') {
                addToolCall(block.name, block.input);
              }
            }
          }
        }
      }

      if (session.totalUsage) {
        setUsage(session.totalUsage.input_tokens, session.totalUsage.output_tokens);
      }
      scrollBottom();
      renderSessionList();
    }

    // ── session list ─────────────────────────────────────────────

    function relTime(ts) {
      const d = Math.floor((Date.now() - ts) / 60000);
      if (d < 1)  return 'just now';
      if (d < 60) return d + 'm ago';
      const h = Math.floor(d / 60);
      if (h < 24) return h + 'h ago';
      const days = Math.floor(h / 24);
      if (days < 30) return days + 'd ago';
      return new Date(ts).toLocaleDateString();
    }

    function renderSessionList() {
      if (!sessions.length) {
        sessionList.innerHTML = '<div class="empty-state">No chat history yet.<br>Start a new conversation!</div>';
        return;
      }
      sessionList.innerHTML = '';
      for (const s of sessions) {
        const item = document.createElement('div');
        item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'session-info';
        info.innerHTML =
          '<div class="session-title">' + esc(s.title) + '</div>' +
          '<div class="session-meta">' + relTime(s.updatedAt) + ' · ' + s.messageCount + ' msg' + (s.messageCount !== 1 ? 's' : '') + '</div>';

        const del = document.createElement('button');
        del.className   = 'del-btn';
        del.title       = 'Delete';
        del.textContent = '🗑';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'deleteSession', sessionId: s.id });
        });

        item.appendChild(info);
        item.appendChild(del);
        item.addEventListener('click', () => {
          if (s.id !== currentSessionId) {
            vscode.postMessage({ type: 'loadSession', sessionId: s.id });
          }
          toggleHistory(false);
        });
        sessionList.appendChild(item);
      }
    }

    // ── history toggle ───────────────────────────────────────────

    function toggleHistory(show) {
      const open = show !== undefined ? show : histPanel.classList.contains('hidden');
      if (open) {
        histPanel.classList.remove('hidden');
        renderSessionList();
      } else {
        histPanel.classList.add('hidden');
      }
    }

    // ── send ─────────────────────────────────────────────────────

    function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || isProcessing) return;
      addMsg('user', text);
      vscode.postMessage({ type: 'sendMessage', text });
      inputEl.value = '';
    }

    // ── event listeners ──────────────────────────────────────────

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    cancelBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancelRequest' }));
    newChatBtn.addEventListener('click', () => {
      if (isProcessing) return;
      vscode.postMessage({ type: 'newSession' });
      toggleHistory(false);
    });
    settingsBtn.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
    historyBtn.addEventListener('click', () => toggleHistory());
    closeHist.addEventListener('click', () => toggleHistory(false));

    // ── messages from extension ──────────────────────────────────

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {

        case 'sessionsList':
          sessions = msg.sessions || [];
          renderSessionList();
          break;

        case 'loadSessionData':
          renderSession(msg.session);
          break;

        case 'sessionCleared':
          messagesDiv.innerHTML = '';
          currentAssistantDiv   = null;
          currentSessionId      = null;
          setUsage(0, 0);
          setStatus('', false);
          vscode.postMessage({ type: 'getSessions' });
          break;

        case 'addUserMessage':
          addMsg('user', msg.text);
          break;

        case 'requestStarted':
          isProcessing        = true;
          sendBtn.disabled    = true;
          cancelBtn.disabled  = false;
          setStatus('Thinking…', true);
          break;

        case 'requestEnded':
          isProcessing        = false;
          sendBtn.disabled    = false;
          cancelBtn.disabled  = true;
          setStatus('', false);
          vscode.postMessage({ type: 'getSessions' }); // refresh session titles
          break;

        case 'requestCancelled':
          isProcessing        = false;
          sendBtn.disabled    = false;
          cancelBtn.disabled  = true;
          setStatus('Cancelled', false);
          currentAssistantDiv = null;
          break;

        case 'streamDelta': {
          const data = msg.data;
          switch (data.type) {
            case 'text':
              if (!currentAssistantDiv) { currentAssistantDiv = addMsg('assistant', ''); }
              currentAssistantDiv.textContent += data.text || '';
              scrollBottom();
              break;
            case 'thinking':
              if (data.thinking) addThinking(data.thinking);
              break;
            case 'tool_use':
              addToolCall(data.name, data.input);
              currentAssistantDiv = null;
              break;
            case 'tool_result':
              addToolResult(data.name, data.result, String(data.result || '').startsWith('Error:'));
              break;
            case 'done':
              if (data.usage) setUsage(data.usage.input_tokens, data.usage.output_tokens);
              currentAssistantDiv = null;
              break;
            case 'error':
              addError(data.error || 'Unknown error');
              currentAssistantDiv = null;
              break;
          }
          break;
        }

        case 'streamEnd':
          currentAssistantDiv = null;
          break;

        case 'error':
          addError(msg.message || 'Unknown error');
          break;

        case 'clearHistory':
          messagesDiv.innerHTML = '';
          currentAssistantDiv   = null;
          setUsage(0, 0);
          break;

        case 'apiKeyChanged':
          setStatus('API key updated', false);
          break;

        case 'configChanged':
          setStatus('Configuration updated', false);
          break;
      }
    });

    // ── init ─────────────────────────────────────────────────────
    setStatus('Ready', false);
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
