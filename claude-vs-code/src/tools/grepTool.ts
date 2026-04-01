/**
 * Grep 工具 - 搜索文件内容
 */

import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';
import { createToolResult, createErrorResult } from './Tool';

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description: `Search for text patterns in files using regex.

Usage notes:
- Use this to find code containing specific text or patterns
- Supports regex patterns for flexible matching
- Returns file paths and line numbers with matching content
- Use include_pattern to limit which files are searched`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The directory to search in (default: workspace root)',
      },
      include_pattern: {
        type: 'string',
        description: 'Glob pattern for files to include (e.g., "*.ts")',
      },
      ignore_case: {
        type: 'boolean',
        description: 'Whether to ignore case (default: false)',
      },
    },
    required: ['pattern'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    try {
      const pattern = input.pattern as string;
      const basePath = (input.path as string) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const includePattern = input.include_pattern as string | undefined;
      const ignoreCase = (input.ignore_case as boolean) || false;

      if (!basePath) {
        return createErrorResult('', 'No workspace folder open');
      }

      // 使用 VSCode 的 search API
      const searchPattern = ignoreCase ? new RegExp(pattern, 'gi') : new RegExp(pattern, 'g');

      // 获取要搜索的文件
      const baseUri = vscode.Uri.file(basePath);
      const files = await vscode.workspace.findFiles(
        includePattern ? new vscode.RelativePattern(baseUri, includePattern) : new vscode.RelativePattern(baseUri, '**/*'),
        '**/node_modules/**',
        500
      );

      const results: string[] = [];

      for (const fileUri of files) {
        try {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString('utf-8');
          const lines = text.split('\n');

          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
          const relativePath = fileUri.fsPath.startsWith(workspaceRoot)
            ? fileUri.fsPath.slice(workspaceRoot.length + 1)
            : fileUri.fsPath;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (searchPattern.test(line)) {
              results.push(`${relativePath}:${i + 1}: ${line.trim()}`);
              // 重置 regex lastIndex
              searchPattern.lastIndex = 0;
            }
          }
        } catch {
          // 忽略无法读取的文件
        }
      }

      if (results.length === 0) {
        return createToolResult('', 'No matches found');
      }

      return createToolResult('', results.join('\n'));
    } catch (err: any) {
      return createErrorResult('', `Failed to search: ${err.message}`);
    }
  },
};