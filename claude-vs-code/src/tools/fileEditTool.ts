/**
 * FileEdit 工具 - 编辑文件（替换字符串）
 */

import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';
import { createToolResult, createErrorResult } from './Tool';

export const fileEditTool: ToolDefinition = {
  name: 'Edit',
  description: `Edit a file by replacing an exact string match with a new string.

Usage notes:
- The old_string must match EXACTLY (including whitespace, indentation, newlines)
- The old_string must be UNIQUE in the file - if it appears multiple times, the edit will fail
- Use this for precise, surgical edits rather than rewriting entire files
- After editing, verify the change by reading the file again`,
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to replace (must match uniquely)',
      },
      new_string: {
        type: 'string',
        description: 'The replacement string',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    try {
      const filePath = input.file_path as string;
      const oldString = input.old_string as string;
      const newString = input.new_string as string;

      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();

      // 验证唯一性
      const count = text.split(oldString).length - 1;
      if (count === 0) {
        return createErrorResult('', 'old_string not found in file');
      }
      if (count > 1) {
        return createErrorResult('', `old_string found ${count} times in file - must be unique`);
      }

      // 执行替换
      const startIndex = text.indexOf(oldString);
      const startPos = doc.positionAt(startIndex);
      const endPos = doc.positionAt(startIndex + oldString.length);
      const range = new vscode.Range(startPos, endPos);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, newString);
      const success = await vscode.workspace.applyEdit(edit);

      if (!success) {
        return createErrorResult('', 'Failed to apply edit');
      }

      // 保存文件
      await doc.save();

      return createToolResult('', 'Edit applied successfully. The file has been updated.');
    } catch (err: any) {
      return createErrorResult('', `Failed to edit file: ${err.message}`);
    }
  },
};