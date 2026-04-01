/**
 * LLM 客户端工厂
 * 根据配置创建对应的 API 客户端
 */

import * as vscode from 'vscode';
import type { LLMClient, ApiProvider } from './types';
import { AnthropicLLMClient } from './anthropicClient';
import { OpenAICompatibleLLMClient } from './openaiClient';

// SecretStorage 引用（从 extension.ts 设置）
let secretStorage: vscode.SecretStorage;

export function setSecretStorage(storage: vscode.SecretStorage) {
  secretStorage = storage;
}

export function getSecretStorage(): vscode.SecretStorage {
  return secretStorage;
}

/**
 * 创建 LLM 客户端
 */
export async function createLLMClient(): Promise<LLMClient> {
  const config = vscode.workspace.getConfiguration('claudeCode');
  const provider = config.get<ApiProvider>('apiProvider', 'anthropic');

  // 从 VSCode SecretStorage 获取 API Key（更安全）
  let apiKey = '';

  if (secretStorage) {
    apiKey = await secretStorage.get('claudeCode.apiKey') || '';
  }

  if (!apiKey) {
    // 回退到设置中的 key（不推荐，明文存储）
    apiKey = config.get<string>('apiKey', '');
  }

  if (!apiKey) {
    throw new Error('No API key configured. Use "Claude Code: Set API Key" command to configure.');
  }

  const baseUrl = config.get<string>('baseUrl', '');

  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient(apiKey, baseUrl || undefined);

    case 'openai':
      return new OpenAICompatibleLLMClient(apiKey, baseUrl || 'https://api.openai.com/v1');

    case 'openai-compatible':
      if (!baseUrl) {
        throw new Error('Base URL is required for OpenAI-compatible providers. Set it in settings.');
      }
      return new OpenAICompatibleLLMClient(apiKey, baseUrl);

    case 'bedrock':
      // TODO: 实现 Bedrock 客户端
      throw new Error('Bedrock provider not yet implemented. Use anthropic provider instead.');

    case 'vertex':
      // TODO: 实现 Vertex 客户端
      throw new Error('Vertex provider not yet implemented. Use anthropic provider instead.');

    default:
      return new AnthropicLLMClient(apiKey, baseUrl || undefined);
  }
}

/**
 * 获取当前配置的模型名称
 */
export function getModelName(): string {
  const config = vscode.workspace.getConfiguration('claudeCode');
  return config.get<string>('model', 'claude-sonnet-4-20250514');
}

/**
 * 获取最大输出 token 数
 */
export function getMaxTokens(): number {
  const config = vscode.workspace.getConfiguration('claudeCode');
  return config.get<number>('maxTokens', 16384);
}

/**
 * 获取 thinking 配置
 */
export function getThinkingConfig(): { type: 'enabled'; budget_tokens: number } | { type: 'disabled' } | undefined {
  const config = vscode.workspace.getConfiguration('claudeCode');
  const enabled = config.get<boolean>('thinkingEnabled', true);
  
  if (!enabled) {
    return { type: 'disabled' };
  }

  const budget = config.get<number>('thinkingBudget', 10000);
  return { type: 'enabled', budget_tokens: budget };
}

/**
 * 获取 temperature
 */
export function getTemperature(): number {
  const config = vscode.workspace.getConfiguration('claudeCode');
  return config.get<number>('temperature', 0);
}

/**
 * 获取超时时间
 */
export function getTimeout(): number {
  const config = vscode.workspace.getConfiguration('claudeCode');
  return config.get<number>('timeout', 120000);
}