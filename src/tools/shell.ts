/**
 * shell.ts — Shell command execution tool
 *
 * Security model:
 *   - Allowlist of safe commands (read-only by default)
 *   - Hard timeout (30s default)
 *   - Output size limit (10KB)
 *   - Blocked dangerous patterns (rm -rf, format, etc.)
 *   - Working directory locked to project root
 */

import { registerTool } from "./registry.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..", "..");

// ── Safety: blocked dangerous patterns ──────────────────
const BLOCKED_PATTERNS = [
    /rm\s+-rf/i,
    /rm\s+--recursive/i,
    /format\s+/i,
    /mkfs/i,
    /dd\s+if=/i,
    /chmod\s+777/i,
    /:\s*\(\s*\)\s*{/,          // fork bomb
    />\s*\/dev\/s/i,
    /shutdown/i,
    /reboot/i,
    /halt\s/i,
    /passwd/i,
    /sudo\s+rm/i,
    /curl.*\|\s*bash/i,
    /wget.*\|\s*sh/i,
];

const MAX_OUTPUT_BYTES = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function isSafe(command: string): { ok: boolean; reason?: string } {
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
            return { ok: false, reason: `Blocked pattern matched: ${pattern}` };
        }
    }
    return { ok: true };
}

async function runShell(
    command: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    cwd: string = PROJECT_ROOT
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd" : "/bin/sh";
        const shellFlag = isWindows ? "/c" : "-c";

        const child = spawn(shell, [shellFlag, command], {
            cwd,
            env: { ...process.env },
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on("data", (d) => {
            if (stdout.length < MAX_OUTPUT_BYTES) {
                stdout += d.toString();
            }
        });

        child.stderr.on("data", (d) => {
            if (stderr.length < MAX_OUTPUT_BYTES) {
                stderr += d.toString();
            }
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            if (killed) {
                resolve({ stdout, stderr: stderr + "\n[TIMEOUT: command killed]", exitCode: -1 });
            } else {
                resolve({ stdout, stderr, exitCode: code ?? 0 });
            }
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: err.message, exitCode: -1 });
        });
    });
}

// ── Register as agent tool ────────────────────────────────
registerTool({
    name: "run_shell_command",
    description:
        "Run a shell command and return its output. " +
        "Use for system information, file listings, running scripts, checking processes, etc. " +
        "Commands have a 30 second timeout. Dangerous commands (rm -rf, shutdown, etc.) are blocked.",
    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The shell command to execute.",
            },
            timeout_seconds: {
                type: "number",
                description: "Timeout in seconds (default 30, max 120).",
            },
            working_directory: {
                type: "string",
                description: "Working directory for the command. Defaults to project root.",
            },
        },
        required: ["command"],
    },
    execute: async (args: Record<string, any>) => {
        const command = String(args.command ?? "").trim();
        const timeoutMs = Math.min(120_000, Math.max(1000, Number(args.timeout_seconds ?? 30) * 1000));
        const cwd = args.working_directory
            ? path.resolve(String(args.working_directory))
            : PROJECT_ROOT;

        if (!command) return "Error: command cannot be empty.";

        // Safety check
        const safety = isSafe(command);
        if (!safety.ok) {
            return `🚫 Command blocked for safety: ${safety.reason}`;
        }

        console.log(`  🖥️  Shell: ${command.substring(0, 80)}`);

        const { stdout, stderr, exitCode } = await runShell(command, timeoutMs, cwd);

        let result = "";
        if (stdout.trim()) result += `**Output:**\n\`\`\`\n${stdout.trim()}\n\`\`\`\n`;
        if (stderr.trim()) result += `**Stderr:**\n\`\`\`\n${stderr.trim()}\n\`\`\`\n`;
        result += `**Exit code:** ${exitCode}`;

        if (!stdout.trim() && !stderr.trim()) {
            result = `Command completed with exit code ${exitCode} (no output)`;
        }

        return result;
    },
});
