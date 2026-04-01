# Claude Code → VSCode 插件改造完整指南

> **目标**：将 Claude Code v2.1.88 TypeScript 源码改造为 VSCode 插件，支持连接自定义大模型 API Key  
> **面向**：AI Agent 执行者（需逐步精确执行）  
> **预计工作量**：大型改造，建议分 8 个阶段执行

---

## 目录

- [Phase 0: 前置知识与架构理解](#phase-0-前置知识与架构理解)
- [Phase 1: 项目脚手架搭建](#phase-1-项目脚手架搭建)
- [Phase 2: 剥离 Bun 依赖与构建系统改造](#phase-2-剥离-bun-依赖与构建系统改造)
- [Phase 3: 移除遥测/远程控制/卧底模式](#phase-3-移除遥测远程控制卧底模式)
- [Phase 4: API 客户端抽象层改造](#phase-4-api-客户端抽象层改造)
- [Phase 5: UI 层改造 (Ink→VSCode Webview)](#phase-5-ui-层改造-inkvscode-webview)
- [Phase 6: 工具系统对接 VSCode API](#phase-6-工具系统对接-vscode-api)
- [Phase 7: 提示词系统与查询引擎迁移](#phase-7-提示词系统与查询引擎迁移)
- [Phase 8: 打包、测试与发布](#phase-8-打包测试与发布)

---

## Phase 0: 前置知识与架构理解

### 0.1 原始架构核心文件

```
src/
├── entrypoints/cli.tsx          # CLI 入口（需替换为 VSCode extension activate）
├── main.tsx                     # 主流程：参数解析 → 初始化 → REPL 启动（4,683行）
├── query.ts                     # 核心代理循环（785KB，最大单文件）
├── QueryEngine.ts               # SDK/Headless 查询生命周期引擎
├── Tool.ts                      # 工具接口定义 + buildTool 工厂
├── tools.ts                     # 工具注册表（~30个内置工具）
├── commands.ts                  # 斜杠命令定义（~87个命令）
├── services/api/client.ts       # Anthropic SDK 客户端创建（⭐关键改造点）
├── services/api/claude.ts       # API 调用封装、流式处理
├── utils/model/providers.ts     # API Provider 选择逻辑
├── utils/model/model.ts         # 模型选择/降级逻辑
├── constants/prompts.ts         # 系统提示词动态构建
├── services/analytics/          # 遥测系统（需移除）
├── services/remoteManagedSettings/ # 远程控制（需移除）
├── utils/undercover.ts          # 卧底模式（需移除）
├── ink.ts                       # Ink/React 终端 UI 包装
├── replLauncher.tsx             # REPL 启动器
└── components/                  # 100+ React/Ink 终端组件
```

### 0.2 核心执行流程

```
cli.tsx → main.tsx (参数解析+初始化)
  → launchRepl() (REPL 启动)
    → processUserInput() (解析 /斜杠命令)
      → query() (主代理循环, query.ts)
        ├── fetchSystemPromptParts() → 组装系统提示词
        ├── getAnthropicClient() → 创建 API 客户端 (⭐改造核心)
        ├── StreamingToolExecutor → 并行工具执行
        ├── autoCompact() → 自动上下文压缩
        └── runTools() → 工具编排调度
      → yield SDKMessage → 流式结果返回
```

### 0.3 关键依赖关系

| 依赖 | 用途 | 改造策略 |
|------|------|----------|
| `@anthropic-ai/sdk` | Anthropic API 客户端 | **保留但抽象**，添加 OpenAI 兼容层 |
| `@anthropic-ai/bedrock-sdk` | AWS Bedrock | 可选保留 |
| `@anthropic-ai/vertex-sdk` | GCP Vertex | 可选保留 |
| `@anthropic-ai/foundry-sdk` | Azure Foundry | 可选保留 |
| `ink` + `react` | 终端 UI | **替换为 VSCode Webview** |
| `@commander-js/extra-typings` | CLI 参数解析 | **移除** |
| `bun:bundle` / `feature()` | 编译时 Feature Gate | **替换为运行时配置** |
| `axios` | HTTP 请求 | 保留 |
| `zod` | Schema 校验 | 保留 |
| `lodash-es` | 工具函数 | 保留 |

---

## Phase 1: 项目脚手架搭建

### 1.1 创建 VSCode 扩展项目结构

```bash
mkdir claude-code-vscode
cd claude-code-vscode
npx yo @nicepkg/gpt-runner # 或手动创建
```

**目标目录结构**：
```
claude-code-vscode/
├── package.json                 # VSCode 扩展清单
├── tsconfig.json
├── webpack.config.js            # 或 esbuild.config.js
├── src/
│   ├── extension.ts             # VSCode 入口 (activate/deactivate)
│   ├── config/
│   │   └── settings.ts          # 用户设置管理（API key, model, base URL 等）
│   ├── api/
│   │   ├── abstractClient.ts    # 抽象 API 客户端接口
│   │   ├── anthropicClient.ts   # Anthropic 实现
│   │   ├── openaiClient.ts      # OpenAI 兼容实现
│   │   └── types.ts             # 统一消息类型
│   ├── core/
│   │   ├── query.ts             # 从原始 query.ts 精简迁移
│   │   ├── queryEngine.ts       # 从原始 QueryEngine.ts 迁移
│   │   ├── toolExecutor.ts      # 工具执行引擎
│   │   └── prompts.ts           # 系统提示词（精简版）
│   ├── tools/                   # 工具实现（对接 VSCode API）
│   │   ├── Tool.ts              # 工具接口（从原始复用）
│   │   ├── bashTool.ts
│   │   ├── fileReadTool.ts
│   │   ├── fileEditTool.ts
│   │   ├── fileWriteTool.ts
│   │   ├── grepTool.ts
│   │   ├── globTool.ts
│   │   └── agentTool.ts
│   ├── ui/
│   │   ├── chatPanel.ts         # Webview Panel 管理
│   │   ├── chatView.html        # 聊天 UI HTML
│   │   ├── chatView.css
│   │   └── chatView.js          # 前端交互逻辑
│   └── utils/                   # 从原始 utils/ 精选迁移
│       ├── messages.ts
│       ├── tokens.ts
│       ├── context.ts
│       └── compact.ts
├── media/                       # 图标等资源
└── test/
```

### 1.2 package.json（VSCode 扩展清单）

```json
{
  "name": "claude-code-vscode",
  "displayName": "Claude Code for VSCode",
  "description": "AI coding assistant powered by your own API key",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["AI", "Chat"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "claudeCode.openChat",
        "title": "Claude Code: Open Chat"
      },
      {
        "command": "claudeCode.askAboutSelection",
        "title": "Claude Code: Ask About Selection"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "claude-code",
          "title": "Claude Code",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "claude-code": [
        {
          "type": "webview",
          "id": "claudeCode.chatView",
          "name": "Chat"
        }
      ]
    },
    "configuration": {
      "title": "Claude Code",
      "properties": {
        "claudeCode.apiProvider": {
          "type": "string",
          "default": "anthropic",
          "enum": ["anthropic", "openai", "openai-compatible", "bedrock", "vertex"],
          "description": "API provider to use"
        },
        "claudeCode.apiKey": {
          "type": "string",
          "default": "",
          "description": "API key (stored in VSCode SecretStorage for security)"
        },
        "claudeCode.baseUrl": {
          "type": "string",
          "default": "",
          "description": "Custom API base URL (for OpenAI-compatible providers)"
        },
        "claudeCode.model": {
          "type": "string",
          "default": "claude-sonnet-4-20250514",
          "description": "Model name to use"
        },
        "claudeCode.maxTokens": {
          "type": "number",
          "default": 16384,
          "description": "Max output tokens per request"
        },
        "claudeCode.thinkingEnabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable extended thinking"
        },
        "claudeCode.thinkingBudget": {
          "type": "number",
          "default": 10000,
          "description": "Max thinking tokens"
        }
      }
    },
    "keybindings": [
      {
        "command": "claudeCode.openChat",
        "key": "ctrl+shift+a",
        "mac": "cmd+shift+a"
      }
    ]
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "esbuild src/extension.ts --bundle --outdir=dist --external:vscode --format=cjs --platform=node",
    "watch": "npm run build -- --watch"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "openai": "^4.70.0",
    "axios": "^1.7.0",
    "zod": "^3.24.0",
    "lodash-es": "^4.17.21"
  }
}
```

### 1.3 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## Phase 2: 剥离 Bun 依赖与构建系统改造

### 2.1 问题说明

原始源码使用 Bun 编译时内置功能，需要全部替换：

| Bun 特性 | 出现位置 | 替换方案 |
|----------|----------|----------|
| `import { feature } from 'bun:bundle'` | 全局约200+处 | 全部替换为运行时配置检查 |
| `feature('KAIROS')` | 条件导入 | `config.isFeatureEnabled('KAIROS')` |
| `feature('COORDINATOR_MODE')` | 条件导入 | 直接移除或替换为 false |
| `MACRO.VERSION` | 版本号内联 | `package.json` version 读取 |
| `MACRO.BUILD_TIME` | 构建时间 | `new Date().toISOString()` |
| `MACRO.FEEDBACK_CHANNEL` | 反馈链接 | 硬编码字符串 |
| `process.env.USER_TYPE === 'ant'` | Anthropic 内部功能 | **全部替换为 false** |

### 2.2 执行步骤

#### 步骤 1: 创建运行时 feature 函数替代

从原始 `stubs/bun-bundle.ts` 可知已有 stub：
```typescript
// stubs/bun-bundle.ts
export function feature(_flag: string): boolean {
  return false  // 外部构建中所有 feature gate 返回 false
}
```

**在新项目中创建** `src/utils/featureFlags.ts`：
```typescript
// 所有内部 feature gate 在开源版中均为 false
// 若将来需要可改为从 VSCode settings 读取
export function feature(flag: string): boolean {
  return false;
}
```

#### 步骤 2: 全局替换 bun:bundle 导入

对所有从原始 src/ 迁移过来的文件执行：
```
// 查找所有 bun:bundle 导入
grep -r "from 'bun:bundle'" src/ --include="*.ts" --include="*.tsx"
grep -r 'from "bun:bundle"' src/ --include="*.ts" --include="*.tsx"

// 替换为本地 stub
// 将: import { feature } from 'bun:bundle'
// 改为: import { feature } from '../utils/featureFlags'
// （注意相对路径根据文件位置调整）
```

#### 步骤 3: 替换 MACRO 引用

对迁移文件执行:
```typescript
// 查找: MACRO.VERSION → 替换为: require('../../package.json').version
// 查找: MACRO.BUILD_TIME → 替换为: new Date().toISOString()
// 查找: MACRO.FEEDBACK_CHANNEL → 替换为: 'https://github.com/your-repo/issues'
// 查找: MACRO.ISSUES_EXPLAINER → 替换为: 'submit a GitHub issue'
// 查找: MACRO.PACKAGE_URL → 替换为: 'claude-code-vscode'
```

#### 步骤 4: 消除 USER_TYPE === 'ant' 条件分支

**规则**：所有 `process.env.USER_TYPE === 'ant'` 条件块**取 else 分支或移除**。

关键影响：
- `constants/prompts.ts`：内部用户获得额外提示词（虚假声明缓解、过度注释修正）→ **建议保留这些优化提示词**，将其变为无条件包含
- `utils/undercover.ts`：卧底模式 → **完全移除**
- 工具注册：部分工具仅内部可用 → 移除 feature gate

---

## Phase 3: 移除遥测/远程控制/卧底模式

### 3.1 需要移除的系统

#### ❌ 遥测系统（完全移除）

**涉及文件**：
```
src/services/analytics/           # 整个目录
├── config.ts                     # isAnalyticsDisabled()
├── datadog.ts                    # Datadog 日志
├── firstPartyEventLoggingExporter.ts  # 1P 遥测导出器
├── growthbook.ts                 # GrowthBook feature flags
├── index.ts                      # logEvent() 主入口
├── metadata.ts                   # 环境指纹收集
└── sink.ts                       # 遥测接收器
```

**替换策略**：创建一个空的 stub 模块：

```typescript
// src/stubs/analytics.ts
export function logEvent(..._args: any[]): void {
  // no-op: telemetry removed
}
export function isAnalyticsDisabled(): boolean {
  return true;
}
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never;
export function sanitizeToolNameForAnalytics(toolName: string): any {
  return toolName;
}
```

**全局替换**：
```
// 所有 import ... from '...services/analytics/index.js'
// 替换为 import ... from '../stubs/analytics'
// 
// 所有 import ... from '...services/analytics/growthbook.js'
// 替换为导出常量 false 的 stub
```

#### ❌ GrowthBook Feature Flags（完全移除）

```typescript
// src/stubs/growthbook.ts
export function getFeatureValue_CACHED_MAY_BE_STALE(_key: string, defaultValue: any): any {
  return defaultValue;
}
export function initializeGrowthBook(): void {}
export function refreshGrowthBookAfterAuthChange(): void {}
export function hasGrowthBookEnvOverride(): boolean { return false; }
export function getDynamicConfig_BLOCKS_ON_INIT(_key: string): any { return null; }
```

#### ❌ 远程托管设置（完全移除）

**涉及文件**：
```
src/services/remoteManagedSettings/
├── index.ts            # 每小时轮询 /api/claude_code/settings
├── securityCheck.jsx   # 危险变更阻塞对话框
├── syncCache.ts
├── syncCacheState.ts
└── types.ts
```

**替换策略**：
```typescript
// src/stubs/remoteManagedSettings.ts
export function loadRemoteManagedSettings(): Promise<void> { return Promise.resolve(); }
export function refreshRemoteManagedSettings(): void {}
export function initializeRemoteManagedSettingsLoadingPromise(): void {}
```

#### ❌ 卧底模式（完全移除）

**涉及文件**：`src/utils/undercover.ts`

```typescript
// src/stubs/undercover.ts
export function isUndercover(): boolean { return false; }
export function getUndercoverInstructions(): string { return ''; }
export function shouldShowUndercoverAutoNotice(): boolean { return false; }
```

#### ❌ OAuth / Claude.ai 订阅系统（简化）

原始代码有复杂的 OAuth 流程（Claude.ai 订阅用户认证）。对于自部署场景，只需 API Key 认证。

**简化 `src/utils/auth.ts`**：只保留 `getAnthropicApiKey()` 相关函数，移除 OAuth 流程。

### 3.2 需要移除的环境检查

以下环境变量检查在 VSCode 插件中无意义，应移除或硬编码：

```typescript
process.env.CLAUDE_CODE_REMOTE           // → false
process.env.CLAUDE_CODE_ENTRYPOINT       // → 'vscode-extension'
process.env.CLAUDE_CODE_CONTAINER_ID     // → 移除
process.env.CLAUDE_CODE_REMOTE_SESSION_ID // → 移除
process.env.CLAUDE_AGENT_SDK_CLIENT_APP  // → 移除
```

---

## Phase 4: API 客户端抽象层改造

### 4.1 原始 API 客户端分析

**核心文件**：`src/services/api/client.ts`

原始 `getAnthropicClient()` 函数（第87-310行）做了以下事情：
1. 构建 HTTP headers（session ID、user agent、自定义 headers）
2. 检查/刷新 OAuth token
3. 根据 provider 选择 SDK：Bedrock / Vertex / Foundry / 直连 Anthropic
4. 创建并返回 `Anthropic` SDK 实例

**核心发现**：provider 选择通过环境变量实现：
```typescript
// src/utils/model/providers.ts
export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ? 'vertex'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ? 'foundry'
    : 'firstParty'
}
```

### 4.2 新的抽象客户端接口

```typescript
// src/api/types.ts
// 统一的消息类型，兼容 Anthropic 和 OpenAI 格式

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | LLMContentBlock[];
}

export interface LLMContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string | LLMContentBlock[];
  thinking?: string;
  source?: { type: string; media_type: string; data: string };
}

export interface LLMTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface LLMStreamEvent {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop'
    | 'message_start' | 'message_delta' | 'message_stop';
  index?: number;
  content_block?: LLMContentBlock;
  delta?: Partial<LLMContentBlock> & { stop_reason?: string };
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LLMRequestParams {
  model: string;
  messages: LLMMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  tools?: LLMTool[];
  max_tokens: number;
  stream: boolean;
  temperature?: number;
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
}

export interface LLMClient {
  /** 流式调用 */
  createStream(params: LLMRequestParams): AsyncIterable<LLMStreamEvent>;
  /** 非流式调用 */
  createMessage(params: LLMRequestParams): Promise<{
    content: LLMContentBlock[];
    usage: { input_tokens: number; output_tokens: number };
    stop_reason: string;
  }>;
}
```

### 4.3 Anthropic 客户端实现

```typescript
// src/api/anthropicClient.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMRequestParams, LLMStreamEvent } from './types';

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      maxRetries: 3,
      timeout: 600_000,
    });
  }

  async *createStream(params: LLMRequestParams): AsyncIterable<LLMStreamEvent> {
    const stream = this.client.messages.stream({
      model: params.model,
      messages: params.messages as any,
      system: params.system as any,
      tools: params.tools as any,
      max_tokens: params.max_tokens,
      ...(params.thinking ? { thinking: params.thinking } as any : {}),
    });

    for await (const event of stream) {
      yield event as unknown as LLMStreamEvent;
    }
  }

  async createMessage(params: LLMRequestParams) {
    const response = await this.client.messages.create({
      model: params.model,
      messages: params.messages as any,
      system: params.system as any,
      tools: params.tools as any,
      max_tokens: params.max_tokens,
      stream: false,
      ...(params.thinking ? { thinking: params.thinking } as any : {}),
    });
    return {
      content: response.content as any,
      usage: response.usage,
      stop_reason: response.stop_reason,
    };
  }
}
```

### 4.4 OpenAI 兼容客户端实现

```typescript
// src/api/openaiClient.ts
// 支持 OpenAI、DeepSeek、Qwen、GLM 等所有兼容 OpenAI Chat Completions API 的服务

import OpenAI from 'openai';
import type { LLMClient, LLMRequestParams, LLMStreamEvent, LLMContentBlock } from './types';

export class OpenAICompatibleLLMClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
  }

  async *createStream(params: LLMRequestParams): AsyncIterable<LLMStreamEvent> {
    // 转换 Anthropic 格式 → OpenAI 格式
    const messages = this.convertMessages(params);
    const tools = params.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: params.max_tokens,
      stream: true,
      temperature: params.temperature ?? 0,
    });

    let currentToolCallId = '';
    let currentToolName = '';
    let currentToolArgs = '';

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // 文本内容
      if (delta.content) {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text', text: delta.content },
        };
      }

      // 工具调用
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            // 新工具调用开始
            if (currentToolCallId) {
              // 结束上一个工具调用
              yield {
                type: 'content_block_stop',
                content_block: {
                  type: 'tool_use',
                  id: currentToolCallId,
                  name: currentToolName,
                  input: JSON.parse(currentToolArgs || '{}'),
                },
              };
            }
            currentToolCallId = tc.id;
            currentToolName = tc.function?.name || '';
            currentToolArgs = tc.function?.arguments || '';
            yield {
              type: 'content_block_start',
              content_block: { type: 'tool_use', id: tc.id, name: currentToolName },
            };
          } else if (tc.function?.arguments) {
            currentToolArgs += tc.function.arguments;
          }
        }
      }

      // 结束
      if (chunk.choices?.[0]?.finish_reason) {
        if (currentToolCallId) {
          yield {
            type: 'content_block_stop',
            content_block: {
              type: 'tool_use',
              id: currentToolCallId,
              name: currentToolName,
              input: JSON.parse(currentToolArgs || '{}'),
            },
          };
        }
        yield {
          type: 'message_stop',
          delta: { stop_reason: chunk.choices[0].finish_reason },
          usage: {
            input_tokens: chunk.usage?.prompt_tokens || 0,
            output_tokens: chunk.usage?.completion_tokens || 0,
          },
        };
      }
    }
  }

  async createMessage(params: LLMRequestParams) {
    const messages = this.convertMessages(params);
    const tools = params.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: params.max_tokens,
      stream: false,
    });

    const choice = response.choices[0];
    const content: LLMContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    return {
      content,
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
      stop_reason: choice.finish_reason || 'end_turn',
    };
  }

  private convertMessages(params: LLMRequestParams): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    // 系统提示词
    if (params.system) {
      const systemText = typeof params.system === 'string'
        ? params.system
        : params.system.map(s => s.text).join('\n');
      result.push({ role: 'system', content: systemText });
    }

    // 消息转换
    for (const msg of params.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          // 处理多模态内容（图片等）
          const parts: OpenAI.ChatCompletionContentPart[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              parts.push({ type: 'text', text: block.text || '' });
            } else if (block.type === 'tool_result') {
              // 工具结果转为文本
              const text = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
              result.push({
                role: 'tool',
                tool_call_id: block.tool_use_id || '',
                content: text,
              } as any);
              continue;
            }
          }
          if (parts.length > 0) {
            result.push({ role: 'user', content: parts });
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'assistant', content: msg.content });
        } else {
          let text = '';
          const toolCalls: any[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              text += block.text || '';
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              });
            }
          }
          result.push({
            role: 'assistant',
            content: text || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          } as any);
        }
      }
    }

    return result;
  }
}
```

### 4.5 客户端工厂

```typescript
// src/api/clientFactory.ts
import * as vscode from 'vscode';
import type { LLMClient } from './types';
import { AnthropicLLMClient } from './anthropicClient';
import { OpenAICompatibleLLMClient } from './openaiClient';

export type ApiProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'bedrock' | 'vertex';

export async function createLLMClient(): Promise<LLMClient> {
  const config = vscode.workspace.getConfiguration('claudeCode');
  const provider = config.get<ApiProvider>('apiProvider', 'anthropic');

  // 从 VSCode SecretStorage 获取 API Key（更安全）
  const secretStorage = getSecretStorage(); // 见 Phase 1 extension.ts
  let apiKey = await secretStorage.get('claudeCode.apiKey');

  if (!apiKey) {
    // 回退到设置中的 key（不推荐，明文存储）
    apiKey = config.get<string>('apiKey', '');
  }

  if (!apiKey) {
    throw new Error('No API key configured. Set it via Claude Code settings or command palette.');
  }

  const baseUrl = config.get<string>('baseUrl', '');

  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient(apiKey, baseUrl || undefined);

    case 'openai':
      return new OpenAICompatibleLLMClient(apiKey, baseUrl || 'https://api.openai.com/v1');

    case 'openai-compatible':
      if (!baseUrl) {
        throw new Error('Base URL is required for OpenAI-compatible providers');
      }
      return new OpenAICompatibleLLMClient(apiKey, baseUrl);

    default:
      return new AnthropicLLMClient(apiKey, baseUrl || undefined);
  }
}
```

### 4.6 原始代码改造对照

**原始** `src/services/api/client.ts` 的 `getAnthropicClient()` 需要改造为上述 `createLLMClient()`。

核心替换点（在迁移 query.ts / claude.ts 时执行）：

```typescript
// 原始代码 (claude.ts 中调用)：
const client = await getAnthropicClient({ maxRetries: 3, model })
const stream = client.beta.messages.stream({ ... })

// 替换为：
const client = await createLLMClient()
const stream = client.createStream({ ... })
```

---

## Phase 5: UI 层改造 (Ink → VSCode Webview)

### 5.1 改造策略

原始代码使用 Ink (React for CLI) 渲染终端 UI。VSCode 插件需要：
- **Webview Panel** 作为聊天界面
- **VSCode API** 替代终端交互
- **完全移除** Ink/React 依赖

### 5.2 VSCode 入口文件

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatPanel';

let secretStorage: vscode.SecretStorage;

export function getSecretStorage(): vscode.SecretStorage {
  return secretStorage;
}

export function activate(context: vscode.ExtensionContext) {
  secretStorage = context.secrets;

  // 注册 Chat Webview Provider
  const chatProvider = new ChatViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeCode.chatView', chatProvider)
  );

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.openChat', () => {
      chatProvider.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.askAboutSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('No text selected');
        return;
      }
      chatProvider.sendMessage(`Explain this code:\n\`\`\`\n${selection}\n\`\`\``);
    })
  );

  // API Key 设置命令
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCode.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your API key',
        password: true,
        placeHolder: 'sk-ant-... or sk-...',
      });
      if (key) {
        await context.secrets.store('claudeCode.apiKey', key);
        vscode.window.showInformationMessage('API key saved securely.');
      }
    })
  );
}

