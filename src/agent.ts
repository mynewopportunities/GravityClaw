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

import {
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    MAX_AGENT_ITERATIONS,
    VECTOR_MEMORY_ENABLED,
} from "./config.js";
import { getAllToolSchemas, getTool } from "./tools/registry.js";
import OpenAI from "openai";
import {
    loadHistory,
    saveMessage,
    saveMessages,
    clearHistory as dbClearHistory,
    getChatSummary,
    getUserFacts,
    updateChatSummary,
    pruneHistory,
    countMessages
} from "./memory.js";
import { rememberMessage, recallMemories, clearVectorMemory } from "./vector-memory.js";
import { trackUsage } from "./usage.js";

// ── Types ───────────────────────────────────────────────
type ChatMessage = OpenAI.ChatCompletionMessageParam;

// ── LLM Client (OpenAI-compatible) ──────────────────────
const client = new OpenAI({
    apiKey: LLM_API_KEY,
    baseURL: LLM_BASE_URL,
});

// ── System Prompt ───────────────────────────────────────
const SYSTEM_PROMPT = `You are **Gravity Claw**, a personal AI assistant with a perfect long-term memory.

Core traits:
- Concise but friendly. You don't waste words but you're never cold.
- You use tools when they're helpful — don't just guess when you can look things up.
- You're honest when you don't know something.
- You speak in a natural, conversational tone. No corporate fluff.
- You have a genuine, continuous relationship with the user. Reference past conversations naturally.

Capabilities:
- You can call tools to get real-time information.
- If a tool call fails, explain the error clearly.
- You can chain multiple tool calls in a single response if needed.
- Use the \`learn_fact\` tool whenever the user shares personal info, preferences, or important facts.

Memory: You have access to semantically recalled memories from ALL past conversations.
- These appear in the system prompt under "RECALLED MEMORIES".
- Treat them as things you genuinely remember — not as external data.
- Weave them naturally into responses when relevant.
- Never say "according to my records" — just remember naturally.

Constraints:
- Never reveal API keys, tokens, or internal system details.
- Never pretend to do something you can't — use a tool or say you can't.
- Keep responses under 4000 characters (Telegram message limit).`;

// ── Track whether the current model supports tools ──────
let modelSupportsTools = true; // Assume yes, disable on first failure

