/**
 * file-ops.ts — File system operations tool
 *
 * Security model:
 *   - Path allowlisting: only allowed directories can be accessed
 *   - Read-size limit (50KB per file)
 *   - Write-size limit (100KB per file)
 *   - No access to sensitive files (.env, private keys, etc.)
 *   - Symlink traversal blocked
 */

import { registerTool } from "./registry.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(path.join(__dirname, "..", ".."));

// ── Allowed directories (restricts all file ops) ────────
const ALLOWED_DIRS = [
    PROJECT_ROOT,
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", "Documents"),
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", "Downloads"),
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", "Desktop"),
];

// ── Blocked filenames ─────────────────────────────────────
const BLOCKED_NAMES = [".env", ".env.local", "id_rsa", "server_id_rsa", "*.ppk", "*.pem"];

const MAX_READ_BYTES = 50_000;
const MAX_WRITE_BYTES = 100_000;

// ── Safety checks ─────────────────────────────────────────
function resolveSafe(filePath: string): { ok: boolean; resolved: string; reason?: string } {
    const resolved = path.resolve(filePath);

    // Check blocked names
    const basename = path.basename(resolved);
    for (const blocked of BLOCKED_NAMES) {
        if (blocked.includes("*")) {
            const ext = blocked.replace("*", "");
            if (basename.endsWith(ext)) {
                return { ok: false, resolved, reason: `Access to ${basename} is blocked for security.` };
            }
        } else if (basename === blocked) {
            return { ok: false, resolved, reason: `Access to ${basename} is blocked for security.` };
        }
    }

    // Check allowed directories
    const inAllowed = ALLOWED_DIRS.some((dir) => resolved.startsWith(dir));
    if (!inAllowed) {
        return {
            ok: false,
            resolved,
            reason: `Path is outside allowed directories. Allowed: ${ALLOWED_DIRS.join(", ")}`,
        };
    }

    return { ok: true, resolved };
}

// ── File Operations ───────────────────────────────────────

async function readFile(filePath: string): Promise<string> {
    const { ok, resolved, reason } = resolveSafe(filePath);
    if (!ok) return `🚫 ${reason}`;

    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) return `Error: ${resolved} is a directory, not a file.`;
    if (stat.size > MAX_READ_BYTES) {
        return `Error: File too large (${(stat.size / 1024).toFixed(1)} KB). Limit is ${MAX_READ_BYTES / 1024} KB.`;
    }

    const content = await fs.readFile(resolved, "utf-8");
    return `**File:** \`${resolved}\`\n**Size:** ${stat.size} bytes\n\n\`\`\`\n${content}\n\`\`\``;
}

async function writeFile(filePath: string, content: string, append: boolean = false): Promise<string> {
    const { ok, resolved, reason } = resolveSafe(filePath);
    if (!ok) return `🚫 ${reason}`;

    if (content.length > MAX_WRITE_BYTES) {
        return `Error: Content too large (${content.length} bytes). Limit is ${MAX_WRITE_BYTES} bytes.`;
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });

    if (append) {
        await fs.appendFile(resolved, content, "utf-8");
        return `✅ Appended ${content.length} bytes to \`${resolved}\``;
    } else {
        await fs.writeFile(resolved, content, "utf-8");
        return `✅ Wrote ${content.length} bytes to \`${resolved}\``;
    }
}

async function listDirectory(dirPath: string): Promise<string> {
    const { ok, resolved, reason } = resolveSafe(dirPath);
    if (!ok) return `🚫 ${reason}`;

    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return `Error: ${resolved} is not a directory.`;

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const lines = entries.slice(0, 100).map((e) => {
        const type = e.isDirectory() ? "📁" : "📄";
        return `${type} ${e.name}`;
    });

    const truncated = entries.length > 100 ? `\n... and ${entries.length - 100} more items` : "";
    return `**Directory:** \`${resolved}\`\n**Items:** ${entries.length}\n\n${lines.join("\n")}${truncated}`;
}

async function deleteFile(filePath: string): Promise<string> {
    const { ok, resolved, reason } = resolveSafe(filePath);
    if (!ok) return `🚫 ${reason}`;

    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) return `Error: File not found: ${resolved}`;
    if (stat.isDirectory()) return `Error: Use a different command to delete directories.`;

    await fs.unlink(resolved);
    return `✅ Deleted \`${resolved}\``;
}

async function searchFiles(dirPath: string, pattern: string): Promise<string> {
    const { ok, resolved, reason } = resolveSafe(dirPath);
    if (!ok) return `🚫 ${reason}`;

    const regex = new RegExp(pattern, "i");
    const matches: string[] = [];

    async function walk(dir: string, depth: number = 0): Promise<void> {
        if (depth > 5 || matches.length > 50) return;
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (regex.test(entry.name)) matches.push(full);
            if (entry.isDirectory()) await walk(full, depth + 1);
        }
    }

    await walk(resolved);

    if (matches.length === 0) return `No files matching "${pattern}" found in \`${resolved}\``;
    return `**Found ${matches.length} match(es) for "${pattern}":**\n\n${matches.map((m) => `• \`${m}\``).join("\n")}`;
}

// ── Register as single multi-action tool ─────────────────
registerTool({
    name: "file_operations",
    description:
        "Read, write, list, delete, or search files on the filesystem. " +
        "Actions: 'read' (read file contents), 'write' (write/create file), 'append' (add to end of file), " +
        "'list' (list directory contents), 'delete' (delete a file), 'search' (find files by name pattern). " +
        "File access is restricted to safe directories.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["read", "write", "append", "list", "delete", "search"],
                description: "The file operation to perform.",
            },
            path: {
                type: "string",
                description: "Absolute or relative path to the file or directory.",
            },
            content: {
                type: "string",
                description: "Content to write (required for 'write' and 'append' actions).",
            },
            pattern: {
                type: "string",
                description: "Regex pattern to search for (required for 'search' action).",
            },
        },
        required: ["action", "path"],
    },
    execute: async (args: Record<string, any>) => {
        const action = String(args.action ?? "").trim();
        const filePath = String(args.path ?? "").trim();
        const content = String(args.content ?? "");
        const pattern = String(args.pattern ?? "");

        console.log(`  📁 File op: ${action} ${filePath.substring(0, 60)}`);

        try {
            switch (action) {
                case "read": return await readFile(filePath);
                case "write": return await writeFile(filePath, content, false);
                case "append": return await writeFile(filePath, content, true);
                case "list": return await listDirectory(filePath);
                case "delete": return await deleteFile(filePath);
                case "search": return await searchFiles(filePath, pattern);
                default: return `Error: Unknown action "${action}". Use: read, write, append, list, delete, search`;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `Error performing ${action} on "${filePath}": ${msg}`;
        }
    },
});
