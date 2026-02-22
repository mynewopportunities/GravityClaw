/**
 * mcp/index.ts — MCP initialization
 */

import { connectMcpServer } from "./bridge.js";

/**
 * Initialize all MCP servers defined in configuration.
 * For now, we'll connect to a few useful public ones as a proof-of-concept.
 */
export async function initMcp(): Promise<void> {
    console.log("  🌉 MCP: Initializing Bridge...");

    // Example 1: Use npx to run a simple MCP server (e.g. weather)
    // This is a POC — you can add real servers (maps, gmail, etc.) here.
    await connectMcpServer(
        "everything",
        "npx",
        ["-y", "@modelcontextprotocol/server-everything"]
    );

    console.log("  ✅ MCP: Bridge ready.");
}
