import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai";
import { listFileTool, readFileTool } from "./tools";
import { compactContext, safeJsonStringify } from "./compaction";

const DEFAULT_SYSTEM_PROMPT =
    "你是一个文件系统助手, 你可以列出目录下的文件, 也可以读取文件内容, 其他操作都不可以做";
// 启动时从工作目录读取这些文件, 拼到系统提示词后面, 给助手提供项目背景
const SOURCE = ["AGENTS.md", "README.md"];

interface ContextCheckpoint {
    context: Context;
    timestamp: number;
}

export class ContextManager {
    private context: Context;
    private contextWindow: number;
    private readonly reserveTokens: number = 16384;

    constructor(contextWindow: number) {
        this.context = this.buildSystemPrompt();
        this.contextWindow = contextWindow;
    }

    private buildSystemPrompt(): Context {
        const parts: string[] = [DEFAULT_SYSTEM_PROMPT];
        for (const file of SOURCE) {
            const filePath = join(process.cwd(), file);
            if (existsSync(filePath)) {
                const content = readFileSync(filePath, "utf-8").trim();
                if (content) parts.push(`# ${file}\n${content}`);
            }
        }
        return {
            systemPrompt: parts.join("\n\n"),
            messages: [],
            tools: [listFileTool, readFileTool],
        };
    }

    /** 整体上下文, 直接传给模型调用 */
    getContext(): Context {
        return this.context;
    }

    getMessages(): Message[] {
        return this.context.messages;
    }

    getMessageCount(): number {
        return this.context.messages.length;
    }

    /** 追加一条消息, 消息结构由调用方构造 */
    addMessage(message: Message): void {
        this.context.messages.push(message);
    }

    /** 保存上下文快照, 深拷贝避免后续 addMessage/rollback 污染快照 */
    createCheckpoint(): ContextCheckpoint {
        return {
            context: this.cloneContext(this.context),
            timestamp: Date.now(),
        };
    }

    /** 从快照恢复, 深拷贝避免后续操作反向污染原快照(支持多次恢复同一快照) */
    restoreCheckpoint(checkpoint: ContextCheckpoint): void {
        this.context = this.cloneContext(checkpoint.context);
    }

    async transformContext(force = false): Promise<void> {
        let currentContextTotalTokens = 0;
        for (const msg of this.getMessages()) {
            currentContextTotalTokens += this.estimateTokens(msg);
        }
        if (force || this.shouldCompact(currentContextTotalTokens, this.contextWindow)) {
            this.context = await compactContext(this.getContext(), this.reserveTokens);
        }
    }

    /**
     * 检查是否需要压缩上下文
     * @param contextTokens 当前上下文 token 数量
     * @param contextWindow 配置上下文窗口 token 数量
     * @param reserveTokens 保留 token 数量，为摘要系统提示词 + LLM 输出预留的 Token 预算
     * @returns 是否需要压缩上下文
     */
    shouldCompact(
        contextTokens: number,
        contextWindow: number
    ): boolean {
        return contextTokens > contextWindow - this.reserveTokens;
    }

    private estimateTextAndImageContentChars(content: string | Array<{ type: string; text?: string }>): number {
        if (typeof content === "string") {
            return content.length;
        }

        let chars = 0;
        for (const block of content) {
            if (block.type === "text" && block.text) {
                chars += block.text.length;
            }
        }
        return chars;
    }

    private cloneContext(context: Context): Context {
        return {
            ...context,
            messages: [...context.messages],
            tools: context.tools ? [...context.tools] : [],
        };
    }

    /**
     * 估算上下文文本和图片字符数
     * @param content 上下文内容
     * @returns 字符数
     */
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
}
