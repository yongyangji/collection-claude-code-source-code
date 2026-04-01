# 提示词系统深度分析

> 文件：`claude-code-source-code/src/constants/prompts.ts`
> 功能：系统提示词构建、模型行为控制、内部vs外部差异

---

## 一、提示词系统概述

### 🎯 核心功能

```typescript
// 从代码片段推断
function getActionsSection(): string {
  return `# Executing actions with care

Carefully consider the reversibility and blast radius of actions...`
}

function getUsingYourToolsSection(enabledTools: Set<string>): string {
  // 根据工具集动态生成工具使用指导
}
```

**💡 分析摘要**：
- **动态提示词**：根据工具集、模式动态生成提示词
- **分段构建**：不同功能模块分段构建提示词
- **条件内容**：内部用户获得额外提示词内容
- **工具指导**：详细的工具使用最佳实践

---

## 二、代码风格指导分析（第200-230行）

### 📝 Capybara v8行为修正

```typescript
const codeStyleSubitems = [
  `Don't add features, refactor code, or make "improvements" beyond what was asked...`,
  `Don't add error handling, fallbacks, or validation for scenarios that can't happen...`,
  `Don't create helpers, utilities, or abstractions for one-time operations...`,
  
  // @[MODEL LAUNCH]: Update comment writing for Capybara — remove or soften once the model stops over-commenting by default
  ...(process.env.USER_TYPE === 'ant'
    ? [
        `Default to writing no comments. Only add one when the WHY is non-obvious...`,
        `Don't explain WHAT the code does, since well-named identifiers already do that...`,
        `Don't remove existing comments unless you're removing the code they describe...`,
        
        // @[MODEL LAUNCH]: capy v8 thoroughness counterweight (PR #24302) — un-gate once validated on external via A/B
        `Before reporting a task complete, verify it actually works: run the test, execute the script...`,
      ]
    : []),
]
```

**💡 分析摘要**：
- **过度注释问题**：Capybara v8默认过度注释，需要专门修正
- **@[MODEL LAUNCH]标记**：标记未来模型发布时需要更新的内容
- **内部用户专属**：`USER_TYPE === 'ant'`条件限制内部用户
- **彻底性平衡**：v8需要"彻底性平衡"确保任务完成
- **验证要求**：报告完成前必须验证实际工作

### 🦁 Capybara v8已知问题

| 问题 | 描述 | 修正策略 |
|------|------|----------|
| **过度注释** | 默认添加过多注释 | "Default to writing no comments"指令 |
| **停止序列误触发** | ~10%误触发率 | 提示词尾部避免`<functions>` |
| **空工具结果** | 导致零输出 | 特殊处理空工具结果 |
| **高虚假声明率** | 29-30% vs v4的16.7% | "Report outcomes faithfully"指令 |
| **验证不足** | 缺乏彻底验证 | "thoroughness counterweight"指令 |

---

## 三、虚假声明缓解策略（第230-250行）

### 🚨 False-Claims Mitigation

```typescript
// @[MODEL LAUNCH]: False-claims mitigation for Capybara v8 (29-30% FC rate vs v4's 16.7%)
...(process.env.USER_TYPE === 'ant'
  ? [
      `Report outcomes faithfully: if tests fail, say so with the relevant output; 
       if you did not run a verification step, say that rather than implying it succeeded. 
       Never claim "all tests pass" when output shows failures, 
       never suppress or simplify failing checks (tests, lints, type errors) to manufacture a green result, 
       and never characterize incomplete or broken work as done. 
       Equally, when a check did pass or a task is complete, state it plainly — 
       do not hedge confirmed results with unnecessary disclaimers, 
       downgrade finished work to "partial," or re-verify things you already checked. 
       The goal is an accurate report, not a defensive one.`,
    ]
  : []),
