/**
 * VSCode 扩展入口
 */

import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatPanel';
import { setSecretStorage } from './api/clientFactory';

let secretStorage: vscode.SecretStorage;
let chatProvider: ChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
  // 设置 SecretStorage
  secretStorage = context.secrets;
  setSecretStorage(secretStorage);

  // 注册 Chat Webview Provider
  chatProvider = new ChatViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeCode.chatView', chatProvider)
  );

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.openChat', () => {
      chatProvider.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.askAboutSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }
      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('No text selected');
        return;
      }
      const fileName = editor.document.fileName;
      const languageId = editor.document.languageId;
      chatProvider.show();
      chatProvider.sendMessage(`Explain this code from ${fileName} (${languageId}):\n\`\`\`\n${selection}\n\`\`\``);
    })
  );

  // API Key 设置命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your API key',
        password: true,
        placeHolder: 'sk-ant-... or sk-...',
        ignoreFocusOut: true,
      });
      if (key) {
        await context.secrets.store('claudeCode.apiKey', key);
        vscode.window.showInformationMessage('API key saved securely.');
        chatProvider.notifyApiKeyChanged();
      }
    })
  );

  // 清除历史命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.clearHistory', async () => {
      await chatProvider.clearHistory();
      vscode.window.showInformationMessage('Chat history cleared.');
    })
  );

  // 选择模型命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.selectModel', async () => {
      const models = [
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'gpt-4o',
        'gpt-4o-mini',
        'deepseek-chat',
        'deepseek-reasoner',
      ];
      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select a model',
      });
      if (selected) {
        const config = vscode.workspace.getConfiguration('claudeCode');
        await config.update('model', selected, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model set to ${selected}`);
        chatProvider.notifyConfigChanged();
      }
    })
  );

  // 选择 Provider 命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.selectProvider', async () => {
      const providers = [
        { label: 'Anthropic', value: 'anthropic' },
        { label: 'OpenAI', value: 'openai' },
        { label: 'OpenAI-Compatible (Custom URL)', value: 'openai-compatible' },
      ];
      const selected = await vscode.window.showQuickPick(providers, {
        placeHolder: 'Select API provider',
      });
      if (selected) {
        const config = vscode.workspace.getConfiguration('claudeCode');
        await config.update('apiProvider', selected.value, vscode.ConfigurationTarget.Global);
        
        if (selected.value === 'openai-compatible') {
          const baseUrl = await vscode.window.showInputBox({
            prompt: 'Enter base URL for OpenAI-compatible API',
            placeHolder: 'https://api.deepseek.com',
            ignoreFocusOut: true,
          });
          if (baseUrl) {
            await config.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
          }
        }
        
        vscode.window.showInformationMessage(`Provider set to ${selected.label}`);
        chatProvider.notifyConfigChanged();
      }
    })
  );

  console.log('Claude Code VSCode extension activated');
}

export function deactivate() {
  console.log('Claude Code VSCode extension deactivated');
}