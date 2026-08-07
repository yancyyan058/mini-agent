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
        this.context = this.initContext();
    }

    private initContext(): Context {
        return {
            systemPrompt: "你是一个文件系统助手, 你可以列出目录下的文件, 也可以读取文件内容, 其他操作都不可以做",
            messages: [],
            tools: [listFileTool, readFileTool],
        };
    }

    async start() {
        console.log("Hello, I am mini-agent.");
        const rl = readline.createInterface({ input, output });

        let shouldExit = false;
        const sigintHandler = () => {
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
        this.context.messages.push({
            role: 'user',
            content: prompt,
            timestamp: Date.now()
        });
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