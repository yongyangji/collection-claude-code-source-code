/**
 * 查询引擎 - 核心代理循环
 */

import * as vscode from 'vscode';
import type { LLMClient, LLMContentBlock, LLMRequestParams } from '../api/types';
import type { ToolResult } from '../tools/Tool';
import { findToolByName, getToolDefinitionsForLLM } from '../tools/registry';
import { buildSystemPrompt } from './prompts';
import { getModelName, getMaxTokens, getThinkingConfig, getTemperature } from '../api/clientFactory';

interface Message {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
}

export interface QueryEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'done' | 'error';
  text?: string;
  name?: string;
  input?: unknown;
  result?: string;
  thinking?: string;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export class QueryEngine {
  private messages: Message[] = [];
  private totalUsage = { input_tokens: 0, output_tokens: 0 };
  private abortController?: AbortController;

  constructor(
    private client: LLMClient,
    private model: string,
    private maxTokens: number,
    private thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' },
    private temperature?: number,
  ) {}

  /**
   * 运行查询循环
   */
  async *run(userMessage: string): AsyncGenerator<QueryEvent> {
    this.abortController = new AbortController();
    this.messages.push({ role: 'user', content: userMessage });

    const tools = getToolDefinitionsForLLM();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const systemPrompt = buildSystemPrompt(cwd);

    // 代理循环：工具调用 → 结果 → 继续，直到无工具调用
    const MAX_ITERATIONS = 20;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (this.abortController.signal.aborted) {
        yield { type: 'error', error: 'Request cancelled by user' };
        return;
      }

      const params: LLMRequestParams = {
        model: this.model,
        messages: this.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        system: systemPrompt,
        tools,
        max_tokens: this.maxTokens,
        stream: true,
        ...(this.thinking ? { thinking: this.thinking } : {}),
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      };

      // 收集本次响应
      const contentBlocks: LLMContentBlock[] = [];
      let currentText = '';
      let toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

      try {
        for await (const event of this.client.createStream(params)) {
          if (this.abortController.signal.aborted) {
            yield { type: 'error', error: 'Request cancelled by user' };
            return;
          }

          // 处理流事件
          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'thinking' || event.delta?.thinking) {
              yield { type: 'thinking', thinking: event.delta.thinking };
            } else if (event.delta?.type === 'text' || event.delta?.text) {
              const text = event.delta.text || '';
              currentText += text;
              yield { type: 'text', text };
            }
          } else if (event.type === 'content_block_start' && event.content_block) {
            if (event.content_block.type === 'tool_use') {
              // 工具调用开始
            }
          } else if (event.type === 'content_block_stop' && event.content_block) {
            contentBlocks.push(event.content_block);
            if (event.content_block.type === 'tool_use') {
              toolCalls.push({
                id: event.content_block.id!,
                name: event.content_block.name!,
                input: event.content_block.input,
              });
              yield {
                type: 'tool_use',
                name: event.content_block.name,
                input: event.content_block.input,
              };
            }
          } else if (event.type === 'message_delta' || event.type === 'message_stop') {
            if (event.usage) {
              this.totalUsage.input_tokens += event.usage.input_tokens;
              this.totalUsage.output_tokens += event.usage.output_tokens;
            }
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        yield { type: 'error', error: errorMessage };
        return;
      }

      // 保存 assistant 消息
      if (currentText && toolCalls.length === 0) {
        contentBlocks.push({ type: 'text', text: currentText });
      }
      this.messages.push({
        role: 'assistant',
        content: contentBlocks.length > 0 ? contentBlocks : currentText,
      });

      // 如果没有工具调用，结束
      if (toolCalls.length === 0) {
        yield { type: 'done', usage: this.totalUsage };
        return;
      }

      // 执行工具调用
      const toolResults: LLMContentBlock[] = [];
      for (const tc of toolCalls) {
        const tool = findToolByName(tc.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `Error: Unknown tool "${tc.name}"`,
          });
          yield { type: 'tool_result', name: tc.name, result: `Error: Unknown tool "${tc.name}"` };
          continue;
        }

        try {
          const result = await tool.execute(tc.input as Record<string, unknown>);
          result.tool_use_id = tc.id;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: result.content,
          });
          yield { type: 'tool_result', name: tc.name, result: result.content };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `Error: ${errorMessage}`,
          });
          yield { type: 'tool_result', name: tc.name, result: `Error: ${errorMessage}` };
        }
      }

      // 将工具结果作为 user 消息添加
      this.messages.push({ role: 'user', content: toolResults });
    }

    yield { type: 'error', error: 'Max iterations reached (20)' };
  }

  /**
   * 取消当前请求
   */
  cancel() {
    this.abortController?.abort();
  }

  /**
   * 获取消息历史
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取总 token 使用量
   */
  getTotalUsage() {
    return { ...this.totalUsage };
  }

  /**
   * 清空历史
   */
  clearHistory() {
    this.messages = [];
    this.totalUsage = { input_tokens: 0, output_tokens: 0 };
  }
}

/**
 * 创建查询引擎实例
 */
export async function createQueryEngine(): Promise<QueryEngine> {
  const { createLLMClient } = await import('../api/clientFactory');
  const client = await createLLMClient();
  const model = getModelName();
  const maxTokens = getMaxTokens();
  const thinking = getThinkingConfig();
  const temperature = getTemperature();

  return new QueryEngine(client, model, maxTokens, thinking, temperature);
}