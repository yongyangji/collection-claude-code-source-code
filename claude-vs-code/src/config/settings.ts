/**
 * 配置管理模块
 */

import * as vscode from 'vscode';

export interface ClaudeCodeSettings {
  apiProvider: 'anthropic' | 'openai' | 'openai-compatible' | 'bedrock' | 'vertex';
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  temperature: number;
  timeout: number;
}

/**
 * 获取所有设置
 */
export function getSettings(): ClaudeCodeSettings {
  const config = vscode.workspace.getConfiguration('claudeCode');

  return {
    apiProvider: config.get('apiProvider', 'anthropic'),
    apiKey: config.get('apiKey', ''),
    baseUrl: config.get('baseUrl', ''),
    model: config.get('model', 'claude-sonnet-4-20250514'),
    maxTokens: config.get('maxTokens', 16384),
    thinkingEnabled: config.get('thinkingEnabled', true),
    thinkingBudget: config.get('thinkingBudget', 10000),
    temperature: config.get('temperature', 0),
    timeout: config.get('timeout', 120000),
  };
}

/**
 * 验证设置是否有效
 */
export function validateSettings(settings: ClaudeCodeSettings): string[] {
  const errors: string[] = [];

  if (!settings.apiKey) {
    errors.push('API key is required');
  }

  if (settings.apiProvider === 'openai-compatible' && !settings.baseUrl) {
    errors.push('Base URL is required for OpenAI-compatible provider');
  }

  if (settings.maxTokens < 1 || settings.maxTokens > 100000) {
    errors.push('Max tokens must be between 1 and 100000');
  }

  if (settings.temperature < 0 || settings.temperature > 1) {
    errors.push('Temperature must be between 0 and 1');
  }

  if (settings.thinkingBudget < 0 || settings.thinkingBudget > 100000) {
    errors.push('Thinking budget must be between 0 and 100000');
  }

  return errors;
}

/**
 * 常用模型的预设配置
 */
export const MODEL_PRESETS: Record<string, { provider: string; baseUrl?: string }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { provider: 'anthropic' },
  'claude-opus-4-20250514': { provider: 'anthropic' },
  'claude-3-5-sonnet-20241022': { provider: 'anthropic' },
  'claude-3-5-haiku-20241022': { provider: 'anthropic' },

  // OpenAI
  'gpt-4o': { provider: 'openai' },
  'gpt-4o-mini': { provider: 'openai' },
  'gpt-4-turbo': { provider: 'openai' },
  'o1-preview': { provider: 'openai' },
  'o1-mini': { provider: 'openai' },

  // DeepSeek
  'deepseek-chat': { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com' },
  'deepseek-reasoner': { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com' },

  // Qwen (通义千问)
  'qwen-turbo': { provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  'qwen-plus': { provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  'qwen-max': { provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },

  // GLM (智谱)
  'glm-4': { provider: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  'glm-4-flash': { provider: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
};

/**
 * 根据模型名称自动选择 provider 和 baseUrl
 */
export function autoDetectProvider(model: string): { provider: string; baseUrl?: string } | null {
  return MODEL_PRESETS[model] || null;
}