/**
 * OpenAI 兼容 API 客户端实现
 * 支持 OpenAI、DeepSeek、Qwen、GLM 等所有兼容 OpenAI Chat Completions API 的服务
 */

import OpenAI from 'openai';
import type { LLMClient, LLMRequestParams, LLMStreamEvent, LLMContentBlock, LLMResponse } from './types';

export class OpenAICompatibleLLMClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
  }

  async *createStream(params: LLMRequestParams): AsyncIterable<LLMStreamEvent> {
    // 转换 Anthropic 格式 → OpenAI 格式
    const messages = this.convertMessages(params);
    const tools = params.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    // 发送 message_start 事件
    yield {
      type: 'message_start',
      message: {
        id: `chatcmpl-${Date.now()}`,
        model: params.model,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };

    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: params.max_tokens,
      stream: true,
      temperature: params.temperature ?? 0,
    });

    let currentToolCallId = '';
    let currentToolName = '';
    let currentToolArgs = '';
    let currentTextIndex = 0;
    let currentToolIndex = 1;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      const finishReason = chunk.choices?.[0]?.finish_reason;

      // 更新 usage
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || 0;
      }

      if (!delta) continue;

      // 文本内容
      if (delta.content) {
        yield {
          type: 'content_block_start',
          index: currentTextIndex,
          content_block: { type: 'text', text: '' },
        };
        yield {
          type: 'content_block_delta',
          index: currentTextIndex,
          delta: { type: 'text', text: delta.content },
        };
      }

      // 工具调用
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            // 新工具调用开始
            if (currentToolCallId) {
              // 结束上一个工具调用
              yield {
                type: 'content_block_stop',
                index: currentToolIndex,
              };
              currentToolIndex++;
            }
            currentToolCallId = tc.id;
            currentToolName = tc.function?.name || '';
            currentToolArgs = tc.function?.arguments || '';
            
            yield {
              type: 'content_block_start',
              index: currentToolIndex,
              content_block: { 
                type: 'tool_use', 
                id: tc.id, 
                name: currentToolName,
                input: {},
              },
            };
          } else if (tc.function?.arguments) {
            // 工具参数增量
            currentToolArgs += tc.function.arguments;
            // 尝试解析部分 JSON（可选）
            try {
              const partialInput = JSON.parse(currentToolArgs);
              yield {
                type: 'content_block_delta',
                index: currentToolIndex,
                delta: { 
                  type: 'tool_use',
                  input: partialInput,
                },
              };
            } catch {
              // JSON 不完整，忽略
            }
          }
        }
      }

      // 结束
      if (finishReason) {
        // 结束文本块
        if (delta.content) {
          yield {
            type: 'content_block_stop',
            index: currentTextIndex,
          };
        }
        
        // 结束最后一个工具调用
        if (currentToolCallId) {
          try {
            const finalInput = JSON.parse(currentToolArgs || '{}');
            yield {
              type: 'content_block_delta',
              index: currentToolIndex,
              delta: {
                type: 'tool_use',
                input: finalInput,
              },
            };
          } catch {
            // JSON 解析失败
          }
          yield {
            type: 'content_block_stop',
            index: currentToolIndex,
          };
        }

        yield {
          type: 'message_delta',
          delta: { stop_reason: this.convertStopReason(finishReason) },
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        };
        yield {
          type: 'message_stop',
        };
      }
    }
  }

  async createMessage(params: LLMRequestParams): Promise<LLMResponse> {
    const messages = this.convertMessages(params);
    const tools = params.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: params.max_tokens,
      stream: false,
      temperature: params.temperature ?? 0,
    });

    const choice = response.choices[0];
    const content: LLMContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    return {
      content,
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
      stop_reason: this.convertStopReason(choice.finish_reason || 'stop'),
      id: response.id,
      model: response.model,
    };
  }

  private convertMessages(params: LLMRequestParams): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    // 系统提示词
    if (params.system) {
      const systemText = typeof params.system === 'string'
        ? params.system
        : params.system.map(s => s.text).join('\n');
      result.push({ role: 'system', content: systemText });
    }

    // 消息转换
    for (const msg of params.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          // 处理多模态内容（图片等）和工具结果
          const parts: OpenAI.ChatCompletionContentPart[] = [];
          let hasToolResults = false;

          for (const block of msg.content) {
            if (block.type === 'text') {
              parts.push({ type: 'text', text: block.text || '' });
            } else if (block.type === 'image' && block.source) {
              parts.push({
                type: 'image_url',
                image_url: {
                  url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              });
            } else if (block.type === 'tool_result') {
              // 工具结果需要特殊处理
              hasToolResults = true;
              const text = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
              result.push({
                role: 'tool',
                tool_call_id: block.tool_use_id || '',
                content: text,
              } as any);
            }
          }

          if (!hasToolResults && parts.length > 0) {
            result.push({ role: 'user', content: parts });
          } else if (!hasToolResults && parts.length === 0) {
            // 空用户消息，添加占位符
            result.push({ role: 'user', content: '' });
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'assistant', content: msg.content });
        } else {
          let text = '';
          const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

          for (const block of msg.content) {
            if (block.type === 'text') {
              text += block.text || '';
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id || `call_${Date.now()}`,
                type: 'function',
                function: {
                  name: block.name || '',
                  arguments: JSON.stringify(block.input || {}),
                },
              });
            }
          }

          result.push({
            role: 'assistant',
            content: text || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          } as any);
        }
      }
    }

    return result;
  }

  private convertStopReason(reason: string): string {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'stop_sequence';
      default:
        return reason;
    }
  }
}