export function deactivate() {}
```

### 5.3 Webview Panel

```typescript
// src/ui/chatPanel.ts
import * as vscode from 'vscode';
import { createLLMClient } from '../api/clientFactory';
// 从迁移的核心模块导入
import { queryEngine } from '../core/queryEngine';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    // 处理前端消息
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'sendMessage':
          await this.handleUserMessage(message.text);
          break;
        case 'cancelRequest':
          // 取消当前请求
          break;
      }
    });
  }

  public show() {
    this._view?.show?.(true);
  }

  public async sendMessage(text: string) {
    if (this._view) {
      this._view.webview.postMessage({ type: 'addUserMessage', text });
      await this.handleUserMessage(text);
    }
  }

  private async handleUserMessage(text: string) {
    try {
      const client = await createLLMClient();
      // 调用核心查询引擎（迁移自 query.ts 的精简版）
      const stream = queryEngine.run(client, text);

      for await (const event of stream) {
        this._view?.webview.postMessage({
          type: 'streamDelta',
          data: event,
        });
      }

      this._view?.webview.postMessage({ type: 'streamEnd' });
    } catch (error: any) {
      this._view?.webview.postMessage({
        type: 'error',
        message: error.message || 'Request failed',
      });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    // 返回完整的聊天 UI HTML
    // 可以用简洁的原生HTML+CSS，或引入前端框架
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* 见 Phase 5.4 的样式 */
    body { margin: 0; padding: 8px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    #chat-container { display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; padding-bottom: 8px; }
    .message { margin: 4px 0; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; }
    .user-message { background: var(--vscode-input-background); }
    .assistant-message { background: var(--vscode-editor-inactiveSelectionBackground); }
    .tool-call { background: var(--vscode-textBlockQuote-background); font-size: 0.9em; border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 8px; margin: 4px 0; }
    .thinking { color: var(--vscode-descriptionForeground); font-style: italic; }
    .error { color: var(--vscode-errorForeground); }
    #input-area { display: flex; gap: 4px; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }
    #input-area textarea { flex: 1; resize: none; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; border-radius: 3px; font-family: inherit; }
    #input-area button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; }
  </style>
</head>
<body>
  <div id="chat-container">
    <div id="messages"></div>
    <div id="input-area">
      <textarea id="input" rows="3" placeholder="Ask Claude..."></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesDiv = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    let currentAssistantDiv = null;

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
    });

    function send() {
      const text = input.value.trim();
      if (!text) return;
      addMessage('user', text);
      vscode.postMessage({ type: 'sendMessage', text });
      input.value = '';
    }

    function addMessage(role, text) {
      const div = document.createElement('div');
      div.className = 'message ' + role + '-message';
      div.textContent = text;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return div;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'addUserMessage':
          addMessage('user', msg.text);
          break;
        case 'streamDelta':
          if (!currentAssistantDiv) {
            currentAssistantDiv = addMessage('assistant', '');
          }
          if (msg.data.type === 'text') {
            currentAssistantDiv.textContent += msg.data.text;
          } else if (msg.data.type === 'tool_use') {
            const toolDiv = document.createElement('div');
            toolDiv.className = 'tool-call';
            toolDiv.textContent = '🔧 ' + msg.data.name + ': ' + JSON.stringify(msg.data.input, null, 2);
            messagesDiv.appendChild(toolDiv);
          } else if (msg.data.type === 'thinking') {
            const thinkDiv = document.createElement('div');
            thinkDiv.className = 'thinking';
            thinkDiv.textContent = '💭 ' + msg.data.thinking;
            messagesDiv.appendChild(thinkDiv);
          }
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
          break;
        case 'streamEnd':
          currentAssistantDiv = null;
          break;
        case 'error':
          addMessage('assistant', '❌ Error: ' + msg.message).classList.add('error');
          currentAssistantDiv = null;
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
```

---

## Phase 6: 工具系统对接 VSCode API

### 6.1 工具接口定义

从原始 `Tool.ts` 精简迁移核心接口：

```typescript
// src/tools/Tool.ts
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
    properties: Record<string, any>;
    required?: string[];
  };
  execute(input: ToolInput): Promise<ToolResult>;
}
```

### 6.2 需要迁移的工具（优先级排序）

| 优先级 | 工具 | 原始文件 | VSCode API 对接 |
|--------|------|----------|----------------|
| 🔴 P0 | **BashTool** | `tools/BashTool/` | `vscode.window.createTerminal()` + child_process |
| 🔴 P0 | **FileReadTool** | `tools/FileReadTool/` | `vscode.workspace.fs.readFile()` |
| 🔴 P0 | **FileEditTool** | `tools/FileEditTool/` | `vscode.workspace.applyEdit()` |
| 🔴 P0 | **FileWriteTool** | `tools/FileWriteTool/` | `vscode.workspace.fs.writeFile()` |
| 🟡 P1 | **GlobTool** | `tools/GlobTool/` | `vscode.workspace.findFiles()` |
| 🟡 P1 | **GrepTool** | `tools/GrepTool/` | `vscode.workspace.findFiles()` + ripgrep |
| 🟡 P1 | **AgentTool** | `tools/AgentTool/` | 子查询递归执行 |
| 🟢 P2 | **WebSearchTool** | `tools/WebSearchTool/` | axios 网络请求 |
| 🟢 P2 | **WebFetchTool** | `tools/WebFetchTool/` | axios 网络请求 |
| 🟢 P2 | **LSPTool** | `tools/LSPTool/` | VSCode Language API |
| ⚪ P3 | **NotebookEditTool** | `tools/NotebookEditTool/` | VSCode Notebook API |
| ⚪ P3 | **MCPTool** | `tools/MCPTool/` | MCP SDK |

### 6.3 工具实现示例

```typescript
// src/tools/fileReadTool.ts
import * as vscode from 'vscode';
import * as path from 'path';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';

