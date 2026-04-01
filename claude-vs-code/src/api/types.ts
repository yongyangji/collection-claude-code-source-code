/**
 * 统一的 LLM 消息类型定义
 * 兼容 Anthropic 和 OpenAI 格式
 */

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | LLMContentBlock[];
}

export interface LLMContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | LLMContentBlock[];
  thinking?: string;
  is_error?: boolean;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface LLMTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMStreamEvent {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' 
    | 'message_start' | 'message_delta' | 'message_stop';
  index?: number;
  content_block?: LLMContentBlock;
  delta?: Partial<LLMContentBlock> & { stop_reason?: string };
  usage?: { input_tokens: number; output_tokens: number };
  message?: { id: string; model: string; usage?: { input_tokens: number; output_tokens: number } };
}

export interface LLMRequestParams {
  model: string;
  messages: LLMMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  tools?: LLMTool[];
  max_tokens: number;
  stream: boolean;
  temperature?: number;
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
}

export interface LLMResponse {
  content: LLMContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  id?: string;
  model?: string;
}

export interface LLMClient {
  /** 流式调用 */
  createStream(params: LLMRequestParams): AsyncIterable<LLMStreamEvent>;
  /** 非流式调用 */
  createMessage(params: LLMRequestParams): Promise<LLMResponse>;
}

export type ApiProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'bedrock' | 'vertex';