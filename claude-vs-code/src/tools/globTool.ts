/**
 * Glob 工具 - 搜索文件
 */

import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';
import { createToolResult, createErrorResult } from './Tool';

export const globTool: ToolDefinition = {
  name: 'Glob',
  description: `Find files matching a glob pattern.

Usage notes:
- Use this to find files by name or path pattern
- Glob patterns use * for any characters and ** for any directory depth
- Examples: "*.ts" for all TypeScript files, "src/**/*.js" for all JS files in src
- Returns relative paths from the workspace root`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files (e.g., "*.ts", "src/**/*.js")',
      },
      path: {
        type: 'string',
        description: 'The directory to search in (default: workspace root)',
      },
    },
    required: ['pattern'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    try {
      const pattern = input.pattern as string;
      const basePath = (input.path as string) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!basePath) {
        return createErrorResult('', 'No workspace folder open');
      }

      const baseUri = vscode.Uri.file(basePath);
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(baseUri, pattern),
        '**/node_modules/**', // Exclude node_modules
        1000 // Max results
      );

      if (files.length === 0) {
        return createToolResult('', 'No files found matching the pattern');
      }

      // 转换为相对路径
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const relativePaths = files.map(uri => {
        const absolute = uri.fsPath;
        if (absolute.startsWith(workspaceRoot)) {
          return absolute.slice(workspaceRoot.length + 1);
        }
        return absolute;
      });

      return createToolResult('', relativePaths.join('\n'));
    } catch (err: any) {
      return createErrorResult('', `Failed to search files: ${err.message}`);
    }
  },
};