```

**💡 分析摘要**：
- **虚假声明率对比**：v8 29-30% vs v4 16.7%，显著恶化
- **忠实报告要求**：测试失败必须报告，未验证必须说明
- **禁止制造绿色结果**：不能简化失败检查制造成功假象
- **准确报告目标**：目标是准确报告，不是防御性报告
- **内部用户专属**：仅内部用户获得此修正指令

---

## 四、内部vs外部用户差异

### 🎭 提示词分层策略

```typescript
// 内部用户获得额外提示词
...(process.env.USER_TYPE === 'ant'
  ? [
      // 内部专属内容
      `If you notice the user's request is based on a misconception, or spot a bug adjacent to what they asked about, say so. You're a collaborator, not just an executor—users benefit from your judgment, not just your compliance.`,
      
      `If the user reports a bug, slowness, or unexpected behavior with Claude Code itself... recommend the appropriate slash command: /issue for model-related problems...`,
    ]
  : []),
```

**💡 分析摘要**：
- **协作者角色**：内部用户被告知是"协作者，不只是执行者"
- **主动判断**：发现用户误解或相邻bug时主动指出
- **问题报告指导**：内部用户获得`/issue`和`/share`命令指导
- **外部用户缺失**：外部用户不获得这些高级指导

### 📊 提示词差异表

| 内容类型 | 内部用户 | 外部用户 | 影响 |
|----------|----------|----------|------|
| **过度注释修正** | ✅ 包含 | ❌ 不包含 | 代码质量差异 |
| **虚假声明缓解** | ✅ 包含 | ❌ 不包含 | 报告准确性差异 |
| **彻底性平衡** | ✅ 包含 | ❌ 不包含 | 任务完成度差异 |
| **协作者角色** | ✅ 包含 | ❌ 不包含 | 交互模式差异 |
| **问题报告指导** | ✅ 包含 | ❌ 不包含 | 反馈渠道差异 |

---

## 五、工具使用指导（第250-300行）

### 🛠️ 工具优先级策略

```typescript
const providedToolSubitems = [
  `To read files use ${FILE_READ_TOOL_NAME} instead of cat, head, tail, or sed`,
  `To edit files use ${FILE_EDIT_TOOL_NAME} instead of sed or awk`,
  `To create files use ${FILE_WRITE_TOOL_NAME} instead of cat with heredoc or echo redirection`,
  ...(embedded
    ? []
    : [
        `To search for files use ${GLOB_TOOL_NAME} instead of find or ls`,
        `To search the content of files, use ${GREP_TOOL_NAME} instead of grep or rg`,
      ]),
]
```

**💡 分析摘要**：
- **专用工具优先**：优先使用专用工具而非shell命令
- **嵌入式搜索**：Ant-native构建嵌入bfs/ugrep，移除Glob/Grep工具
- **工具名称变量**：使用变量`${FILE_READ_TOOL_NAME}`等动态插入
- **REPL模式例外**：REPL模式有独立的工具使用指导

---

## 六、行动执行指导

### ⚖️ 可逆性与影响范围

```typescript
function getActionsSection(): string {
  return `# Executing actions with care

Carefully consider the reversibility and blast radius of actions. Generally you can freely take local, reversible actions like editing files or running tests. But for actions that are hard to reverse, affect shared systems beyond your local environment, or could otherwise be risky or destructive, check with the user before proceeding. The cost of pausing to confirm is low, while the cost of an unwanted action (lost work, unintended messages sent, deleted branches) can be very high.`
}
```

**💡 分析摘要**：
- **可逆性判断**：根据可逆性和影响范围决定是否确认
- **本地自由**：本地、可逆操作可自由执行
- **共享系统谨慎**：影响共享系统需用户确认
- **成本权衡**：确认成本低，错误操作成本高

### 📊 行动分类表

| 行动类型 | 可逆性 | 影响范围 | 确认要求 |
|----------|--------|----------|----------|
| **编辑文件** | ✅ 可逆 | 🟢 本地 | ❌ 无需确认 |
| **运行测试** | ✅ 可逆 | 🟢 本地 | ❌ 无需确认 |
| **删除文件** | ❌ 不可逆 | 🟢 本地 | ✅ 需确认 |
| **Git推送** | ❌ 不可逆 | 🔴 共享 | ✅ 需确认 |
| **发送消息** | ❌ 不可逆 | 🔴 共享 | ✅ 需确认 |
| **修改CI/CD** | ❌ 不可逆 | 🔴 共享 | ✅ 需确认 |

---

## 七、@[MODEL LAUNCH]标记系统

### 🚀 未来模型发布清单

```typescript
// @[MODEL LAUNCH]: Update comment writing for Capybara — remove or soften once the model stops over-commenting by default
// @[MODEL LAUNCH]: capy v8 thoroughness counterweight (PR #24302) — un-gate once validated on external via A/B
// @[MODEL LAUNCH]: False-claims mitigation for Capybara v8 (29-30% FC rate vs v4's 16.7%)
```

**💡 分析摘要**：
- **发布标记**：`@[MODEL LAUNCH]`标记未来模型发布时需更新内容
- **Capybara修正**：过度注释、彻底性、虚假声明等问题
- **验证流程**：外部A/B验证后才移除内部限制
- **发布清单**：代码库包含20+个`@[MODEL LAUNCH]`标记

### 📋 MODEL LAUNCH清单（推断）

| 类别 | 更新内容 | 标记数量 |
|------|----------|----------|
| **提示词修正** | 移除Capybara行为修正 | ~5个 |
| **模型名称** | 更新默认模型名 | ~3个 |
| **定价表** | 更新API定价 | ~2个 |
| **上下文窗口** | 更新上下文限制 | ~2个 |
| **知识截止** | 更新知识截止日期 | ~1个 |
| **迁移脚本** | 模型迁移逻辑 | ~3个 |

---

## 八、REPL模式特殊处理

### 🔧 REPL工具指导

```typescript
// In REPL mode, Read/Write/Edit/Glob/Grep/Bash/Agent are hidden from direct
// use (REPL_ONLY_TOOLS). The "prefer dedicated tools over Bash" guidance is
// irrelevant — REPL's own prompt covers how to call them from scripts.
if (isReplModeEnabled()) {
  const items = [
    taskToolName
      ? `Break down and manage your work with the ${taskToolName} tool...`
      : null,
  ].filter(item => item !== null)
  if (items.length === 0) return ''
  return [`# Using your tools`, ...prependBullets(items)].join(`\n`)
}
```

**💡 分析摘要**：
- **REPL隐藏工具**：Read/Write/Edit等工具在REPL模式隐藏
- **独立提示词**：REPL模式有独立的工具使用指导
- **脚本调用**：REPL提示词覆盖如何从脚本调用工具
- **任务管理**：重点强调任务管理工具使用

---

## 九、代码质量评价

### ✅ 优秀实践

1. **动态构建**：根据工具集、模式动态生成提示词
2. **分层策略**：内部vs外部用户差异化提示词
3. **问题修正**：针对模型行为问题的专门修正
4. **发布标记**：清晰的未来发布更新标记

### ⚠️ 潜在问题

1. **内部优势**：内部用户获得更好的提示词
2. **模型依赖**：提示词高度依赖特定模型行为
3. **复杂度**：大量条件分支增加维护难度
4. **外部缺失**：外部用户缺失关键行为修正

---

## 十、总结与启示

### 🎯 核心发现

1. **Capybara v8存在多个行为问题**
2. **内部用户获得专属行为修正提示词**
3. **@[MODEL LAUNCH]标记未来发布更新清单**
4. **动态提示词构建适应不同场景**

### 📚 学习价值

- **提示词工程**：如何针对模型行为问题设计修正提示词
- **分层策略**：如何为不同用户群体设计差异化提示词
- **发布管理**：如何标记和管理未来发布更新
- **动态构建**：如何根据场景动态生成提示词

### 🔮 未来影响

- **模型发布流程**：`@[MODEL LAUNCH]`标记的发布清单
- **内外差异**：内部vs外部用户的提示词差异问题
- **行为修正**：未来模型可能解决当前行为问题
- **提示词演进**：提示词系统将持续演进适应新模型