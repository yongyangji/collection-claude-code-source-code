/**
 * 历史记录管理器
 * 使用 VSCode globalState 持久化对话历史
 */

import * as vscode from 'vscode';
import type { LLMContentBlock } from '../api/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
  timestamp: number;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model?: string;
  totalUsage: { input_tokens: number; output_tokens: number };
}

const STORAGE_KEY = 'claudeCode.chatSessions';
const MAX_SESSIONS = 50; // 最多保存50个会话
const MAX_MESSAGES_PER_SESSION = 100; // 每个会话最多保存100条消息

export class HistoryManager {
  private context: vscode.ExtensionContext;
  private currentSession: ChatSession | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * 获取所有会话列表
   */
  async getSessions(): Promise<ChatSession[]> {
    const sessions = this.context.globalState.get<ChatSession[]>(STORAGE_KEY, []);
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt); // 按更新时间倒序
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): ChatSession | null {
    return this.currentSession;
  }

  /**
   * 创建新会话
   */
  async createSession(title?: string): Promise<ChatSession> {
    const session: ChatSession = {
      id: this.generateId(),
      title: title || `Chat ${new Date().toLocaleDateString()}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalUsage: { input_tokens: 0, output_tokens: 0 },
    };

    this.currentSession = session;
    return session;
  }

  /**
   * 加载会话
   */
  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    const sessions = await this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (session) {
      this.currentSession = session;
    }
    
    return session;
  }

  /**
   * 保存当前会话
   */
  async saveCurrentSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.updatedAt = Date.now();

    // 如果会话有消息，自动生成标题
    if (this.currentSession.messages.length > 0 && this.currentSession.title.startsWith('Chat ')) {
      const firstUserMsg = this.currentSession.messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        const content = typeof firstUserMsg.content === 'string' 
          ? firstUserMsg.content 
          : firstUserMsg.content.find(b => b.type === 'text')?.text || '';
        this.currentSession.title = this.generateTitle(content);
      }
    }

    const sessions = await this.getSessions();
    const existingIndex = sessions.findIndex(s => s.id === this.currentSession!.id);

    if (existingIndex >= 0) {
      sessions[existingIndex] = this.currentSession;
    } else {
      sessions.unshift(this.currentSession);
    }

    // 限制会话数量
    if (sessions.length > MAX_SESSIONS) {
      sessions.splice(MAX_SESSIONS);
    }

    await this.context.globalState.update(STORAGE_KEY, sessions);
  }

  /**
   * 添加消息到当前会话
   */
  async addMessage(
    role: 'user' | 'assistant',
    content: string | LLMContentBlock[],
    usage?: { input_tokens: number; output_tokens: number }
  ): Promise<ChatMessage> {
    if (!this.currentSession) {
      await this.createSession();
    }

    const message: ChatMessage = {
      id: this.generateId(),
      role,
      content,
      timestamp: Date.now(),
      usage,
    };

    this.currentSession!.messages.push(message);

    // 更新总使用量
    if (usage) {
      this.currentSession!.totalUsage.input_tokens += usage.input_tokens;
      this.currentSession!.totalUsage.output_tokens += usage.output_tokens;
    }

    // 限制消息数量
    if (this.currentSession!.messages.length > MAX_MESSAGES_PER_SESSION) {
      this.currentSession!.messages = this.currentSession!.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }

    await this.saveCurrentSession();
    return message;
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const index = sessions.findIndex(s => s.id === sessionId);
    
    if (index >= 0) {
      sessions.splice(index, 1);
      await this.context.globalState.update(STORAGE_KEY, sessions);
    }

    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
  }

  /**
   * 清空当前会话
   */
  async clearCurrentSession(): Promise<void> {
    if (this.currentSession) {
      this.currentSession.messages = [];
      this.currentSession.totalUsage = { input_tokens: 0, output_tokens: 0 };
      await this.saveCurrentSession();
    }
  }

  /**
   * 清空所有历史
   */
  async clearAllHistory(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, []);
    this.currentSession = null;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 根据内容生成标题
   */
  private generateTitle(content: string): string {
    // 取前50个字符作为标题
    const title = content.trim().slice(0, 50);
    return title.length < content.length ? title + '...' : title;
  }
}

// 单例实例
let historyManagerInstance: HistoryManager | null = null;

export function initHistoryManager(context: vscode.ExtensionContext): HistoryManager {
  historyManagerInstance = new HistoryManager(context);
  return historyManagerInstance;
}

export function getHistoryManager(): HistoryManager {
  if (!historyManagerInstance) {
    throw new Error('HistoryManager not initialized. Call initHistoryManager first.');
  }
  return historyManagerInstance;
}