# Undercover Mode 卧底模式深度分析

> 文件：`claude-code-source-code/src/utils/undercover.ts`
> 功能：Anthropic员工在公共仓库中隐藏AI身份

---

## 一、卧底模式概述

### 🎭 核心概念

```typescript
/**
 * Undercover mode — safety utilities for contributing to public/open-source repos.
 *
 * When active, Claude Code adds safety instructions to commit/PR prompts and
 * strips all attribution to avoid leaking internal model codenames, project
 * names, or other Anthropic-internal information. The model is not told what
 * model it is.
 */
```

**💡 分析摘要**：
- **目的**：防止泄露Anthropic内部信息（模型代号、项目名等）
- **机制**：在提交/PR提示词中添加安全指令，剥离所有AI归属
- **模型欺骗**：模型不知道自己是什么模型
- **适用场景**：公共/开源仓库贡献

---

## 二、激活机制分析（第20-35行）

### 🔐 激活条件

```typescript
export function isUndercover(): boolean {
  if (process.env.USER_TYPE === 'ant') {
    if (isEnvTruthy(process.env.CLAUDE_CODE_UNDERCOVER)) return true
    // Auto: active unless we've positively confirmed we're in an allowlisted
    // internal repo. 'external', 'none', and null (check not yet run) all
    // resolve to ON. The check is primed in setup.ts; only 'internal' → OFF.
    return getRepoClassCached() !== 'internal'
  }
  return false
}
```

**💡 分析摘要**：
- **用户类型检查**：仅对Anthropic员工（`USER_TYPE === 'ant'`）生效
- **强制激活**：`CLAUDE_CODE_UNDERCOVER=1`环境变量强制开启
- **自动检测**：默认开启，除非确认在内部仓库白名单中
- **安全默认**：'external'、'none'、null都触发开启，只有'internal'才关闭
- **无法强制关闭**：注释明确说明"There is NO force-OFF"

### 📊 激活逻辑表

| 条件 | USER_TYPE | CLAUDE_CODE_UNDERCOVER | Repo Class | 结果 |
|------|-----------|------------------------|------------|------|
| 外部用户 | 'external' | 任意 | 任意 | ❌ 不激活 |
| Anthropic员工 | 'ant' | '1' | 任意 | ✅ 强制激活 |
| Anthropic员工 | 'ant' | 未设置 | 'internal' | ❌ 不激活 |
| Anthropic员工 | 'ant' | 未设置 | 'external' | ✅ 自动激活 |
| Anthropic员工 | 'ant' | 未设置 | 'none'/null | ✅ 自动激活 |

---

## 三、卧底指令详解（第37-70行）

### 📝 卧底指令内容

```typescript
export function getUndercoverInstructions(): string {
  if (process.env.USER_TYPE === 'ant') {
    return `## UNDERCOVER MODE — CRITICAL

You are operating UNDERCOVER in a PUBLIC/OPEN-SOURCE repository. Your commit
messages, PR titles, and PR bodies MUST NOT contain ANY Anthropic-internal
information. Do not blow your cover.

