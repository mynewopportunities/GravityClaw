/**
 * mcp/index.ts — MCP initialization
 */

import { connectMcpServer } from "./bridge.js";

/**
 * Initialize all MCP servers defined in configuration.
 * For now, we'll connect to a few useful public ones as a proof-of-concept.
 */
export async function initMcp(): Promise<void> {
    console.log("  Bridge: Initializing MCP...");

    // 1. Everything Server (Test Server)
    await connectMcpServer(
        "everything",
        "node",
        ["/home/ubuntu/mcp-servers/src/everything/dist/index.js"]
    );

    // 2. Filesystem Server (Granting access to current project)
    await connectMcpServer(
        "fs",
        "node",
        ["/home/ubuntu/mcp-servers/src/filesystem/dist/index.js", "/home/ubuntu/gravity-claw"]
    );

    console.log("  ✅ MCP: Bridge active with connected servers.");
}
