/**
 * vector-memory.ts — Semantic Long-Term Memory for Gravity Claw
 *
 * Architecture:
 *   - Every user/assistant message is embedded (text-embedding-3-small)
 *   - Embeddings are stored in Qdrant running locally on the server
 *   - On each new message, the top-K most semantically relevant past
 *     memories are retrieved and injected into the agent's context
 *
 * This gives the bot near-perfect recall of anything ever discussed,
 * retrieved by *meaning* not just recency.
 */

import { LLM_API_KEY, LLM_BASE_URL, QDRANT_URL } from "./config.js";

// ── Constants ────────────────────────────────────────────
const COLLECTION_NAME = "gravity_claw_memories";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536; // text-embedding-3-small produces 1536-dim vectors
const TOP_K_RESULTS = 5;    // How many past memories to recall per query
const MIN_SCORE = 0.4;      // Minimum similarity score to include a memory

// ── Types ────────────────────────────────────────────────
interface MemoryPayload {
    chatId: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

interface QdrantSearchResult {
    id: string | number;
    score: number;
    payload: MemoryPayload;
}

// ── Embedding via OpenAI-compatible API ──────────────────
async function embed(text: string): Promise<number[]> {
    const response = await fetch(`${LLM_BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${LLM_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: text.slice(0, 8000), // Cap at 8k chars to avoid token limits
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Embedding API error: ${response.status} — ${err}`);
    }

    const data = await response.json() as any;
    return data.data[0].embedding as number[];
}

// ── Qdrant HTTP API helpers ──────────────────────────────
async function qdrantRequest(
    method: string,
    path: string,
    body?: unknown
): Promise<any> {
    const response = await fetch(`${QDRANT_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Qdrant ${method} ${path} failed: ${response.status} — ${err}`);
    }

    return response.json();
}

// ── Initialize Qdrant collection if it doesn't exist ─────
export async function initVectorMemory(): Promise<void> {
    try {
        // Check if collection exists
        const existing = await qdrantRequest("GET", `/collections/${COLLECTION_NAME}`).catch(() => null);

        if (!existing || existing.status === "error") {
            console.log(`  🧠 Vector Memory: Creating Qdrant collection "${COLLECTION_NAME}"...`);
            await qdrantRequest("PUT", `/collections/${COLLECTION_NAME}`, {
                vectors: {
                    size: EMBEDDING_DIM,
                    distance: "Cosine",
                },
                optimizers_config: {
                    default_segment_number: 2,
                },
                replication_factor: 1,
            });

            // Create payload index for fast filtering by chatId
            await qdrantRequest("PUT", `/collections/${COLLECTION_NAME}/index`, {
                field_name: "chatId",
                field_schema: "keyword",
            });

            console.log(`  ✅ Vector Memory: Collection created.`);
        } else {
            const info = existing.result;
            const count = info?.vectors_count ?? "?";
            console.log(`  ✅ Vector Memory: Collection ready (${count} memories stored).`);
        }
    } catch (err: any) {
        console.error(`  ❌ Vector Memory: Init failed — ${err.message}`);
        console.error(`     Qdrant URL: ${QDRANT_URL} — is Docker running?`);
    }
}

// ── Store a message as a memory ──────────────────────────
export async function rememberMessage(
    chatId: string | number,
    role: "user" | "assistant",
    content: string
): Promise<void> {
    // Skip empty content, tool calls, and very short messages
    if (!content || content.trim().length < 10) return;
    // Don't embed tool result content (it's noise)
    if (content.startsWith("{\"error\"") || content.startsWith("[{\"type\"")) return;

    try {
        const vector = await embed(content);
        const id = Date.now() + Math.floor(Math.random() * 1000); // Unique ID

        await qdrantRequest("PUT", `/collections/${COLLECTION_NAME}/points`, {
            points: [
                {
                    id,
                    vector,
                    payload: {
                        chatId: String(chatId),
                        role,
                        content,
                        timestamp: Math.floor(Date.now() / 1000),
                    } satisfies MemoryPayload,
                },
            ],
        });

        console.log(`  💾 Vector Memory: Stored ${role} message (${content.length} chars)`);
    } catch (err: any) {
        // Non-fatal — bot continues without storing this memory
        console.error(`  ⚠️ Vector Memory: Failed to store memory — ${err.message}`);
    }
}

// ── Recall semantically relevant past memories ───────────
export async function recallMemories(
    chatId: string | number,
    query: string,
    limit: number = TOP_K_RESULTS
): Promise<string[]> {
    if (!query || query.trim().length < 5) return [];

    try {
        const queryVector = await embed(query);

        const result = await qdrantRequest("POST", `/collections/${COLLECTION_NAME}/points/search`, {
            vector: queryVector,
            filter: {
                must: [
                    {
                        key: "chatId",
                        match: { value: String(chatId) },
                    },
                ],
            },
            limit,
            score_threshold: MIN_SCORE,
            with_payload: true,
        });

        if (!result.result || result.result.length === 0) return [];

        const memories: string[] = result.result
            .filter((r: QdrantSearchResult) => r.score >= MIN_SCORE)
            .map((r: QdrantSearchResult) => {
                const ts = new Date(r.payload.timestamp * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                });
                return `[${ts}, ${r.payload.role}]: ${r.payload.content}`;
            });

        console.log(`  🔍 Vector Memory: Recalled ${memories.length} relevant memories for query.`);
        return memories;
    } catch (err: any) {
        console.error(`  ⚠️ Vector Memory: Recall failed — ${err.message}`);
        return [];
    }
}

// ── Get total memory count for a chat ───────────────────
export async function getMemoryCount(chatId: string | number): Promise<number> {
    try {
        const result = await qdrantRequest("POST", `/collections/${COLLECTION_NAME}/points/count`, {
            filter: {
                must: [{ key: "chatId", match: { value: String(chatId) } }],
            },
            exact: true,
        });
        return result.result?.count ?? 0;
    } catch {
        return 0;
    }
}

// ── Delete all memories for a chat (on /new command) ────
export async function clearVectorMemory(chatId: string | number): Promise<void> {
    try {
        await qdrantRequest("POST", `/collections/${COLLECTION_NAME}/points/delete`, {
            filter: {
                must: [{ key: "chatId", match: { value: String(chatId) } }],
            },
        });
        console.log(`  🗑️ Vector Memory: Cleared all memories for chat ${chatId}`);
    } catch (err: any) {
        console.error(`  ⚠️ Vector Memory: Clear failed — ${err.message}`);
    }
}
