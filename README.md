# 从零搭建一个极简智能体

> 用最少的代码，亲手搭一个能"列文件 + 读文件"的智能体。先看清一个完整 Agent 由什么构成，再用分阶段实现的方式补齐骨架，最后回到拼图上。

## 设计功能目标

1. **多轮对话**：实现如Claude Code一样的多轮交流
2. **实时干预**：用户在 LLM 正在进行工具调用、中间推理或执行多步骤任务的过程中，插入指令，从而实现对 Agent 执行流的实时纠偏与引导
3. **Context管理**：在达到阈值时，自动压缩上下文，保证结果的质量
4. **Memory管理**：可持久记忆
5. **Mcp+Skills**：技能机制
 
完成以上，即可实现一个最小可运行 Harness Agent
 
---

## 运行环境

| 组件      | 版本 / 说明                                     |
| ------- | ------------------------------------------- |
| Node.js | v26.7.0                                     |
| 包管理     | npm 11.19.0，pnpm 可用                         |
| 语言      | TypeScript                                  |
| 运行器     | `tsx`，无需编译，直接执行 `.ts`                       |
| 核心框架    | `@earendil-works/pi-ai` —— 多模型 Agent 开发 SDK |

装好依赖后，`npx tsx agent/cli.ts` 一行命令即跑。`pi-ai` 把不同厂商的 API 差异封装在 provider 层，让你用同一套 `Context` 驱动不同模型；本例接的是 OpenAI 兼容接口（`openai-completions`）。

>[!info] 为加快本次开发，部分功能会直接复用 [@earendil-works/pi](https://github.com/earendil-works/pi)项目已有功能