export const fileReadTool: ToolDefinition = {
  name: 'Read',
  description: 'Read the contents of a file at the specified path.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      offset: { type: 'number', description: 'Line offset to start reading from (0-indexed)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' },
    },
    required: ['file_path'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    try {
      const filePath = input.file_path as string;
      const uri = vscode.Uri.file(filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      let text = Buffer.from(content).toString('utf-8');

      const offset = (input.offset as number) || 0;
      const limit = (input.limit as number) || undefined;

      if (offset > 0 || limit) {
        const lines = text.split('\n');
        const sliced = lines.slice(offset, limit ? offset + limit : undefined);
        text = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');
      }

      return { type: 'tool_result', tool_use_id: '', content: text };
    } catch (err: any) {
      return { type: 'tool_result', tool_use_id: '', content: `Error: ${err.message}`, is_error: true };
    }
  },
};
```

```typescript
// src/tools/bashTool.ts
import * as child_process from 'child_process';
import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';

export const bashTool: ToolDefinition = {
  name: 'Bash',
  description: 'Execute a bash command in the workspace directory.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
    },
    required: ['command'],
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || 120_000;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    return new Promise((resolve) => {
      child_process.exec(command, { cwd, timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        let content = '';
        if (stdout) content += stdout;
        if (stderr) content += (content ? '\n' : '') + 'STDERR:\n' + stderr;
        if (error && !content) content = `Error: ${error.message}`;

        resolve({
          type: 'tool_result',
          tool_use_id: '',
          content: content || '(no output)',
          is_error: !!error,
        });
      });
    });
  },
};
```

```typescript
// src/tools/fileEditTool.ts
import * as vscode from 'vscode';
import type { ToolDefinition, ToolInput, ToolResult } from './Tool';

