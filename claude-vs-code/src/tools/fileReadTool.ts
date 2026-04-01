/**
 * FileRead 工具 - 读取文件内容
 */

import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';
import { createToolResult, createErrorResult } from './Tool';

export const fileReadTool: ToolDefinition = {
  name: 'Read',
  description: `Read the contents of a file at the specified path.

Usage notes:
- Use this tool to read files before editing them
- Provide absolute paths when possible
- Use offset and limit for large files to read specific sections
- Line numbers are 1-indexed in the output`,
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed, default: 1)',
      },
      limit: {
        type: 'number',
        description: 'The number of lines to read (default: all lines)',
      },
    },
    required: ['file_path'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    try {
      const filePath = input.file_path as string;
      const offset = ((input.offset as number) || 1) - 1; // Convert to 0-indexed
      const limit = input.limit as number | undefined;

      // 尝试使用 VSCode API
      const uri = vscode.Uri.file(filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      let text = Buffer.from(content).toString('utf-8');

      // 处理 offset 和 limit
      if (offset > 0 || limit) {
        const lines = text.split('\n');
        const sliced = lines.slice(offset, limit ? offset + limit : undefined);
        // 添加行号
        text = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');
      }

      return createToolResult('', text);
    } catch (err: any) {
      return createErrorResult('', `Failed to read file: ${err.message}`);
    }
  },
};