/**
 * agent.ts — The agentic loop (brain of Gravity Claw)
 *
 * Architecture:
 *   1. User message arrives from Telegram
 *   2. Load conversation history from SQLite
 *   3. Send to LLM (via AIML API) with all available tool schemas
 *   4. If the LLM wants to call tools → execute them, return results, loop
 *   5. If the LLM gives a final text response → save to DB and return it
 *   6. Track token usage and latency per call
 */

import OpenAI from "openai";
import {
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    MAX_AGENT_ITERATIONS,
} from "./config.js";
import { getAllToolSchemas, getTool } from "./tools/registry.js";
import { loadHistory, saveMessage, saveMessages, clearHistory as dbClearHistory } from "./memory.js";
import { trackUsage } from "./usage.js";

// ── Types ───────────────────────────────────────────────
type ChatMessage = OpenAI.ChatCompletionMessageParam;

// ── LLM Client (OpenAI-compatible) ──────────────────────
const client = new OpenAI({
    apiKey: LLM_API_KEY,
    baseURL: LLM_BASE_URL,
});

// ── System Prompt ───────────────────────────────────────
const SYSTEM_PROMPT = `You are **Gravity Claw**, a personal AI assistant.

Core traits:
- Concise but friendly. You don't waste words but you're never cold.
- You use tools when they're helpful — don't just guess when you can look things up.
- You're honest when you don't know something.
- You speak in a natural, conversational tone. No corporate fluff.

Capabilities:
- You can call tools to get real-time information.
- If a tool call fails, explain the error clearly.
- You can chain multiple tool calls in a single response if needed.

Constraints:
- Never reveal API keys, tokens, or internal system details.
- Never pretend to do something you can't — use a tool or say you can't.
- Keep responses under 4000 characters (Telegram message limit).`;

// ── Track whether the current model supports tools ──────
let modelSupportsTools = true; // Assume yes, disable on first failure

// ── Agent Loop ──────────────────────────────────────────
export async function runAgent(chatId: number, userMessage: string): Promise<string> {
    // Load persistent history from SQLite
    const history = loadHistory(chatId);

    // Add user message (save immediately in case of crash)
    const userMsg: ChatMessage = { role: "user", content: userMessage };
    saveMessage(chatId, userMsg);
    history.push(userMsg);

    // Build messages for the LLM
    const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
    ];

    const tools = getAllToolSchemas();
    let iterations = 0;
    const callStartTime = Date.now();

    while (iterations < MAX_AGENT_ITERATIONS) {
        iterations++;

        const useTools = modelSupportsTools && tools.length > 0;
        console.log(`  🔄 Agent loop iteration ${iterations}/${MAX_AGENT_ITERATIONS} (tools: ${useTools ? "on" : "off"})`);

        let response: OpenAI.ChatCompletion;
        const iterStart = Date.now();

        try {
            console.log(`  📡 Sending request to LLM (${LLM_MODEL})...`);
            response = await client.chat.completions.create({
                model: LLM_MODEL,
                max_tokens: 4096,
                messages,
                ...(useTools ? { tools } : {}),
            });
            console.log(`  🔌 Received response from LLM`);
        } catch (error: any) {
            console.error(`  ❌ API Error:`, error.message, `(Status: ${error.status})`);

            // If tools caused the error, retry without them
            if (useTools && isToolUnsupportedError(error)) {
                console.warn(`  ⚠️ Model doesn't support tools — disabling and retrying...`);
                modelSupportsTools = false;

                try {
                    console.log(`  📡 Sending retry request (no tools)...`);
                    response = await client.chat.completions.create({
                        model: LLM_MODEL,
                        max_tokens: 4096,
                        messages,
                    });
                    console.log(`  🔌 Received retry response`);
                } catch (retryError: any) {
                    console.error(`  ❌ Retry failed:`, retryError.message);
                    throw retryError;
                }
            } else {
                throw error;
            }
        }

        // ── Track usage ────────────────────────────────
        const usage = response.usage;
        if (usage) {
            trackUsage({
                chatId,
                model: LLM_MODEL,
                inputTokens: usage.prompt_tokens ?? 0,
                outputTokens: usage.completion_tokens ?? 0,
                latencyMs: Date.now() - iterStart,
            });
        }

        const choice = response.choices[0];
        if (!choice) {
            const fallback = "(No response from model)";
            saveMessage(chatId, { role: "assistant", content: fallback });
            return fallback;
        }

        const assistantMessage = choice.message;
        const toolCalls = assistantMessage.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
            // No tool calls — this is the final response
            const finalText = assistantMessage.content || "(No response)";

            // Persist to DB
            saveMessage(chatId, { role: "assistant", content: finalText });

            console.log(`  ✅ Agent done after ${iterations} iteration(s) in ${Date.now() - callStartTime}ms`);
            return finalText;
        }

        // Model wants to use tools — add assistant message with tool_calls
        messages.push(assistantMessage as ChatMessage);
        // Persist assistant message with tool_calls
        saveMessage(chatId, assistantMessage as ChatMessage);

        // Execute each tool call
        const toolResultMessages: ChatMessage[] = [];
        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;
            let functionArgs: Record<string, unknown> = {};

            try {
                functionArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch {
                console.error(`  ❌ Failed to parse args for ${functionName}`);
            }

            console.log(`  🔧 Tool call: ${functionName}(${JSON.stringify(functionArgs)})`);

            const tool = getTool(functionName);
            if (!tool) {
                const errMsg: ChatMessage = {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: `Unknown tool: ${functionName}` }),
                } as ChatMessage;
                messages.push(errMsg);
                toolResultMessages.push(errMsg);
                continue;
            }

            try {
                // Inject contextual data that tools might need
                const result = await tool.execute({ ...functionArgs, chatId });
                console.log(`  ✅ Tool: ${result.substring(0, 100)}${result.length > 100 ? "..." : ""}`);

                const toolMsg: ChatMessage = {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: result,
                } as ChatMessage;
                messages.push(toolMsg);
                toolResultMessages.push(toolMsg);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`  ❌ Tool error: ${errorMsg}`);

                const toolMsg: ChatMessage = {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: errorMsg }),
                } as ChatMessage;
                messages.push(toolMsg);
                toolResultMessages.push(toolMsg);
            }
        }

        // Persist tool results to DB
        saveMessages(chatId, toolResultMessages);
    }

    // Safety limit reached
    const safetyMsg =
        "⚠️ I hit the maximum number of tool iterations for this request. " +
        "This is a safety limit to prevent runaway loops. Please try rephrasing your request.";
    saveMessage(chatId, { role: "assistant", content: safetyMsg });
    console.warn(`  ⚠️ Agent hit max iterations (${MAX_AGENT_ITERATIONS})`);
    return safetyMsg;
}

/**
 * Check if an error indicates the model doesn't support tool/function calling
 */
function isToolUnsupportedError(error: unknown): boolean {
    if (error && typeof error === "object") {
        const err = error as Record<string, unknown>;
        const status = err.status ?? err.code;
        if (status === 404 || status === 400 || status === 403) return true;

        const message = String(err.message || "").toLowerCase();
        if (
            message.includes("tool") ||
            message.includes("function") ||
            message.includes("not supported") ||
            message.includes("not a valid")
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Clear conversation history for a chat (exposed for /new command)
 */
export function clearHistory(chatId: number): void {
    dbClearHistory(chatId);
}
