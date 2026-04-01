# Claude Code VSCode Extension

基于 Claude Code 源码改造的 VSCode 插件，支持连接自定义大模型 API Key。

## 功能特性

- ✅ 支持 Anthropic Claude API
- ✅ 支持 OpenAI API
- ✅ 支持 OpenAI 兼容 API（DeepSeek、Qwen、GLM 等）
- ✅ 工具调用：Bash、FileRead、FileEdit、FileWrite、Glob、Grep
- ✅ 流式输出
- ✅ Extended Thinking（Anthropic）
- ✅ API Key 安全存储（VSCode SecretStorage）

## 安装

1. 安装依赖：
```bash
npm install
```

2. 构建插件：
```bash
npm run build
```

3. 在 VSCode 中按 F5 启动调试，或打包发布：
```bash
vsce package
```

## 配置

### 设置 API Key

使用命令面板（Ctrl+Shift+P）执行 `Claude Code: Set API Key`，或直接在设置中配置。

### 选择 Provider

1. **Anthropic**: 使用 Claude API（推荐）
2. **OpenAI**: 使用 GPT-4o 等模型
3. **OpenAI-compatible**: 使用 DeepSeek、Qwen、GLM 等兼容 API

### 常用模型

| Provider | 模型名称 | Base URL |
|----------|----------|----------|
| Anthropic | claude-sonnet-4-20250514 | - |
| Anthropic | claude-opus-4-20250514 | - |
| OpenAI | gpt-4o | - |
| OpenAI | gpt-4o-mini | - |
| DeepSeek | deepseek-chat | https://api.deepseek.com |
| DeepSeek | deepseek-reasoner | https://api.deepseek.com |
| Qwen | qwen-max | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| GLM | glm-4 | https://open.bigmodel.cn/api/paas/v4 |

## 使用

1. 按 `Ctrl+Shift+A` 打开聊天面板
2. 输入问题或任务
3. Claude 会使用工具执行任务（读取文件、编辑代码、运行命令等）

## 快捷键

- `Ctrl+Shift+A`: 打开聊天
- `Ctrl+Shift+S`: 询问选中代码
- `Ctrl+Enter`: 发送消息

## 项目结构

```
claude-vs-code/
├── src/
│   ├── extension.ts          # VSCode 入口
│   ├── api/                  # API 客户端抽象层
│   │   ├── types.ts          # 统一消息类型
│   │   ├── anthropicClient.ts
│   │   ├── openaiClient.ts
│   │   └── clientFactory.ts
│   ├── core/                 # 核心引擎
│   │   ├── queryEngine.ts    # 查询引擎
│   │   └── prompts.ts        # 系统提示词
│   ├── tools/                # 工具实现
│   │   ├── Tool.ts           # 工具接口
│   │   ├── bashTool.ts
│   │   ├── fileReadTool.ts
│   │   ├── fileEditTool.ts
│   │   ├── fileWriteTool.ts
│   │   ├── globTool.ts
│   │   ├── grepTool.ts
│   │   └── registry.ts
│   ├── ui/                   # VSCode UI
│   │   └── chatPanel.ts      # Webview 聊天面板
│   ├── config/               # 配置管理
│   ├── utils/                # 工具函数
│   └── stubs/                # 移除系统的 stub
├── media/                    # 图标等资源
├── package.json              # VSCode 扩展清单
└── tsconfig.json
```

## 改造说明

本项目基于 Claude Code v2.1.88 源码改造，主要改动：

1. **移除 Bun 依赖**: 替换 `bun:bundle` 和 `feature()` 为运行时配置
2. **移除遥测系统**: 删除 analytics、remoteManagedSettings、undercover
3. **API 客户端抽象**: 支持多种 LLM API（Anthropic、OpenAI、兼容 API）
4. **UI 改造**: Ink/React 终端 UI → VSCode Webview
5. **工具对接 VSCode API**: 使用 VSCode workspace API 实现文件操作

详见 `analyse/07-vscode-extension-conversion-guide.md`。

## License

MIT