export const fileEditTool: ToolDefinition = {
  name: 'Edit',
  description: 'Edit a file by replacing an exact string with a new string.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      old_string: { type: 'string', description: 'The exact string to replace (must match uniquely)' },
      new_string: { type: 'string', description: 'The replacement string' },
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
        return { type: 'tool_result', tool_use_id: '', content: 'Error: old_string not found in file', is_error: true };
      }
      if (count > 1) {
        return { type: 'tool_result', tool_use_id: '', content: `Error: old_string found ${count} times, must be unique`, is_error: true };
      }

      const startIndex = text.indexOf(oldString);
      const startPos = doc.positionAt(startIndex);
      const endPos = doc.positionAt(startIndex + oldString.length);
      const range = new vscode.Range(startPos, endPos);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, newString);
      await vscode.workspace.applyEdit(edit);

      return { type: 'tool_result', tool_use_id: '', content: 'Edit applied successfully.' };
    } catch (err: any) {
      return { type: 'tool_result', tool_use_id: '', content: `Error: ${err.message}`, is_error: true };
    }
  },
};
```

### 6.4 工具注册表

```typescript
// src/tools/registry.ts
import type { ToolDefinition } from './Tool';
import { bashTool } from './bashTool';
import { fileReadTool } from './fileReadTool';
import { fileEditTool } from './fileEditTool';
import { fileWriteTool } from './fileWriteTool';
import { globTool } from './globTool';
import { grepTool } from './grepTool';