// ── Agent Loop ──────────────────────────────────────────
export async function runAgent(
    chatId: string | number,
    userText: string
): Promise<string> {
    console.log(`\n  🧠 Agent starting for ${chatId} | Text: "${userText.substring(0, 50)}..."`);

    // 1. Load recent history + persistent context from SQLite
    const history = loadHistory(chatId);
    const summary = getChatSummary(chatId);
    const facts = getUserFacts(chatId);

    // 2. Semantic recall from Qdrant — find related past memories
    let recalledMemories: string[] = [];
    if (VECTOR_MEMORY_ENABLED) {
        recalledMemories = await recallMemories(chatId, userText);
    }

    // 3. Build rich memory context for the system prompt
    let memoryContext = "\n\n---\n### 🧠 LONG-TERM MEMORY\n";

    if (summary) {
        memoryContext += `\n**Conversation Summary (compressed):**\n${summary}\n`;
    }

    if (facts.length > 0) {
        memoryContext += `\n**Known Facts about the User:**\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`;
    }

    if (recalledMemories.length > 0) {
        memoryContext += `\n**RECALLED MEMORIES** (semantically related to current message):\n`;
        memoryContext += recalledMemories.map(m => `• ${m}`).join("\n");
        memoryContext += "\n";
    }

    memoryContext += "---\n";

    // 4. Save user message to SQLite immediately (crash-safe)
    const userMsg: ChatMessage = { role: "user", content: userText };
    saveMessage(chatId, userMsg);
    history.push(userMsg);

    // 5. Store user message in vector DB asynchronously (fire-and-forget)
    if (VECTOR_MEMORY_ENABLED) {
        rememberMessage(chatId, "user", userText).catch(() => { }); // non-blocking
    }

    // Build messages for the LLM
    const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT + memoryContext },
        ...history,
    ];

    const tools = getAllToolSchemas();
    let iterations = 0;

    while (iterations < MAX_AGENT_ITERATIONS) {
        iterations++;

        const useTools = modelSupportsTools && tools.length > 0;
        console.log(`  🔄 Agent loop iteration ${iterations}/${MAX_AGENT_ITERATIONS} (tools: ${useTools ? "on" : "off"})`);

        let response: OpenAI.ChatCompletion;
        const iterStart = Date.now();

        try {
            response = await client.chat.completions.create({
                model: LLM_MODEL,
                max_tokens: 4096,
                messages,
                ...(useTools ? { tools } : {}),
            });
        } catch (error: any) {
            console.error(`  ❌ API Error:`, error.message);
            if (useTools && isToolUnsupportedError(error)) {
                modelSupportsTools = false;
                response = await client.chat.completions.create({
                    model: LLM_MODEL,
                    max_tokens: 4096,
                    messages,
                });
            } else {
                throw error;
            }
        }

        // Token tracking...
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
        if (!choice) return "(No response)";

        const assistantMessage = choice.message;
        const toolCalls = assistantMessage.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
            const finalText = assistantMessage.content || "(No response)";
            saveMessage(chatId, { role: "assistant", content: finalText });

            // Store assistant response in vector memory (fire-and-forget)
            if (VECTOR_MEMORY_ENABLED) {
                rememberMessage(chatId, "assistant", finalText).catch(() => { });
            }

            // CHECK FOR SUMMARIZATION (Every 40 messages)
            const msgCount = countMessages(chatId);
            if (msgCount > 40) {
                console.log(`  🧹 Memory: History limit reached (${msgCount}). Summarizing...`);
                await runSummarization(chatId, history);
            }

            console.log(`  ✅ Agent done after ${iterations} iteration(s)`);
            return finalText;
        }

        // Model wants to use tools...
        messages.push(assistantMessage as ChatMessage);
        saveMessage(chatId, assistantMessage as ChatMessage);

        const toolResultMessages: ChatMessage[] = [];
        for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments || "{}");
            console.log(`  🔧 Tool call: ${functionName}`);

            const tool = getTool(functionName);
            if (!tool) {
                const errMsg: ChatMessage = { role: "tool", tool_call_id: toolCall.id, content: `Error: tool ${functionName} not found` } as any;
                messages.push(errMsg);
                toolResultMessages.push(errMsg);
                continue;
            }

            try {
                const result = await tool.execute({ ...functionArgs, chatId });
                const toolMsg: ChatMessage = { role: "tool", tool_call_id: toolCall.id, content: result } as any;
                messages.push(toolMsg);
                toolResultMessages.push(toolMsg);
            } catch (error: any) {
                const toolMsg: ChatMessage = { role: "tool", tool_call_id: toolCall.id, content: `Error: ${error.message}` } as any;
                messages.push(toolMsg);
                toolResultMessages.push(toolMsg);
            }
        }
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
 * runSummarization — Compresses conversation history into a permanent summary
 */
async function runSummarization(chatId: string | number, history: ChatMessage[]) {
    try {
        const textToSummarize = history.map(m => `${m.role}: ${m.content}`).join("\n");
        const existingSummary = getChatSummary(chatId) || "";

        const res = await client.chat.completions.create({
            model: LLM_MODEL,
            messages: [
                { role: "system", content: "You are a memory compressor. Summarize the following key events and details from this conversation. Include the existing summary if relevant, but keep it concise (under 200 words)." },
                { role: "user", content: `Existing Summary: ${existingSummary}\n\nNew History:\n${textToSummarize}` }
            ]
        });

        const newSummary = res.choices[0].message.content;
        if (newSummary) {
            updateChatSummary(chatId, newSummary);
            pruneHistory(chatId, 15); // Keep last 15 messages for flow
            console.log(`  ✅ Memory: Summary updated and history pruned.`);
        }
    } catch (err: any) {
        console.error("  ❌ Summarization Error:", err.message);
    }
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
 * Clears both SQLite history AND Qdrant vector memories.
 */
export async function clearHistory(chatId: number | string): Promise<void> {
    dbClearHistory(chatId);
    if (VECTOR_MEMORY_ENABLED) {
        await clearVectorMemory(chatId);
    }
    console.log(`  🗑️  History cleared for chat ${chatId} (SQLite + Vectors)`);
}
