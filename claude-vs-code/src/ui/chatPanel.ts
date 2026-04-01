/**
 * Chat Webview Provider
 */

import * as vscode from 'vscode';
import { createLLMClient, getModelName, getMaxTokens, getThinkingConfig, getTemperature } from '../api/clientFactory';
import { QueryEngine, createQueryEngine, QueryEvent } from '../core/queryEngine';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private queryEngine?: QueryEngine;
  private isProcessing = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {}

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
          this.clearHistory();
          break;
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCode');
          break;
      }
    });
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

  public clearHistory() {
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
    * { box-sizing: border-box; }
    
    body {
      margin: 0;
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    #header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    #header h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }

    #header-buttons {
      display: flex;
      gap: 4px;
    }

    .header-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 4px 8px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 12px;
    }

    .header-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .message {
      margin: 8px 0;
      padding: 8px 12px;
      border-radius: 6px;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-width: 100%;
    }

    .user-message {
      background: var(--vscode-input-background);
      margin-left: 20%;
    }

    .assistant-message {
      background: var(--vscode-editor-inactiveSelectionBackground);
      margin-right: 20%;
    }

    .tool-call {
      background: var(--vscode-textBlockQuote-background);
      font-size: 0.9em;
      border-left: 3px solid var(--vscode-textLink-foreground);
      padding-left: 8px;
      margin: 4px 0;
      overflow-x: auto;
    }

    .tool-result {
      background: var(--vscode-textCodeBlock-background);
      font-size: 0.85em;
      padding: 6px 8px;
      margin: 4px 0;
      border-radius: 4px;
      overflow-x: auto;
    }

    .tool-result.error {
      border-left: 3px solid var(--vscode-errorForeground);
    }

    .thinking {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      font-size: 0.9em;
      padding: 4px 8px;
      margin: 4px 0;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    }

    .error-message {
      color: var(--vscode-errorForeground);
      background: rgba(255, 0, 0, 0.1);
      padding: 8px 12px;
      border-radius: 6px;
      margin: 8px 0;
    }

    .status {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      padding: 4px 8px;
      text-align: center;
    }

    .status.processing {
      color: var(--vscode-progressBar-background);
    }

    #input-area {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    #input-area textarea {
      width: 100%;
      min-height: 60px;
      max-height: 200px;
      resize: vertical;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 8px;
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      outline: none;
    }

    #input-area textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    #input-buttons {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 13px;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .usage-info {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      text-align: right;
      padding: 4px;
    }

    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 4px;
      border-radius: 2px;
      font-family: var(--vscode-editor-font-family);
    }

    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div id="header">
    <h2>Claude Code</h2>
    <div id="header-buttons">
      <button class="header-btn" id="clear-btn" title="Clear History">Clear</button>
      <button class="header-btn" id="settings-btn" title="Open Settings">Settings</button>
    </div>
  </div>

  <div id="messages"></div>

  <div id="status" class="status"></div>

  <div id="input-area">
    <textarea id="input" placeholder="Ask Claude... (Enter to send, Shift+Enter for newline)" rows="3"></textarea>
    <div id="input-buttons">
      <button class="btn secondary" id="cancel-btn" disabled>Cancel</button>
      <button class="btn" id="send-btn">Send</button>
    </div>
    <div id="usage" class="usage-info"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesDiv = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const clearBtn = document.getElementById('clear-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const statusDiv = document.getElementById('status');
    const usageDiv = document.getElementById('usage');

    let currentAssistantDiv = null;
    let isProcessing = false;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // 发送消息
    function sendMessage() {
      const text = input.value.trim();
      if (!text || isProcessing) return;
      
      addMessage('user', text);
      vscode.postMessage({ type: 'sendMessage', text });
      input.value = '';
    }

    // 添加消息
    function addMessage(role, text) {
      const div = document.createElement('div');
      div.className = 'message ' + role + '-message';
      div.textContent = text;
      messagesDiv.appendChild(div);
      scrollToBottom();
      return div;
    }

    // 添加工具调用
    function addToolCall(name, input) {
      const div = document.createElement('div');
      div.className = 'tool-call';
      div.innerHTML = '<strong>🔧 ' + name + '</strong><pre>' + escapeHtml(JSON.stringify(input, null, 2)) + '</pre>';
      messagesDiv.appendChild(div);
      scrollToBottom();
      return div;
    }

    // 添加工具结果
    function addToolResult(name, result, isError) {
      const div = document.createElement('div');
      div.className = 'tool-result' + (isError ? ' error' : '');
      div.innerHTML = '<strong>' + (isError ? '❌' : '✅') + ' ' + name + '</strong><pre>' + escapeHtml(result) + '</pre>';
      messagesDiv.appendChild(div);
      scrollToBottom();
      return div;
    }

    // 添加思考内容
    function addThinking(thinking) {
      const div = document.createElement('div');
      div.className = 'thinking';
      div.textContent = '💭 ' + thinking;
      messagesDiv.appendChild(div);
      scrollToBottom();
      return div;
    }

    // 滚动到底部
    function scrollToBottom() {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // HTML 转义
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // 更新状态
    function updateStatus(text, processing) {
      statusDiv.textContent = text;
      statusDiv.className = 'status' + (processing ? ' processing' : '');
    }

    // 更新使用量
    function updateUsage(inputTokens, outputTokens) {
      totalInputTokens = inputTokens;
      totalOutputTokens = outputTokens;
      usageDiv.textContent = 'Tokens: ' + inputTokens + ' in / ' + outputTokens + ' out';
    }

    // 事件绑定
    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancelRequest' });
    });

    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearHistory' });
    });

    settingsBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    // 处理来自扩展的消息
    window.addEventListener('message', (event) => {
      const msg = event.data;
      
      switch (msg.type) {
        case 'addUserMessage':
          addMessage('user', msg.text);
          break;

        case 'requestStarted':
          isProcessing = true;
          sendBtn.disabled = true;
          cancelBtn.disabled = false;
          updateStatus('Processing...', true);
          break;

        case 'requestEnded':
          isProcessing = false;
          sendBtn.disabled = false;
          cancelBtn.disabled = true;
          updateStatus('', false);
          break;

        case 'requestCancelled':
          isProcessing = false;
          sendBtn.disabled = false;
          cancelBtn.disabled = true;
          updateStatus('Cancelled', false);
          currentAssistantDiv = null;
          break;

        case 'streamDelta':
          const data = msg.data;
          
          switch (data.type) {
            case 'text':
              if (!currentAssistantDiv) {
                currentAssistantDiv = addMessage('assistant', '');
              }
              currentAssistantDiv.textContent += data.text;
              scrollToBottom();
              break;

            case 'thinking':
              addThinking(data.thinking);
              break;

            case 'tool_use':
              addToolCall(data.name, data.input);
              currentAssistantDiv = null;
              break;

            case 'tool_result':
              addToolResult(data.name, data.result, data.result?.startsWith('Error:'));
              break;

            case 'done':
              if (data.usage) {
                updateUsage(data.usage.input_tokens, data.usage.output_tokens);
              }
              currentAssistantDiv = null;
              break;

            case 'error':
              const errorDiv = document.createElement('div');
              errorDiv.className = 'error-message';
              errorDiv.textContent = '❌ Error: ' + data.error;
              messagesDiv.appendChild(errorDiv);
              scrollToBottom();
              currentAssistantDiv = null;
              break;
          }
          break;

        case 'streamEnd':
          currentAssistantDiv = null;
          break;

        case 'error':
          const errDiv = document.createElement('div');
          errDiv.className = 'error-message';
          errDiv.textContent = '❌ ' + msg.message;
          messagesDiv.appendChild(errDiv);
          scrollToBottom();
          break;

        case 'clearHistory':
          messagesDiv.innerHTML = '';
          totalInputTokens = 0;
          totalOutputTokens = 0;
          usageDiv.textContent = '';
          currentAssistantDiv = null;
          break;

        case 'apiKeyChanged':
          updateStatus('API key updated', false);
          break;

        case 'configChanged':
          updateStatus('Configuration updated', false);
          break;
      }
    });

    // 初始状态
    updateStatus('Ready', false);
  </script>
</body>
</html>`;
  }
}