const ALL_TOOLS: ToolDefinition[] = [
  bashTool,
  fileReadTool,
  fileEditTool,
  fileWriteTool,
  globTool,
  grepTool,
];

export function getTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

export function findToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}
```

---

## Phase 7: 提示词系统与查询引擎迁移

### 7.1 系统提示词精简

原始 `constants/prompts.ts` 极其庞大，包含大量 Anthropic 特定内容。精简策略：

**保留的关键内容**：
1. 代码风格指导（不要过度工程、不要添加不必要的注释）
2. 工具使用指导（优先使用专用工具而非 bash）
3. 安全性指导（OWASP Top 10、输入验证）
4. 行动执行指导（可逆性、确认敏感操作）
5. **虚假声明缓解**（原内部专属，建议保留）
6. **彻底性平衡**（原内部专属，建议保留）

**移除的内容**：
1. 所有 `process.env.USER_TYPE === 'ant'` 条件（取有用分支）
2. 卧底模式指令
3. Anthropic 特定反馈通道（/issue、/share、#claude-code-feedback）
4. 模型代号相关内容（Capybara、Tengu、Numbat）
5. Feature flag 相关内容

```typescript
// src/core/prompts.ts
import { getTools } from '../tools/registry';

export function buildSystemPrompt(cwd: string): string {
  const tools = getTools();
  const toolNames = tools.map(t => t.name);

  return `You are an expert AI programming assistant integrated into VSCode.

# Environment
- Working directory: ${cwd}
- Available tools: ${toolNames.join(', ')}

# Doing tasks
- The user will primarily request software engineering tasks: solving bugs, adding features, refactoring, explaining code.
- You are highly capable and can complete ambitious tasks.
- Read files before modifying them. Understand existing code before suggesting modifications.
- Do not create files unless absolutely necessary. Prefer editing existing files.
- Break down complex tasks and use the task tracking tools when helpful.

# Code style
- Don't add features or refactor beyond what was asked. A bug fix doesn't need surrounding code cleaned up.
- Don't add error handling for scenarios that can't happen. Only validate at system boundaries.
- Don't create helpers or abstractions for one-time operations.
- Default to writing no comments. Only add one when the WHY is non-obvious.
- Before reporting a task complete, verify it actually works: run the test, execute the script, check the output.

# Accuracy
- Report outcomes faithfully: if tests fail, say so. If you didn't verify, say that.
- Never claim "all tests pass" when output shows failures.
- Never suppress or simplify failing checks to manufacture a green result.

# Using tools
- To read files use Read instead of cat/head/tail
- To edit files use Edit instead of sed/awk
- To create files use Write instead of cat with heredoc
- To search files use Glob instead of find
- To search content use Grep instead of grep/rg
- Prefer dedicated tools over bash commands for file operations

# Safety
- Consider the reversibility and blast radius of actions.
- Freely take local, reversible actions (editing files, running tests).
- For hard-to-reverse or shared-system actions, check with the user first.
- Be careful not to introduce security vulnerabilities (OWASP Top 10).
- Do not use destructive actions as shortcuts.
`;
}
```

### 7.2 查询引擎精简

从原始 `query.ts`（785KB）和 `QueryEngine.ts` 中提取核心循环逻辑：

```typescript
// src/core/queryEngine.ts
import type { LLMClient, LLMStreamEvent, LLMContentBlock, LLMRequestParams } from '../api/types';
import type { ToolDefinition, ToolResult } from '../tools/Tool';
import { getTools, findToolByName } from '../tools/registry';
import { buildSystemPrompt } from './prompts';
import * as vscode from 'vscode';

