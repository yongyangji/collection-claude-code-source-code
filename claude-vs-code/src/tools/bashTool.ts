/**
 * Bash 工具 - 执行 shell 命令
 */

import * as child_process from 'child_process';
import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';
import { createToolResult, createErrorResult } from './Tool';

export const bashTool: ToolDefinition = {
  name: 'Bash',
  description: `Execute a bash/shell command in the workspace directory.

Usage notes:
- Use this tool for terminal/shell operations (running tests, installing packages, git operations, etc.)
- For file operations, prefer dedicated tools (Read, Edit, Write) instead of shell commands
- Commands run in the workspace root directory by default
- Avoid commands that require user interaction
- Timeout is 120 seconds by default, can be extended for long-running operations`,
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash/shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000, max: 600000)',
      },
      description: {
        type: 'string',
        description: 'Brief description of what this command does (for user confirmation)',
      },
    },
    required: ['command'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = Math.min((input.timeout as number) || 120_000, 600_000);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    return new Promise((resolve) => {
      child_process.exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        },
        (error, stdout, stderr) => {
          let content = '';

          if (stdout) {
            content += stdout;
          }

          if (stderr) {
            content += (content ? '\n' : '') + 'STDERR:\n' + stderr;
          }

          if (error) {
            if (!content) {
              content = `Error: ${error.message}`;
            }
            resolve(createToolResult('', content, true));
          } else {
            resolve(createToolResult('', content || '(no output)', false));
          }
        }
      );
    });
  },
};