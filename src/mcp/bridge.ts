/**
 * mcp/bridge.ts — The MCP Tool Bridge
 *
 * Connects to external MCP servers and registers their tools
 * into the main Gravity Claw tool registry.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerTool } from "../tools/registry.js";

export async function connectMcpServer(name: string, command: string, args: string[]): Promise<void> {
    console.log(`  🌉 MCP: Connecting to server "${name}"...`);

    try {
        const transport = new StdioClientTransport({
            command,
            args,
        });

        const client = new Client(
            {
                name: "gravity-claw-client",
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );

        await client.connect(transport);

        // List available tools from the MCP server
        const { tools } = await client.listTools();
        console.log(`  📦 MCP: Server "${name}" provided ${tools.length} tool(s)`);

        // Register each tool into our registry
        for (const tool of tools) {
            registerTool({
                name: `mcp_${name}_${tool.name}`, // Namespaced to avoid collisions
                description: `${tool.description} (via MCP ${name})`,
                parameters: tool.inputSchema as any,
                execute: async (args: Record<string, any>) => {
                    console.log(`  🔧 MCP Executing: ${name}:${tool.name}`);
                    const result = await client.callTool({
                        name: tool.name,
                        arguments: args,
                    });

                    // Handle complex MCP results
                    if (result.isError) {
                        throw new Error(JSON.stringify(result.content));
                    }

                    const content = result.content as any[];
                    return content
                        .map((c: any) => c.text ?? JSON.stringify(c))
                        .join("\n");
                },
            });
            console.log(`     - Registered: mcp_${name}_${tool.name}`);
        }
    } catch (error) {
        console.error(`  ❌ MCP: Failed to connect to server "${name}":`, error);
    }
}