interface Message {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
}

export interface QueryEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'done' | 'error';
  text?: string;
  name?: string;
  input?: any;
  result?: string;
  thinking?: string;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export class QueryEngine {
  private messages: Message[] = [];
  private totalUsage = { input_tokens: 0, output_tokens: 0 };

  constructor(
    private client: LLMClient,
    private model: string,
    private maxTokens: number,
    private thinking?: { type: 'enabled'; budget_tokens: number },
  ) {}

  async *run(userMessage: string): AsyncGenerator<QueryEvent> {
    this.messages.push({ role: 'user', content: userMessage });

    const tools = getTools();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const systemPrompt = buildSystemPrompt(cwd);

    // 代理循环：工具调用 → 结果 → 继续，直到无工具调用
    const MAX_ITERATIONS = 20;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const params: LLMRequestParams = {
        model: this.model,
        messages: this.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        system: systemPrompt,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        max_tokens: this.maxTokens,
        stream: true,
        ...(this.thinking ? { thinking: this.thinking } : {}),
      };

      // 收集本次响应
      const contentBlocks: LLMContentBlock[] = [];
      let currentText = '';
      let toolCalls: Array<{ id: string; name: string; input: any }> = [];

      try {
        for await (const event of this.client.createStream(params)) {
          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text' || event.delta?.text) {
              const text = event.delta.text || '';
              currentText += text;
              yield { type: 'text', text };
            }
            if (event.delta?.thinking) {
              yield { type: 'thinking', thinking: event.delta.thinking };
            }
          } else if (event.type === 'content_block_stop' && event.content_block) {
            contentBlocks.push(event.content_block);
            if (event.content_block.type === 'tool_use') {
              toolCalls.push({
                id: event.content_block.id!,
                name: event.content_block.name!,
                input: event.content_block.input,
              });
              yield {
                type: 'tool_use',
                name: event.content_block.name,
                input: event.content_block.input,
              };
            }
          } else if (event.type === 'message_stop' || event.type === 'message_delta') {
            if (event.usage) {
              this.totalUsage.input_tokens += event.usage.input_tokens;
              this.totalUsage.output_tokens += event.usage.output_tokens;
            }
          }
        }
      } catch (error: any) {
        yield { type: 'error', error: error.message };
        return;
      }

      // 保存 assistant 消息
      if (currentText && toolCalls.length === 0) {
        contentBlocks.push({ type: 'text', text: currentText });
      }
      this.messages.push({ role: 'assistant', content: contentBlocks.length > 0 ? contentBlocks : currentText });

      // 如果没有工具调用，结束
      if (toolCalls.length === 0) {
        yield { type: 'done', usage: this.totalUsage };
        return;
      }

      // 执行工具调用
      const toolResults: LLMContentBlock[] = [];
      for (const tc of toolCalls) {
        const tool = findToolByName(tc.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `Error: Unknown tool "${tc.name}"`,
          });
          yield { type: 'tool_result', name: tc.name, result: `Error: Unknown tool "${tc.name}"` };
          continue;
        }

        const result = await tool.execute(tc.input);
        result.tool_use_id = tc.id;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result.content,
        });
        yield { type: 'tool_result', name: tc.name, result: result.content };
      }

      // 将工具结果作为 user 消息添加
      this.messages.push({ role: 'user', content: toolResults });
    }

    yield { type: 'error', error: 'Max iterations reached' };
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getTotalUsage() {
    return { ...this.totalUsage };
  }
}

