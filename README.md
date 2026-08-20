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

| 组件     | 版本 / 说明                                      |
| -------- | ------------------------------------------------ |
| Node.js  | v26.7.0                                          |
| 包管理   | npm 11.19.0，pnpm 可用                           |
| 语言     | TypeScript                                       |
| 运行器   | `tsx`，无需编译，直接执行 `.ts`                  |
| 核心框架 | `@earendil-works/pi-ai` —— 多模型 Agent 开发 SDK |

装好依赖后，`npx tsx agent/cli.ts` 一行命令即跑。`pi-ai` 把不同厂商的 API 差异封装在 provider 层，让你用同一套 `Context` 驱动不同模型；本例接的是 OpenAI 兼容接口（`openai-completions`）。

>[!info] 为加快本次开发，部分功能会直接复用 [@earendil-works/pi](https://github.com/earendil-works/pi)项目已有功能

---

## 基座搭建

### 接入模型

模型配置就是 agent 的核心定义——id、接口、上下文窗口、成本：

```typescript title:"ai.ts"
import { type Model } from "@earendil-works/pi-ai";

export const inaiModel: Model<"openai-completions"> = {
	id: "deepseek-v4-flash",
	name: "Deepseek V4 Flash",
	api: "openai-completions",
	provider: "inai-provider", // 必须与 Provider.id 一致
	baseUrl: "https://example.online/v1",
	reasoning: false,
	input: ["text"],
	contextWindow: 128000,
	maxTokens: 4096,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
};

export const apiKey = "xxxxx";
```

### 定义工具

先接 `list_file` 和 `read_file` 两个工具，`runTool` 用**占位返回**模拟结果，让我们聚焦循环本身而非文件 I/O：

```typescript title:"tool.ts"
import { Type, type Context, type Tool } from "@earendil-works/pi-ai";

export function runTool(toolName: string, args: Record<string, any>):string {
    // 处理一下文件路径，确保是绝对路径
    const isAbsolute = args.path.startsWith('/')
    const targetPath = isAbsolute ? args.path : process.cwd() + '/' + args.path

    switch (toolName) {
        case 'list_file':
            return "main.txt"
        case 'read_file':
            return "这是文件内容"
        default:
            throw new Error('Unknown tool: ' + toolName)
    }
}

export const listFileTool: Tool = {
    name: 'list_file',
    description: 'list files in a directory',
    parameters: Type.Object({
        path: Type.String()
    })
}

export const readFileTool: Tool = {
    name: 'read_file',
    description: 'read a file',
    parameters: Type.Object({
        path: Type.String()
    })
}
```

每个工具三要素：`name`（调用名）、`description`（干什么、何时用）、`parameters`（参数 schema）。**description 直接决定模型会不会、以及何时调用它。**

### 核心循环

骨架拆成两步：`initContext`（装入 systemPrompt + 用户消息 + 工具）与 `loop`（主循环）。这个 `while(true)` 就是 agent 的驱动引擎：

```typescript title:"agent.ts"
import { type Context, type AssistantMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

import { listFileTool, readFileTool, runTool } from "./tools";
import { inaiModel, apiKey } from "./ai";
const models = inaiModel;

function initContext(userContent: string): Context {
    return {
        systemPrompt: "你是一个文件系统助手, 你可以列出目录下的文件, 也可以读取文件内容, 其他操作都不可以做",
        messages: [{
            role: 'user',
            content: userContent,
            timestamp: Date.now()
        }],
        tools: [listFileTool, readFileTool],
    };
}

export function prompt(userContent: string) {
     const context = initContext(userContent);
     return runAgent(context);
}

// loop
export async function runAgent(context: Context): Promise<any> {
    let count = 0;
    while (true) {
        // 简单打印一下loop次数
        count++;
        console.log(`Loop ${count} ...`);
        // 开始调用模型拿到结果
        const response: AssistantMessage = await streamSimple(models, context, {
            apiKey: apiKey,
        }).result();
        // 先把结果放到上下文中
        context.messages.push(response);

        // 错误退出
        if (response.stopReason == "error" || response.stopReason == "aborted") {
            console.log(`Error: ${response.errorMessage}`);
            process.exit(1);
        };

        // 如果不是工具调用, 则退出loop
        if (response.stopReason == "stop") {
            const text = response.content
                .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                .map((b) => b.text)
                .join("\n");
            return text;
        };

        // 处理工具调用
        response.content.forEach((item) => {
            if (item.type == "toolCall") {
                const toolName = item.name;
                const toolArgs = item.arguments;
                console.log(`Tool Call: ${toolName}(${JSON.stringify(toolArgs)})`);
                const toolResult = runTool(toolName, toolArgs);
                context.messages.push({
                    role: "toolResult",
                    toolCallId: item.id,
                    toolName: toolName,
                    content: [{ type: "text", text: toolResult }],
                    isError: false,
                    timestamp: Date.now(),
                });
            }
        });
        console.dir(context.messages, { depth: null });
    }
}
```

每轮节奏固定：**收到回复 → 进上下文 → 判断是否含工具调用 → 有就执行、结果再进上下文 → 进入下一轮。** 上下文在循环中累积，模型据此一步步推进。

### 跑起来

```typescript title:"cli.ts"
import { prompt } from './agent';

const result = await prompt("列出当前目录下的文件");

console.log(JSON.stringify(result, null, 2));
```

实测——第 1 轮决定调用 `list_file`，第 2 轮基于结果组织出自然语言回答：

```shell title:"控制台输出"
(base) ➜  mini-pi npx tsx ./agent/cli.ts 

Loop 1 ...
Tool Call: list_file({"path":"."})
[
  { role: 'user', content: '列出当前目录下的文件', timestamp: 1786072141669 },
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'The user wants me to list files in the current directory. Let me list the current directory.',
        thinkingSignature: 'reasoning_content'
      },
      {
        type: 'toolCall',
        id: 'call_00_X9Mu2X29uiSIpgQYfQ2A5470',
        name: 'list_file',
        arguments: { path: '.' }
      }
    ],
    api: 'openai-completions',
    provider: 'inai-provider',
    model: 'deepseek-v4-flash',
    usage: {
      input: 40,
      output: 62,
      cacheRead: 384,
      cacheWrite: 0,
      reasoning: 19,
      totalTokens: 486,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'toolUse',
    timestamp: 1786072141669,
    responseId: '2047ce29-78ce-4ad0-918f-ecfb1e7952c6',
    rawStopReason: 'tool_calls'
  },
  {
    role: 'toolResult',
    toolCallId: 'call_00_X9Mu2X29uiSIpgQYf2A5470',
    toolName: 'list_file',
    content: [ { type: 'text', text: 'main.txt' } ],
    isError: false,
    timestamp: 1786072144204
  }
]
Loop 2 ...
"当前目录下有一个文件：\n\n- `main.txt`\n\n需要我读取这个文件的内容吗？"
```

### 总结

当前的`prompt()` 每次都调 `initContext()` 建一个全新 context、跑完就丢，`cli.ts` 只调用一次。runAgent 里的 while循环是工具调用循环（模型↔工具往返），但目前实现的是**单轮 + 工具循环**

---

## 模块一：多轮对话

> 地基。context 不持续累积，后面全是空中楼阁。

### 思路

- 把 `context` 提到**会话级**，不再每次重建。
- 拆出 **`Agent`（核心 loop，无状态）** + **`AgentSession`（会话/交互层）** 两层：session 负责建 context、跑 REPL、推消息；loop 只管模型↔工具往返，职责保持纯粹，方便后面挂压缩、干预等能力。
- `runAgentLoop` 本就会往 `context.messages` 累积消息，天然支持多轮，核心不用动。

### 实现

新增 `session.ts` 承载交互层，`cli.ts` 仅负责装配启动：

```typescript title:"cli.ts"
import { Agent } from './agent';
import { AgentSession } from './session';

const agent = new Agent();
const session = new AgentSession(agent);
session.start();
```

```typescript title:"session.ts"
import { Context } from "@earendil-works/pi-ai";
import { Agent } from "./agent";
import { listFileTool, readFileTool } from "./tools";
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export class AgentSession {
    agent: Agent;
    context: Context;
    constructor(agent: Agent) {
        this.agent = agent;
        this.context = this.initContext();   // 会话级 context, 整个会话复用
    }

    private initContext(): Context {
        return {
            systemPrompt: "你是一个文件系统助手, 你可以列出目录下的文件, 也可以读取文件内容, 其他操作都不可以做",
            messages: [],                       // 初始为空, 靠对话逐条累积
            tools: [listFileTool, readFileTool],
        };
    }

    async start() {
        console.log("Hello, I am mini-pi agent.");
        const rl = readline.createInterface({ input, output });

        let shouldExit = false;
        const sigintHandler = () => {           // Ctrl+C 优雅退出
            console.log("\nBye...");
            shouldExit = true;
            rl.close();
        };
        rl.on("SIGINT", sigintHandler);
        process.on("SIGINT", sigintHandler);

        try {
            while (true) {
                let userInput: string;
                try {
                    userInput = await rl.question('> ');
                } catch (err) {
                    // rl.question 被拒绝 = readline 已关闭 (Ctrl+C / Ctrl+D / EOF), 一律优雅退出
                    break;
                }
                if (shouldExit) break;

                const trimmedInput = userInput.trim();
                if (!trimmedInput) continue;

                await this.runAgent(trimmedInput);
            }
        } finally {
            rl.removeListener("SIGINT", sigintHandler);
            process.removeListener("SIGINT", sigintHandler);
            rl.close();
        }
    }

    async runAgent(prompt: string) {
        this.context.messages.push({ role: 'user', content: prompt, timestamp: Date.now() });
        try {
            const result = await this.agent.runAgentLoop(this.context);
            console.log(JSON.stringify(result, null, 2));
        } catch (err) {
            // 本轮模型出错: 回滚刚 push 的 user 消息, 保持 context 干净, 等下一句重试
            this.context.messages.pop();
            console.log(`\n[出错] ${(err as Error).message}, 请重试`);
        }
    }
}
```

`agent.ts` 的改动很小：把 loop 提成 `Agent.runAgentLoop`，并把**错误处理从"杀进程"改成"抛异常"**——先判错、确认无误再 push 响应，避免把残缺响应污染 context：

```typescript title:"agent.ts"
export class Agent {
    async runAgentLoop(context: Context): Promise<any> {
        let count = 0;
        while (true) {
            count++;
            const response: AssistantMessage = await streamSimple(models, context, {
                apiKey: apiKey,
            }).result();
            // 出错: 抛给 session 层处理, 保留 context 继续对话, 而不是杀掉整个会话
            if (response.stopReason == "error" || response.stopReason == "aborted") {
                throw new Error(response.errorMessage ?? "模型调用出错");
            };
            // 没出错再把结果放到上下文中
            context.messages.push(response);
            // ... 后续 stop / toolCall 处理同基座
        }
    }
}
```

### 关键点

- **会话级 context**：`messages` 从空开始累积，`runAgent` 只 push 新 user 消息，跨轮记忆自然成立。
- **错误不杀会话**：loop 层 `throw`、session 层 `try/catch`，单次 API 失败不会清掉整个对话历史；出错时回滚最后一条 user 消息、打印提示后继续等下一句。
- **顺序防污染**：先判错抛出、确认成功才 push 响应，保证 context 始终干净。
- **优雅退出**：Ctrl+C / Ctrl+D / EOF 都走 catch `break`，不再抛 `ERR_USE_AFTER_CLOSE`。

>[!warning] 实时干预的前瞻
>现在 `start()` 里是 `await this.runAgent()`——一轮没跑完就不会读下一句输入。对"多轮对话"完全够用，但到**模块四（实时干预）**时这套"await 阻塞读输入"必须重构（要边跑边收输入）。现在不用管，心里有数即可。

## 模块二：Context 管理（压缩）

> 多轮一跑 token 立刻爆，不压缩无法继续开发/测试。

**方案：**

- 每轮响应里已有 `response.usage.input`，据此估算当前 context token。
- 超过阈值（如 70%）触发压缩：取最早的 N 条消息，用一次 LLM 调用摘要成一段文本，塞进 `systemPrompt`（或一条 summary 消息），删掉原文。结构变成 **"摘要 + 最近若干消息"**。
- 从最简单的**滑窗 + 整体摘要**起步即可，后续再细化按角色/重要度保留。



**实现：**

1. 推算 context token：根据字符个数，以 `chars / 4` 为预估token个数

``````typescript
    private estimateTokens(message: Message): number {
        let chars = 0;
        switch (message.role) {
            case "user": {
                chars = this.estimateTextAndImageContentChars(
                    (message as { content: string | Array<{ type: string; text?: string }> }).content,
                );
                return Math.ceil(chars / 4);
            }
            case "assistant": {
                const assistant = message as AssistantMessage;
                for (const block of assistant.content) {
                    if (block.type === "text") {
                        chars += block.text.length;
                    } else if (block.type === "thinking") {
                        chars += block.thinking.length;
                    } else if (block.type === "toolCall") {
                        chars += block.name.length + safeJsonStringify(block.arguments).length;
                    }
                }
                return Math.ceil(chars / 4);
            }
            case "toolResult": {
                chars = this.estimateTextAndImageContentChars(message.content);
                return Math.ceil(chars / 4);
            }
        }
    }
``````

2. 阈值判断，触发压缩算法。

- 阈值判断是否该压缩

  ``````typescript
  const reserveTokens: number = 16384;
  /**
   * 检查是否需要压缩上下文
   * @param contextTokens 当前上下文 token 数量
   * @param contextWindow 配置上下文窗口 token 数量
   * @param reserveTokens 保留 token 数量，为摘要系统提示词 + LLM 输出预留的 Token 预算
   * @returns 是否需要压缩上下文
   */
  shouldCompact(contextTokens: number, contextWindow: number): boolean {
      return contextTokens > contextWindow - this.reserveTokens;
  }
  ``````

- 开始压缩

  ``````typescript
  export async function compactContext(context: Context, reserveTokens: number, previousSummary?: string): Promise<Context> {
    // 组装prompt，把历史会话放在prompt中
    const basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
    const conversationText = serializeConversation(context.messages);
    let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
    if (previousSummary) {
        promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
    }
    promptText += basePrompt;

    // 作为user输入
    const summarizationContext: Context = {
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
        tools: [],
        messages: [
            {
                role: "user",
                content: [{ type: "text", text: promptText }],
                timestamp: Date.now(),
            },
        ],
    };

    const thinkingLevel: ThinkingLevel = "medium";

    const maxTokens = Math.min(
        Math.floor(0.8 * reserveTokens),
        model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
    );

    // 中断信号量暂时设为 null，不支持中断
    const completionOptions: SimpleStreamOptions =
        { maxTokens: maxTokens, signal: undefined, reasoning: thinkingLevel, apiKey: apiKey };

    const response: AssistantMessage = await streamSimple(
        model,
        summarizationContext,
        completionOptions)
        .result();

    if (response.stopReason === "error") {
        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
    }

    const textContent = contentText(response.content);

    // 替换上下文中的旧消息，这里要重新构建一个user message，不能直接使用response
    context.messages = [{
        role: "user",
        content: [{ type: "text", text: `<context_summary>\n${textContent}\n</context_summary>` }],
        timestamp: Date.now(),
    }];
    return context;
  }
  ``````

  

## 模块三：Memory 管理（持久）

> 和模块二技术同源（都是"摘要 + 注入"），紧接做最省力。

**方案：**

- 与压缩的区别只是"跨会话"：会话结束时把摘要/关键事实落到本地文件（`.memory.json` 或 md）。
- 新会话 `initContext` 时读回来，注入 `systemPrompt`。
- 写入时机最省力的两种接法：
  - **被动**：模块二压缩产出的摘要顺手存盘。
  - **主动**：加一个 `remember` 工具，让 agent 自己决定存什么。

## 模块四：实时干预

> 要把 loop 改成流式可中断，改动最大，放核心稳定之后。

**方案：**

- 当前 `await streamSimple(...).result()` 是阻塞式等完整结果，必须改成**逐 chunk 消费**（`streamSimple` 本身就是流式接口）。
- 维护一个**用户输入队列**；每两个 chunk 之间检查队列；有新指令就用 `AbortController` 中断当前请求，把新指令作为 user message 插入 context 重启一轮。
- 工具执行阶段同理：用 `AbortController` 把 `runTool` 包成可取消。

## 模块五：MCP + Skills

> 能力扩展（外功），核心（内功）打牢再扩。

**方案：**

- **MCP**：接入 `@modelcontextprotocol/sdk` 作 client，连 server，把 server 暴露的 tools 转成 pi-ai 的 `Tool` 格式塞进 `context.tools`；`runTool` 里把调用转发给 MCP client——这样就把现在写死的 `list_file`/`read_file` 换成了即插即用工具。
- **Skills**：起步形态——一个目录，每个 skill 是一个 markdown（指令）+ 可选脚本；检测到匹配场景就把对应 skill 指令注入 context（动态 system prompt）。可再配一个 `load_skill` 工具按需加载。