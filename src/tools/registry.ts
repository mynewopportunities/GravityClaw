/**
 * registry.ts — Tool registry for the agentic loop
 *
 * Each tool has:
 *   - name:        unique identifier used by the LLM
 *   - description: what the tool does (sent to the LLM)
 *   - parameters:  JSON Schema for the tool's parameters (OpenAI function calling format)
 *   - execute:     the function that runs the tool and returns a string result
 *
 * Tools are registered here and automatically available to the agent.
 */

import type OpenAI from "openai";

// ── Tool Definition ─────────────────────────────────────
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema object
    execute: (input: Record<string, unknown>) => Promise<string>;
}

// ── Tool Registry ───────────────────────────────────────
const tools: Map<string, ToolDefinition> = new Map();

export function registerTool(tool: ToolDefinition): void {
    if (tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    tools.set(tool.name, tool);
    console.log(`  🔧 Registered tool: ${tool.name}`);
}

export function getTool(name: string): ToolDefinition | undefined {
    return tools.get(name);
}

/**
 * Returns all tools in OpenAI function-calling format
 */
export function getAllToolSchemas(): OpenAI.ChatCompletionTool[] {
    return Array.from(tools.values()).map((t) => ({
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
}

export function getToolCount(): number {
    return tools.size;
}
