# Claude Code 项目全面分析报告

> 分析日期：2026年4月1日
> 分析版本：Claude Code v2.1.88

## 一、项目整体概况

这是一个**Claude Code源代码研究项目**，包含两个主要子项目：

| 子项目 | 语言 | 性质 | 文件数 | 代码行数 |
|--------|------|------|--------|----------|
| `claude-code-source-code` | TypeScript | 反编译源码存档 (v2.1.88) | 1,884文件 | ~163,318行 |
| `claw-code` | Python | 清洁室架构重写 | 66文件 | 研究性实现 |

---

## 二、claude-code-source-code 核心架构分析

### 1. 执行流程架构

```text
用户输入 → processUserInput() → query()主循环 → SDKMessage流式输出
           ↓
    解析斜杠命令
           ↓
    fetchSystemPromptParts() → 组装系统提示词
           ↓
    StreamingToolExecutor → 并行工具执行
           ↓
    autoCompact() → 自动上下文压缩
           ↓
    runTools() → 工具编排调度
```

### 2. 核心模块结构

| 模块 | 文件 | 功能 | 关键特性 |
|------|------|------|----------|
| **入口层** | `main.tsx` (4,683行) | CLI启动、REPL引导 | 启动性能优化、MDM预读、密钥预取 |
| **查询引擎** | `query.ts` (785KB) | 主代理循环 | 最大单文件、核心AI交互逻辑 |
| **工具系统** | `Tool.ts` + `tools/` | 40+工具实现 | 权限控制、并行执行、进度追踪 |
| **命令系统** | `commands.ts` + `commands/` | ~87斜杠命令 | 用户交互、模式切换 |
| **服务层** | `services/` (22子目录) | 业务逻辑 | API、遥测、MCP、压缩、语音 |
| **组件层** | `components/` (33子目录) | React/Ink终端UI | 交互式界面、状态管理 |

### 3. 关键发现

**🔍 遥测与隐私**
- 双层分析管道：Anthropic 1P + Datadog 3P
- 环境指纹、进程指标、用户追踪、仓库哈希
- **无法完全退出** 1P日志记录
- `OTEL_LOG_TOOL_DETAILS=1` 可记录完整工具输入

**🎭 隐藏功能与代号**
- 动物代号系统：**Capybara** (Sonnet v8)、**Tengu** (遥测前缀)、**Fennec** (Opus 4.6前身)、**Numbat** (下一个模型)
- Feature flags使用随机词对混淆：`tengu_onyx_plover`、`tengu_coral_fern`
- 内部用户获得更好的提示词、验证代理、努力锚点
- 隐藏命令：`/btw`、`/stickers`

**🕵️ 卧底模式**
- Anthropic员工在公共仓库自动进入卧底模式
- 模型指令："不要暴露身份" — 剥离所有AI归属
- **无法强制关闭**，引发开源社区透明度问题

**📡 远程控制**
- 每小时轮询 `/api/claude_code/settings`
- 危险变更显示阻塞对话框 — **拒绝=应用退出**
- 6+紧急开关（绕过权限、快速模式、语音模式、分析接收器）
- GrowthBook flags可无同意更改任何用户行为

**🚀 未来路线图**
- **Numbat** 代号确认，Opus 4.7 / Sonnet 4.8开发中
- **KAIROS** = 完全自主代理模式，带 `<tick>` 心跳、推送通知、PR订阅
- 语音模式（按键说话）已就绪但被限制
- 17个未发布工具被发现

---

## 三、claw-code Python重写分析

### 1. 重写动机
- 2026年3月31日凌晨4点Claude Code源码泄露事件响应
- 作者Sigrid Jin（华尔街日报报道的Claude Code重度用户）
- 使用 oh-my-codex (OmX) 工作流编排完成清洁室重写
- **Rust移植正在进行**（`dev/rust`分支）

### 2. Python架构映射

| Python模块 | 对应TS模块 | 功能 |
|------------|------------|------|
| `main.py` | `main.tsx` | CLI入口点 |
| `query_engine.py` | `query.ts` | 查询引擎移植层 |
| `commands.py` | `commands.ts` | 命令元数据 |
| `tools.py` | `tools.ts` | 工具元数据 |
| `port_manifest.py` | - | 工作空间清单生成 |
| `models.py` | - | 共享数据类 |
| `task.py` | `Task.ts` | 任务级规划结构 |

### 3. 当前状态
- Python工作空间已建立基础框架
- **不是完整的1:1替换**，而是架构模式捕获
- 正在与OmX创建者@bellman_ych合作推进
- 测试框架已就绪验证Python工作空间

---

## 四、技术亮点分析

### 1. 12层渐进式Harness机制
从源码分析发现的Claude Code生产特性分层：

1. **启动优化**：MDM预读、密钥预取（并行启动）
2. **上下文管理**：自动压缩、微压缩边界
3. **工具编排**：并行执行、权限流、子代理
4. **遥测系统**：双层管道、事件批处理
5. **远程控制**：托管设置、紧急开关
6. **卧底模式**：AI身份隐藏
7. **Feature Flags**：GrowthBook动态控制
8. **多代理协调**：COORDINATOR_MODE
9. **语音模式**：按键说话（已就绪）
10. **KAIROS**：自主代理心跳
11. **记忆系统**：memdir长期记忆
12. **插件系统**：MCP集成、技能加载

### 2. 缺失模块（108个）
npm包中不存在的内部Anthropic基础设施：

- `daemon/` - 后台守护进程
- `proactive/` - 主动通知系统
- `contextCollapse/` - 上下文折叠服务
- `skillSearch/` - 远程技能搜索
- `coordinator/` - 多代理协调器
- `assistant/` - KAIROS助手模式
- `compact/` - 高级压缩策略
- 等等...

---

## 五、项目价值与意义

### 1. 研究价值
- **Harness工程**：理解代理系统如何连接工具、编排任务、管理运行时上下文
- **架构模式**：学习生产级AI CLI工具的设计模式
- **隐私分析**：揭示商业AI工具的遥测实践
- **未来预测**：通过源码推断产品路线图

### 2. 法律与伦理
- 源码存档声明：仅供技术研究、教育交流
- **商业使用严格禁止**
- Python重写采用清洁室方法避免版权问题
- 作者已发表相关伦理讨论文章

### 3. 社区影响
- Hacker News社区热议
- 多篇中文深度分析文章发布
- YouTube视频分析
- PDF研究报告发布

---

## 六、总结

这是一个**极具技术深度**的研究项目，揭示了：

✅ **Claude Code的完整架构**：从入口到工具系统的完整执行流程  
✅ **隐藏的商业实践**：遥测、远程控制、卧底模式  
✅ **未来产品路线**：Numbat模型、KAIROS自主代理  
✅ **清洁室重写尝试**：Python/Rust架构移植  

项目对理解现代AI CLI工具的内部机制、隐私实践、架构模式具有**重要参考价值**，同时引发了关于AI工具透明度、用户控制权、开源伦理的深刻讨论。