NEVER include in commit messages or PR descriptions:
- Internal model codenames (animal names like Capybara, Tengu, etc.)
- Unreleased model version numbers (e.g., opus-4-7, sonnet-4-8)
- Internal repo or project names (e.g., claude-cli-internal, anthropics/…)
- Internal tooling, Slack channels, or short links (e.g., go/cc, #claude-code-…)
- The phrase "Claude Code" or any mention that you are an AI
- Any hint of what model or version you are
- Co-Authored-By lines or any other attribution

Write commit messages as a human developer would — describe only what the code
change does.

GOOD:
- "Fix race condition in file watcher initialization"
- "Add support for custom key bindings"
- "Refactor parser for better error messages"

BAD (never write these):
- "Fix bug found while testing with Claude Capybara"
- "1-shotted by claude-opus-4-6"
- "Generated with Claude Code"
- "Co-Authored-By: Claude Opus 4.6 <…>"
`
  }
  return ''
}
```

**💡 分析摘要**：
- **明确指令**："Do not blow your cover"（不要暴露身份）
- **禁止内容清单**：
  - 模型代号（Capybara、Tengu等动物名）
  - 未发布版本号（opus-4-7、sonnet-4-8）
  - 内部项目名（claude-cli-internal、anthropics/...）
  - 内部工具/Slack频道/短链接（go/cc、#claude-code-...）
  - "Claude Code"短语或AI身份提及
  - Co-Authored-By归属行
- **人模仿真**：要求"as a human developer would"
- **正面示例**：纯技术描述，无AI痕迹
- **反面示例**：包含AI/代号/归属的提交

---

## 四、模型代号保护机制

### 🦁 动物代号系统

| 代号 | 含义 | 保护级别 |
|------|------|----------|
| **Capybara** (水豚) | Sonnet系列模型v8 | 🔴 最高 |
| **Tengu** (天狗) | 遥测/产品前缀 | 🔴 最高 |
| **Fennec** (耳廓狐) | Opus 4.6前身 | 🔴 最高 |
| **Numbat** (袋食蚁兽) | 下一个模型 | 🔴 最高 |

**💡 分析摘要**：
- **代号泄露风险**：这些代号在卧底指令中明确列出
- **构建保护**：`scripts/excluded-strings.txt`扫描构建输出
- **运行时构造**：Buddy系统使用`String.fromCharCode()`避免触发检测
- **双重身份**：capybara既是宠物种类又是模型代号，需要特殊处理

---

## 五、仓库分类机制

### 🏷️ 仓库类型判断

```typescript
// 从commitAttribution.ts导入
import { getRepoClassCached } from './commitAttribution.js'

// 仓库分类：
// - 'internal': 内部仓库白名单（INTERNAL_MODEL_REPOS）
// - 'external': 外部公共仓库
// - 'none': 无git仓库
// - null: 检查尚未运行
```

**💡 分析摘要**：
- **白名单机制**：`INTERNAL_MODEL_REPOS`定义内部仓库列表
- **缓存策略**：使用`getRepoClassCached()`避免重复检查
- **安全默认**：null/none/external都触发卧底模式
- **预检查**：在`setup.ts`中预先设置检查结果

---

## 六、用户通知机制（第72-85行）

### 🔔 自动检测通知

```typescript
export function shouldShowUndercoverAutoNotice(): boolean {
  if (process.env.USER_TYPE === 'ant') {
    // If forced via env, user already knows; don't nag.
    if (isEnvTruthy(process.env.CLAUDE_CODE_UNDERCOVER)) return false
    if (!isUndercover()) return false
    if (getGlobalConfig().hasSeenUndercoverAutoNotice) return false
    return true
  }
  return false
}
```

**💡 分析摘要**：
- **一次性通知**：用户首次自动进入卧底模式时显示解释
- **避免骚扰**：强制激活时不显示（用户已知）
- **状态记录**：`hasSeenUndercoverAutoNotice`标记已查看
- **仅限内部**：只对Anthropic员工显示

---

## 七、伦理与透明度问题

### ⚖️ 伦理争议

**🔴 关键问题**：
1. **无法强制关闭**：注释明确"There is NO force-OFF"
2. **开源社区透明度**：AI在开源项目中隐藏身份
3. **用户知情权**：外部用户不知道提交可能由AI生成
4. **归属剥离**：完全移除AI贡献的痕迹

**💡 深度分析**：
- **商业动机**：保护内部信息不泄露
- **开源影响**：可能影响开源项目的信任机制
- **法律风险**：某些开源许可证要求归属声明
- **社区反应**：可能引发对AI参与开源项目的讨论

---

## 八、技术实现亮点

### ✅ 设计优点

1. **安全默认**：默认开启，只有确认内部才关闭
2. **多层保护**：环境变量+仓库分类+构建扫描
3. **类型安全**：编译时消除外部构建中的卧底代码
4. **用户友好**：一次性通知避免骚扰

### ⚠️ 设计争议

1. **无法关闭**：缺乏用户控制权
2. **模型欺骗**：模型不知道自己的身份
3. **开源透明度**：隐藏AI参与可能违反社区期望
4. **归属问题**：可能违反某些许可证要求

---

## 九、代码质量评价

### 📊 代码质量

| 维度 | 评分 | 说明 |
|------|------|------|
| **注释质量** | ⭐⭐⭐⭐⭐ | 详细解释设计决策和限制 |
| **类型安全** | ⭐⭐⭐⭐⭐ | 编译时消除外部代码 |
| **逻辑清晰** | ⭐⭐⭐⭐⭐ | 激活条件明确易懂 |
| **伦理考量** | ⭐⭐⭐ | 存在透明度争议 |

---

## 十、总结与启示

### 🎯 核心发现

1. **卧底模式是Anthropic员工的默认行为**
2. **无法强制关闭，引发透明度争议**
3. **保护模型代号等内部信息不泄露**
4. **要求模型"像人类开发者一样"写提交**

### 📚 学习价值

- **安全默认原则**：如何设计无法绕过的安全机制
- **Feature Gate实现**：编译时消除内部功能
- **伦理考量**：AI参与开源项目的透明度问题
- **代号保护**：如何防止敏感信息泄露

### 🔮 未来影响

- **开源社区讨论**：可能引发AI参与开源项目的规范讨论
- **许可证影响**：可能需要新的AI归属条款
- **透明度要求**：未来可能要求AI工具声明身份
- **行业标准**：可能成为AI工具参与开源的标准实践