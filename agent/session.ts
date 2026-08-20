import { Agent } from "./agent";
import { ContextManager } from "./context";
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export class AgentSession {
    agent: Agent;
    contextManager: ContextManager;
    constructor(agent: Agent) {
        this.agent = agent;
        this.contextManager = new ContextManager(agent.getContextWindow());
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

                // /compact: 手动触发上下文压缩
                if (trimmedInput === '/compact') {
                    console.log('正在压缩上下文...');
                    try {
                        await this.contextManager.transformContext(true);
                        console.log(`上下文已压缩, 当前消息数: ${this.contextManager.getMessageCount()}`);
                        console.log(this.contextManager.getContext().messages.map(msg => msg.content));
                    } catch (err) {
                        console.log(`\n[压缩失败] ${(err as Error).message}`);
                    }
                    continue;
                }

                await this.runAgent(trimmedInput);
            }
        } finally {
            rl.removeListener("SIGINT", sigintHandler);
            process.removeListener("SIGINT", sigintHandler);
            rl.close();
        }
    }

    async runAgent(prompt: string) {
        // 保存当前上下文快照
        const checkpoint = this.contextManager.createCheckpoint();
        // 执行模型调用
        this.contextManager.addMessage({
            role: 'user',
            content: prompt,
            timestamp: Date.now()
        });
        try {
            const result = await this.agent.runAgentLoop(this.contextManager);
            console.log(JSON.stringify(result, null, 2));
        } catch (err) {
            this.contextManager.restoreCheckpoint(checkpoint);
            console.log(`\n[出错] ${(err as Error).message}, 请重试`);
        }
    }
}
