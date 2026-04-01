/**
 * 工具注册表
 */

import type { ToolDefinition } from './Tool';
import { bashTool } from './bashTool';
import { fileReadTool } from './fileReadTool';
import { fileEditTool } from './fileEditTool';
import { fileWriteTool } from './fileWriteTool';
import { globTool } from './globTool';
import { grepTool } from './grepTool';

/**
 * 所有可用工具
 */
const ALL_TOOLS: ToolDefinition[] = [
  bashTool,
  fileReadTool,
  fileEditTool,
  fileWriteTool,
  globTool,
  grepTool,
];

/**
 * 获取所有工具定义
 */
export function getTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

/**
 * 根据名称查找工具
 */
export function findToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}

/**
 * 获取工具的 LLM 格式定义
 */
export function getToolDefinitionsForLLM(): Array<{
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}> {
  return ALL_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}