// 便捷工厂
export async function createQueryEngine(): Promise<QueryEngine> {
  const { createLLMClient } = await import('../api/clientFactory');
  const config = vscode.workspace.getConfiguration('claudeCode');
  const client = await createLLMClient();
  const model = config.get<string>('model', 'claude-sonnet-4-20250514');
  const maxTokens = config.get<number>('maxTokens', 16384);
  const thinkingEnabled = config.get<boolean>('thinkingEnabled', true);
  const thinkingBudget = config.get<number>('thinkingBudget', 10000);

  return new QueryEngine(
    client,
    model,
    maxTokens,
    thinkingEnabled ? { type: 'enabled', budget_tokens: thinkingBudget } : undefined,
  );
}
```

### 7.3 原始 query.ts 核心逻辑对照

原始 `query.ts` 的核心循环（精简版结构）：

```typescript
// 原始 query.ts 核心逻辑（简化）
export async function* query(params) {
  // 1. 组装系统提示词
  const systemPrompt = await fetchSystemPromptParts(tools, model, ...);
  
  // 2. 主循环
  while (true) {
    // 3. 调用 API
    const stream = await claudeAPICall(client, messages, systemPrompt, tools, ...);
    
    // 4. 处理流式响应
    for await (const event of stream) {
      yield event; // 转发给 UI
    }
    
    // 5. 检查是否有工具调用
    if (toolCalls.length === 0) break;
    
    // 6. 并行执行工具
    const results = await StreamingToolExecutor.execute(toolCalls);
    
    // 7. 工具结果加入消息
    messages.push({ role: 'user', content: results });
    
    // 8. 自动压缩（上下文太长时）
    if (shouldAutoCompact(messages)) {
      messages = await autoCompact(messages);
    }
  }
}
```

上面 Phase 7.2 的 `QueryEngine` 已覆盖此核心逻辑。

---

## Phase 8: 打包、测试与发布

### 8.1 构建配置

```javascript
// esbuild.config.js
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
}).catch(() => process.exit(1));
```

### 8.2 测试清单

| 测试项 | 验证内容 |
|--------|----------|
| **API 连接** | Anthropic API Key → 成功调用 |
| **API 连接** | OpenAI API Key + Base URL → 成功调用 |
| **API 连接** | 自定义 Base URL（兼容接口）→ 成功调用 |
| **工具执行** | FileRead → 读取工作区文件 |
| **工具执行** | FileEdit → 编辑文件并显示 diff |
| **工具执行** | FileWrite → 创建新文件 |
| **工具执行** | Bash → 在工作区目录执行命令 |
| **工具执行** | Glob → 搜索文件 |
| **工具执行** | Grep → 搜索文件内容 |
| **流式输出** | 文本逐字流式显示 |
| **流式输出** | 工具调用实时显示 |
| **流式输出** | Thinking 内容显示 |
| **代理循环** | 多轮工具调用 → 正确循环 |
| **错误处理** | API Key 缺失 → 友好提示 |
| **错误处理** | 网络超时 → 重试/提示 |
| **安全性** | API Key 使用 SecretStorage 存储 |

### 8.3 发布

```bash
# 安装 vsce
npm install -g @vscode/vsce

# 打包
vsce package

