import type { AssistantMessage, SimpleStreamOptions, Context, Message, ThinkingLevel } from "@earendil-works/pi-ai";
import { contentText } from "@earendil-works/pi-ai";
import { apiKey, inaiModel } from "./ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const model = inaiModel;
/**
 * 压缩上下文
 * @param context 上下文
 * @returns 压缩后的上下文
 */
export async function compactContext(context: Context, reserveTokens: number, previousSummary?: string): Promise<Context> {
    const basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
    const conversationText = serializeConversation(context.messages);
    let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
    if (previousSummary) {
        promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
    }
    promptText += basePrompt;

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

const TOOL_RESULT_MAX_CHARS = 2000;

/** Serialize LLM messages to plain text for summarization prompts. */
export function serializeConversation(messages: Message[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
        if (msg.role === "user") {
            const content = contentText(msg.content, "");
            if (content) parts.push(`[User]: ${content}`);
        } else if (msg.role === "assistant") {
            const thinkingParts: string[] = [];
            const toolCalls: string[] = [];

            for (const block of msg.content) {
                if (block.type === "thinking") {
                    thinkingParts.push(block.thinking);
                } else if (block.type === "toolCall") {
                    const args = block.arguments as Record<string, unknown>;
                    const argsStr = Object.entries(args)
                        .map(([k, v]) => `${k}=${safeJsonStringify(v)}`)
                        .join(", ");
                    toolCalls.push(`${block.name}(${argsStr})`);
                }
            }

            if (thinkingParts.length > 0) {
                parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
            }
            if (msg.content.some((block) => block.type === "text")) {
                parts.push(`[Assistant]: ${contentText(msg.content)}`);
            }
            if (toolCalls.length > 0) {
                parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
            }
        } else if (msg.role === "toolResult") {
            const content = contentText(msg.content, "");
            if (content) {
                parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
            }
        }
    }

    return parts.join("\n\n");
}

function truncateForSummary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const truncatedChars = text.length - maxChars;
    return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

export function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "undefined";
    } catch {
        return "[unserializable]";
    }
}