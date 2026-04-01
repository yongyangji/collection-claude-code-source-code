/**
 * 消息格式化工具
 */

import type { LLMContentBlock } from '../api/types';

export function formatContentBlock(block: LLMContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text || '';
    case 'tool_use':
      return `🔧 ${block.name}: ${JSON.stringify(block.input, null, 2)}`;
    case 'tool_result':
      const content = typeof block.content === 'string' 
        ? block.content 
        : JSON.stringify(block.content, null, 2);
      return block.is_error 
        ? `❌ Tool Result: ${content}`
        : `✅ Tool Result: ${content}`;
    case 'thinking':
      return `💭 Thinking: ${block.thinking || ''}`;
    case 'image':
      return `[Image: ${block.source?.media_type}]`;
    default:
      return JSON.stringify(block);
  }
}

export function formatMessageContent(content: string | LLMContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content.map(formatContentBlock).join('\n\n');
}