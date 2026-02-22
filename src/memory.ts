/**
 * memory.ts — Persistent conversation history
 *
 * Replaces the in-memory Map in agent.ts with SQLite-backed
 * conversation history that survives bot restarts.
 */

import OpenAI from "openai";
import { db } from "./db.js";

type ChatMessage = OpenAI.ChatCompletionMessageParam;

const MAX_HISTORY = 40; // Max raw messages to load per chat

// ── Load history for a chat ───────────────────────────────
export function loadHistory(chatId: string | number): ChatMessage[] {
    const cid = String(chatId);
    const rows = db.prepare(`
        SELECT role, content, tool_name, tool_calls
        FROM conversation_history
        WHERE chat_id = ?
        ORDER BY created_at ASC
        LIMIT ?
    `).all(cid, MAX_HISTORY) as any[];

    return rows.map((row) => {
        // Reconstruct assistant messages with tool_calls
        if (row.role === "assistant" && row.tool_calls) {
            return {
                role: "assistant",
                content: row.content || null,
                tool_calls: JSON.parse(row.tool_calls),
            } as ChatMessage;
        }
        // Reconstruct tool result messages
        if (row.role === "tool") {
            return {
                role: "tool",
                content: row.content,
                tool_call_id: row.tool_name || "unknown",
            } as ChatMessage;
        }
        return {
            role: row.role,
            content: row.content,
        } as ChatMessage;
    });
}

// ── Save a single message ─────────────────────────────────
export function saveMessage(
    chatId: string | number,
    message: ChatMessage
): void {
    const cid = String(chatId);
    const role = message.role;
    let content = "";
    let toolName: string | null = null;
    let toolCallsJson: string | null = null;

    if (role === "user" || role === "system") {
        content = typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);
    } else if (role === "assistant") {
        const m = message as OpenAI.ChatCompletionAssistantMessageParam;
        content = typeof m.content === "string" ? (m.content ?? "") : "";
        if (m.tool_calls?.length) {
            toolCallsJson = JSON.stringify(m.tool_calls);
        }
    } else if (role === "tool") {
        const m = message as OpenAI.ChatCompletionToolMessageParam;
        content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        toolName = m.tool_call_id;
    }

    db.prepare(`
        INSERT INTO conversation_history (chat_id, role, content, tool_name, tool_calls)
        VALUES (?, ?, ?, ?, ?)
    `).run(cid, role, content, toolName, toolCallsJson);
}

// ── Save multiple messages at once ────────────────────────
export function saveMessages(chatId: string | number, messages: ChatMessage[]): void {
    const cid = String(chatId);
    const insertMany = db.transaction((msgs: ChatMessage[]) => {
        for (const msg of msgs) {
            saveMessage(cid, msg);
        }
    });
    insertMany(messages);
}

// ── Clear history for a chat ──────────────────────────────
export function clearHistory(chatId: string | number): void {
    const cid = String(chatId);
    db.prepare("DELETE FROM conversation_history WHERE chat_id = ?").run(cid);
}

// ── Count messages for a chat ─────────────────────────────
export function countMessages(chatId: string | number): number {
    const cid = String(chatId);
    const row = db.prepare(
        "SELECT COUNT(*) as c FROM conversation_history WHERE chat_id = ?"
    ).get(cid) as { c: number };
    return row.c;
}

// ── Prune to keep last N messages ────────────────────────
export function pruneHistory(chatId: string | number, keepLast: number = 20): number {
    const cid = String(chatId);
    const result = db.prepare(`
        DELETE FROM conversation_history
        WHERE chat_id = ? AND id NOT IN (
            SELECT id FROM conversation_history
            WHERE chat_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        )
    `).run(cid, cid, keepLast);
    return result.changes;
}
