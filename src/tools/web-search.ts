/**
 * web-search.ts — Web search tool using Brave Search API
 *
 * Falls back to DuckDuckGo instant answers if no Brave API key is set.
 * Registered as an agent tool so the LLM can call it autonomously.
 */

import { registerTool } from "./registry.js";
import { BRAVE_SEARCH_API_KEY } from "../config.js";

// ── Brave Search ─────────────────────────────────────────
async function braveSearch(query: string, count: number = 5): Promise<string> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("text_decorations", "false");
    url.searchParams.set("search_lang", "en");

    const res = await fetch(url.toString(), {
        headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_SEARCH_API_KEY!,
        },
    });

    if (!res.ok) {
        throw new Error(`Brave Search API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as any;
    const results = data?.web?.results ?? [];

    if (results.length === 0) return "No results found.";

    return results
        .slice(0, count)
        .map((r: any, i: number) =>
            `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description ?? ""}`
        )
        .join("\n\n");
}

// ── DuckDuckGo Instant Answer fallback ───────────────────
async function duckduckgoSearch(query: string): Promise<string> {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const res = await fetch(url.toString(), {
        headers: { "User-Agent": "GravityClaw/1.0" },
    });

    if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`);

    const data = await res.json() as any;

    const parts: string[] = [];

    // Instant answer (e.g. calculations, definitions)
    if (data.Answer) {
        parts.push(`**Instant Answer:** ${data.Answer}`);
    }

    // Abstract (encyclopedic summary)
    if (data.AbstractText) {
        parts.push(`**Summary:** ${data.AbstractText}\nSource: ${data.AbstractURL}`);
    }

    // Related topics
    if (data.RelatedTopics?.length > 0) {
        const topics = data.RelatedTopics
            .filter((t: any) => t.Text)
            .slice(0, 5)
            .map((t: any, i: number) => `${i + 1}. ${t.Text}${t.FirstURL ? `\n   ${t.FirstURL}` : ""}`)
            .join("\n\n");
        if (topics) parts.push(`**Related:**\n${topics}`);
    }

    if (parts.length === 0) {
        return `No instant answer found for "${query}". Try a more specific query or ask me to search with Brave Search (requires API key).`;
    }

    return parts.join("\n\n");
}

// ── Combined search function ──────────────────────────────
async function webSearch(query: string, count: number = 5): Promise<string> {
    if (BRAVE_SEARCH_API_KEY) {
        return await braveSearch(query, count);
    }
    return await duckduckgoSearch(query);
}

// ── Register as agent tool ────────────────────────────────
registerTool({
    name: "web_search",
    description:
        "Search the web for current information, news, facts, or anything you don't know. " +
        "Use this for recent events, prices, weather, or any real-time information. " +
        "Returns titles, URLs, and descriptions of top results.",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The search query. Be specific for better results.",
            },
            count: {
                type: "number",
                description: "Number of results to return (1-10). Default is 5.",
            },
        },
        required: ["query"],
    },
    execute: async (args: Record<string, any>) => {
        const query = String(args.query ?? "");
        const count = Math.min(10, Math.max(1, Number(args.count ?? 5)));

        if (!query.trim()) return "Error: search query cannot be empty.";

        console.log(`  🔍 Web search: "${query}" (${count} results)`);
        return await webSearch(query, count);
    },
});
