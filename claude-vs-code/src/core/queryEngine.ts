/**
 * 查询引擎 - 核心代理循环
 */

import * as vscode from 'vscode';
import type { LLMClient, LLMContentBlock, LLMRequestParams } from '../api/types';
import type { ToolResult } from '../tools/Tool';
import { findToolByName, getToolDefinitionsForLLM } from '../tools/registry';
import { buildSystemPrompt } from './prompts';
import { getModelName, getMaxTokens, getThinkingConfig, getTemperature } from '../api/clientFactory';
import { getHistoryManager, type ChatMessage } from '../utils/historyManager';

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
  private currentUsage = { input_tokens: 0, output_tokens: 0 }; // 当前请求的使用量

  constructor(
    private client: LLMClient,
    private model: string,
    private maxTokens: number,
    private thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' },
    private temperature?: number,
  ) {}

  /**
   * 从历史消息加载
   */
  loadMessages(messages: Message[]) {
    this.messages = [...messages];
  }

  /**
   * 运行查询循环
   */
  async *run(userMessage: string): AsyncGenerator<QueryEvent> {
    this.abortController = new AbortController();
    this.currentUsage = { input_tokens: 0, output_tokens: 0 }; // 重置当前请求使用量
    
    // 保存用户消息到历史
    const historyManager = getHistoryManager();
    await historyManager.addMessage('user', userMessage);
    
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
        // 按 index 追踪正在流式输出的内容块
        const blocksByIndex = new Map<number, {
          type: string; id?: string; name?: string;
          text?: string; thinking?: string;
          partialJson?: string; input?: unknown;
        }>();

        for await (const event of this.client.createStream(params)) {
          if (this.abortController.signal.aborted) {
            yield { type: 'error', error: 'Request cancelled by user' };
            return;
          }

          if (event.type === 'content_block_start' && event.content_block !== undefined) {
            // 记录块的初始信息（type/id/name）
            blocksByIndex.set(event.index!, {
              type: event.content_block.type,
              id: event.content_block.id,
              name: event.content_block.name,
            });
          } else if (event.type === 'content_block_delta') {
            const block = blocksByIndex.get(event.index!);
            if (!block) { continue; }
            const delta = event.delta as any;

            if (delta.type === 'text_delta' || (delta.text !== undefined && block.type === 'text')) {
              // Anthropic: text_delta; OpenAI: delta.text
              const text = (delta.text ?? '') as string;
              if (text) {
                block.text = (block.text || '') + text;
                currentText += text;
                yield { type: 'text', text };
              }
            } else if (delta.type === 'thinking_delta' || (delta.thinking !== undefined && block.type === 'thinking')) {
              const thinking = (delta.thinking ?? '') as string;
              if (thinking) {
                block.thinking = (block.thinking || '') + thinking;
                yield { type: 'thinking', thinking };
              }
            } else if (delta.type === 'input_json_delta') {
              // Anthropic: tool input 为增量 JSON 字符串
              block.partialJson = (block.partialJson || '') + ((delta.partial_json ?? '') as string);
            } else if (delta.type === 'tool_use' && delta.input !== undefined) {
              // OpenAI-compatible: tool input 已解析为对象
              block.input = delta.input;
            }
          } else if (event.type === 'content_block_stop') {
            // 块完成，根据类型写入 contentBlocks
            const block = blocksByIndex.get(event.index!);
            if (!block) { continue; }

            if (block.type === 'tool_use') {
              let input: unknown = block.input;
              if (input === undefined && block.partialJson) {
                try { input = JSON.parse(block.partialJson); } catch { input = {}; }
              }
              if (input === undefined) { input = {}; }
              contentBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input });
              toolCalls.push({ id: block.id!, name: block.name!, input });
              yield { type: 'tool_use', name: block.name, input };
            } else if (block.type === 'text' && block.text) {
              contentBlocks.push({ type: 'text', text: block.text });
            } else if (block.type === 'thinking' && block.thinking) {
              contentBlocks.push({ type: 'thinking', thinking: block.thinking });
            }
          } else if (event.type === 'message_delta' || event.type === 'message_stop') {
            if (event.usage) {
              this.currentUsage.input_tokens += event.usage.input_tokens;
              this.currentUsage.output_tokens += event.usage.output_tokens;
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

      const assistantContent: string | LLMContentBlock[] = contentBlocks.length > 0 ? contentBlocks : currentText;
      this.messages.push({
        role: 'assistant',
        content: assistantContent,
      });

      // 如果没有工具调用，结束
      if (toolCalls.length === 0) {
        // 保存助手消息到历史
        await historyManager.addMessage('assistant', assistantContent, this.currentUsage);
        
        yield { type: 'done', usage: this.currentUsage };
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