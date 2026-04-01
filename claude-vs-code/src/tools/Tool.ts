/**
 * 工具接口定义
 */

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(input: ToolInput): Promise<ToolResult>;
}

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  executeTool(name: string, input: ToolInput, toolUseId: string): Promise<ToolResult>;
}

/**
 * 创建工具结果
 */
export function createToolResult(toolUseId: string, content: string, isError = false): ToolResult {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}

/**
 * 创建错误工具结果
 */
export function createErrorResult(toolUseId: string, message: string): ToolResult {
  return createToolResult(toolUseId, `Error: ${message}`, true);
}