# 发布到 VSCode Marketplace（需要 Personal Access Token）
vsce publish
```

---

## 附录 A: 原始文件改造映射表

| 原始文件 | 改造策略 | 新文件 |
|----------|----------|--------|
| `entrypoints/cli.tsx` | **替换** | `extension.ts` |
| `main.tsx` | **精简迁移** | `extension.ts` + `ui/chatPanel.ts` |
| `query.ts` | **精简迁移** | `core/queryEngine.ts` |
| `QueryEngine.ts` | **精简迁移** | `core/queryEngine.ts` |
| `Tool.ts` | **精简迁移** | `tools/Tool.ts` |
| `tools.ts` | **精简迁移** | `tools/registry.ts` |
| `tools/BashTool/` | **改造** | `tools/bashTool.ts` |
| `tools/FileReadTool/` | **改造** | `tools/fileReadTool.ts` |
| `tools/FileEditTool/` | **改造** | `tools/fileEditTool.ts` |
| `tools/FileWriteTool/` | **改造** | `tools/fileWriteTool.ts` |
| `tools/GlobTool/` | **改造** | `tools/globTool.ts` |
| `tools/GrepTool/` | **改造** | `tools/grepTool.ts` |
| `tools/AgentTool/` | **改造** | `tools/agentTool.ts` |
| `services/api/client.ts` | **替换** | `api/clientFactory.ts` |
| `services/api/claude.ts` | **替换** | `api/anthropicClient.ts` |
| `utils/model/providers.ts` | **替换** | `api/clientFactory.ts` |
| `utils/model/model.ts` | **精简** | `config/settings.ts` |
| `constants/prompts.ts` | **精简** | `core/prompts.ts` |
| `ink.ts` | **移除** | — |
| `replLauncher.tsx` | **移除** | — |
| `components/` | **移除** | `ui/chatPanel.ts` |
| `services/analytics/` | **移除** | `stubs/analytics.ts` |
| `services/remoteManagedSettings/` | **移除** | `stubs/remoteManagedSettings.ts` |
| `utils/undercover.ts` | **移除** | `stubs/undercover.ts` |
| `commands.ts` + `commands/` | **部分迁移** | VSCode commands |

---

## 附录 B: 环境变量改造映射

| 原始环境变量 | 原始用途 | 改造策略 |
|-------------|----------|----------|
| `ANTHROPIC_API_KEY` | API 密钥 | → VSCode SecretStorage |
| `ANTHROPIC_MODEL` | 模型名 | → `claudeCode.model` 设置项 |
| `ANTHROPIC_BASE_URL` | 自定义 API URL | → `claudeCode.baseUrl` 设置项 |
| `CLAUDE_CODE_USE_BEDROCK` | Bedrock 模式 | → `claudeCode.apiProvider` 设置项 |
| `CLAUDE_CODE_USE_VERTEX` | Vertex 模式 | → `claudeCode.apiProvider` 设置项 |
| `CLAUDE_CODE_USE_FOUNDRY` | Foundry 模式 | → `claudeCode.apiProvider` 设置项 |
| `USER_TYPE` | 内部/外部用户 | → 硬编码 `'external'` |
| `API_TIMEOUT_MS` | API 超时 | → 硬编码或设置项 |
| `CLAUDE_CODE_UNDERCOVER` | 卧底模式 | → **移除** |
| `OTEL_LOG_TOOL_DETAILS` | 遥测详细日志 | → **移除** |
| `CLAUDE_CODE_REMOTE` | 远程模式 | → **移除** |

---

## 附录 C: 建议的执行顺序（给 AI Agent）

```
1. 执行 Phase 1: 创建项目脚手架
   - 创建目录结构
   - 写 package.json, tsconfig.json
   - npm install

2. 执行 Phase 4: 实现 API 客户端抽象层
   - 创建 src/api/types.ts
   - 创建 src/api/anthropicClient.ts
   - 创建 src/api/openaiClient.ts
   - 创建 src/api/clientFactory.ts
   - 单元测试验证 API 调用

3. 执行 Phase 6: 实现核心工具
   - 创建 src/tools/Tool.ts
   - 实现 P0 工具: Bash, FileRead, FileEdit, FileWrite
   - 实现 P1 工具: Glob, Grep
   - 创建 src/tools/registry.ts

4. 执行 Phase 7: 实现查询引擎
   - 创建 src/core/prompts.ts
   - 创建 src/core/queryEngine.ts
   - 验证代理循环: 用户消息 → 工具调用 → 继续

5. 执行 Phase 5: 实现 VSCode UI
   - 创建 src/extension.ts
   - 创建 src/ui/chatPanel.ts
   - 验证 Webview 渲染和消息传递

6. 执行 Phase 8: 打包和测试
   - 配置 esbuild
   - 运行完整测试
   - vsce package
```

---

## 附录 D: 常见问题

### Q: 使用 OpenAI API 时工具调用格式不同怎么办？
A: Phase 4.4 的 `OpenAICompatibleLLMClient` 已处理格式转换。Anthropic 使用 `tool_use` / `tool_result` 内容块，OpenAI 使用 `tool_calls` / `tool` 消息。客户端内部做双向映射。

### Q: 如何支持 DeepSeek/Qwen/GLM 等国内模型？
A: 这些模型均兼容 OpenAI Chat Completions API。选择 `openai-compatible` provider，填入对应 Base URL：
- DeepSeek: `https://api.deepseek.com`
- Qwen (通义千问): `https://dashscope.aliyuncs.com/compatible-mode/v1`
- GLM (智谱): `https://open.bigmodel.cn/api/paas/v4`

### Q: 如何处理不支持工具调用的模型？
A: 对不支持 function calling 的模型（如部分开源模型），可在 `openaiClient.ts` 中增加 prompt-based tool calling 降级策略：在系统提示词中描述工具格式，解析模型输出中的 JSON 工具调用。

### Q: 原始代码中 108 个缺失模块怎么处理？
A: 完全忽略。这些是 Anthropic 内部模块（KAIROS、DAEMON、COORDINATOR 等），从未发布到 npm，feature gate 返回 false 后对应代码路径不会执行。

### Q: Thinking (Extended Thinking) 功能是否保留？
A: 保留。Anthropic API 原生支持 `thinking` 参数。OpenAI API 不支持此功能，`openaiClient.ts` 会忽略 thinking 配置。用户可在设置中开关。
