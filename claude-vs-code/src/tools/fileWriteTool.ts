/**
 * FileWrite 工具 - 创建或覆盖文件
 */

import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';
import { createToolResult, createErrorResult } from './Tool';

export const fileWriteTool: ToolDefinition = {
  name: 'Write',
  description: `Write content to a file, creating it if it doesn't exist or overwriting if it does.

Usage notes:
- Use this to create new files or completely rewrite existing files
- For editing existing files, prefer the Edit tool for surgical changes
- The file_path should be an absolute path within the workspace
- The content will be written exactly as provided`,
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    try {
      const filePath = input.file_path as string;
      const content = input.content as string;

      const uri = vscode.Uri.file(filePath);
      const encodedContent = Buffer.from(content, 'utf-8');

      // 检查文件是否存在
      try {
        await vscode.workspace.fs.stat(uri);
        // 文件存在，覆盖
      } catch {
        // 文件不存在，创建
      }

      await vscode.workspace.fs.writeFile(uri, encodedContent);

      return createToolResult('', `File written successfully: ${filePath}`);
    } catch (err: any) {
      return createErrorResult('', `Failed to write file: ${err.message}`);
    }
  },
};