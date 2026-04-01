/**
 * Anthropic Claude API 客户端实现
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMRequestParams, LLMStreamEvent, LLMResponse, LLMContentBlock } from './types';

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      maxRetries: 3,
      timeout: 600_000, // 10 minutes
    });
  }

  async *createStream(params: LLMRequestParams): AsyncIterable<LLMStreamEvent> {
    // 构建请求参数
    const requestParams: Anthropic.Messages.MessageCreateParamsStreaming = {
      model: params.model,
      messages: params.messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as any,
      max_tokens: params.max_tokens,
      stream: true,
    };

    // 添加系统提示词
    if (params.system) {
      requestParams.system = params.system as any;
    }

    // 添加工具
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    // 添加 thinking 参数 (Anthropic Beta feature)
    if (params.thinking && params.thinking.type === 'enabled') {
      (requestParams as any).thinking = params.thinking;
    }

    // 添加 temperature
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }

    // 使用 beta API 以支持 extended thinking
    const stream = this.client.beta.messages.stream(requestParams as any);

    // 转换流事件
    for await (const event of stream) {
      yield this.convertEvent(event);
    }
  }

  async createMessage(params: LLMRequestParams): Promise<LLMResponse> {
    const requestParams: Anthropic.Messages.MessageCreateParams = {
      model: params.model,
      messages: params.messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as any,
      max_tokens: params.max_tokens,
      stream: false,
    };

    if (params.system) {
      requestParams.system = params.system as any;
    }

    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    if (params.thinking && params.thinking.type === 'enabled') {
      (requestParams as any).thinking = params.thinking;
    }

    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }

    const response = await this.client.beta.messages.create(requestParams as any);

    return {
      content: response.content as LLMContentBlock[],
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      stop_reason: response.stop_reason || 'end_turn',
      id: response.id,
      model: response.model,
    };
  }

  private convertEvent(event: any): LLMStreamEvent {
    // Anthropic SDK 事件类型映射
    const type = event.type as string;

    if (type === 'message_start') {
      return {
        type: 'message_start',
        message: {
          id: event.message?.id || '',
          model: event.message?.model || '',
          usage: event.message?.usage,
        },
      };
    }

    if (type === 'content_block_start') {
      return {
        type: 'content_block_start',
        index: event.index,
        content_block: event.content_block,
      };
    }

    if (type === 'content_block_delta') {
      return {
        type: 'content_block_delta',
        index: event.index,
        delta: event.delta,
      };
    }

    if (type === 'content_block_stop') {
      return {
        type: 'content_block_stop',
        index: event.index,
      };
    }

    if (type === 'message_delta') {
      return {
        type: 'message_delta',
        delta: {
          stop_reason: event.delta?.stop_reason,
        },
        usage: event.usage,
      };
    }

    if (type === 'message_stop') {
      return {
        type: 'message_stop',
      };
    }

    // 其他事件类型（如 ping、error）忽略或转换
    return {
      type: 'message_delta',
      delta: {},
    };
  }
}