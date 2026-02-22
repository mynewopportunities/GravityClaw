/**
 * usage.ts — Per-call token, cost, and latency tracking
 *
 * Records every LLM API call to SQLite and exposes
 * summary statistics for the /usage command.
 */

import { db } from "./db.js";
// Cost table only — no config import needed here

// ── Cost table (USD per 1M tokens) ───────────────────────
// Approximate prices; update as needed
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-opus-4-6": { input: 15.0, output: 75.0 },
    "gpt-4o": { input: 5.0, output: 15.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "default": { input: 3.0, output: 15.0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const prices = COST_PER_MILLION[model] ?? COST_PER_MILLION["default"];
    return (inputTokens / 1_000_000) * prices.input
        + (outputTokens / 1_000_000) * prices.output;
}

// ── Track a single LLM call ───────────────────────────────
export function trackUsage(params: {
    chatId: string | number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
}): void {
    const cid = String(params.chatId);
    const cost = estimateCost(params.model, params.inputTokens, params.outputTokens);
    db.prepare(`
        INSERT INTO usage_log (chat_id, model, input_tokens, output_tokens, latency_ms, cost_usd)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        cid,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.latencyMs,
        cost
    );
}

// ── Get usage summary ─────────────────────────────────────
export function getUsageSummary(chatId?: string | number): string {
    const cid = chatId != null ? String(chatId) : null;
    const whereClause = cid != null ? "WHERE chat_id = ?" : "";
    const args = cid != null ? [cid] : [];

    const totals = db.prepare(`
        SELECT
            COUNT(*)            AS calls,
            SUM(input_tokens)   AS input_tokens,
            SUM(output_tokens)  AS output_tokens,
            SUM(cost_usd)       AS cost_usd,
            AVG(latency_ms)     AS avg_latency_ms
        FROM usage_log
        ${whereClause}
    `).get(...args) as any;

    const today = db.prepare(`
        SELECT
            COUNT(*)            AS calls,
            SUM(cost_usd)       AS cost_usd
        FROM usage_log
        ${whereClause ? whereClause + " AND" : "WHERE"} date(created_at, 'unixepoch') = date('now')
    `).get(...args) as any;

    const modelBreakdown = db.prepare(`
        SELECT model, COUNT(*) AS calls, SUM(cost_usd) AS cost_usd
        FROM usage_log
        ${whereClause}
        GROUP BY model
        ORDER BY cost_usd DESC
    `).all(...args) as any[];

    const totalCost = totals.cost_usd ?? 0;
    const todayCost = today.cost_usd ?? 0;
    const totalInput = totals.input_tokens ?? 0;
    const totalOutput = totals.output_tokens ?? 0;
    const avgLatency = totals.avg_latency_ms ?? 0;

    let msg = `📊 **Usage Summary**\n\n`;
    msg += `**All Time**\n`;
    msg += `• Calls: ${totals.calls ?? 0}\n`;
    msg += `• Input tokens: ${totalInput.toLocaleString()}\n`;
    msg += `• Output tokens: ${totalOutput.toLocaleString()}\n`;
    msg += `• Est. cost: $${totalCost.toFixed(4)}\n`;
    msg += `• Avg latency: ${Math.round(avgLatency)}ms\n\n`;

    msg += `**Today**\n`;
    msg += `• Calls: ${today.calls ?? 0}\n`;
    msg += `• Est. cost: $${todayCost.toFixed(4)}\n\n`;

    if (modelBreakdown.length > 0) {
        msg += `**By Model**\n`;
        for (const row of modelBreakdown) {
            msg += `• \`${row.model}\`: ${row.calls} calls, $${row.cost_usd.toFixed(4)}\n`;
        }
    }

    return msg;
}
