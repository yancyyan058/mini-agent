import { compactContext } from "./compaction";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

import { runTool } from "./tools";
import { inaiModel, apiKey } from "./ai";
import { ContextManager } from "./context";
const model = inaiModel;

export class Agent {
    private contextWindow: number;
    constructor() {
        this.contextWindow = model.contextWindow;
    }
    // loop
    async runAgentLoop(contextManager: ContextManager): Promise<any> {
        let count = 0;
        while (true) {
            // 检查是否需要压缩上下文，需要在调用模型前检查
            await contextManager.transformContext();

            count++;
            // 开始调用模型拿到结果
            const response: AssistantMessage = await streamSimple(model, contextManager.getContext(), {
                apiKey: apiKey,
            }).result();
            // 出错: 抛给 session 层处理, 保留 context 继续对话, 而不是杀掉整个会话
            if (response.stopReason == "error" || response.stopReason == "aborted") {
                throw new Error(response.errorMessage ?? "模型调用出错");
            };

            // 没出错再把结果放到上下文中
            contextManager.addMessage(response);

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
                    contextManager.addMessage({
                        role: "toolResult",
                        toolCallId: item.id,
                        toolName: toolName,
                        content: [{ type: "text", text: toolResult }],
                        isError: false,
                        timestamp: Date.now(),
                    });
                }
            });
            // console.dir(contextManager.getMessages(), { depth: null });
        }
    }

    getContextWindow(): number {
        return this.contextWindow;
    }
}
