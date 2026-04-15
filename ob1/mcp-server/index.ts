import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { Pool } from "postgres";
import { z } from "zod";

const DB_HOST = Deno.env.get("DB_HOST") || "ob1-db";
const DB_PORT = parseInt(Deno.env.get("DB_PORT") || "5432", 10);
const DB_NAME = Deno.env.get("DB_NAME") || "openbrain";
const DB_USER = Deno.env.get("DB_USER") || "ob1";
const DB_PASSWORD = Deno.env.get("DB_PASSWORD") || "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") || "";
const DEFAULT_SCHEMA = Deno.env.get("OB1_SCHEMA") || "public";
const EMBEDDING_API_BASE = Deno.env.get("EMBEDDING_API_BASE") || "https://openrouter.ai/api/v1";
const EMBEDDING_API_KEY = Deno.env.get("EMBEDDING_API_KEY") || Deno.env.get("OPENROUTER_API_KEY") || "";
const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") || "openai/text-embedding-3-small";

if (!DB_PASSWORD || !EMBEDDING_API_KEY) {
  throw new Error("Missing required env vars: DB_PASSWORD, EMBEDDING_API_KEY/OPENROUTER_API_KEY");
}

const pool = new Pool({ hostname: DB_HOST, port: DB_PORT, database: DB_NAME, user: DB_USER, password: DB_PASSWORD }, 20, true);

function ensureSchema(raw: string) {
  const schema = raw.trim().replace(/-/g, "_");
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid schema");
  return schema;
}

async function withSchema<T>(schema: string, fn: (client: PoolClientLike) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.queryObject("SELECT set_config('search_path', $1, false)", [`${schema},public`]);
    return await fn(client);
  } finally {
    client.release();
  }
}

type PoolClientLike = {
  queryObject: (query: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: () => void;
};

async function getEmbedding(input: string): Promise<number[]> {
  const r = await fetch(`${EMBEDDING_API_BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${EMBEDDING_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input })
  });
  if (!r.ok) throw new Error(`Embedding API failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.data[0].embedding as number[];
}

function registerTools(server: McpServer, schema: string) {
  server.registerTool("search_thoughts", { title: "Search Thoughts", description: "Semantic search in OB1 schema", inputSchema: { query: z.string(), threshold: z.number().default(0.5), limit: z.number().default(10) } }, async ({ query, threshold, limit }) => {
    const emb = `[${(await getEmbedding(query)).join(",")}]`;
    const rows = await withSchema(schema, (c) => c.queryObject("SELECT content, metadata, created_at, 1 - (embedding <=> $1::vector) AS similarity FROM thoughts WHERE 1 - (embedding <=> $1::vector) >= $2 ORDER BY embedding <=> $1::vector LIMIT $3", [emb, threshold, limit]));
    const text = rows.rows.length ? rows.rows.map((r, i) => `${i + 1}. ${(Number(r.similarity) * 100).toFixed(1)}% | ${new Date(String(r.created_at)).toISOString()}\n${String(r.content)}`).join("\n\n") : `No thoughts found for \"${query}\".`;
    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("list_thoughts", { title: "List Thoughts", description: "List recent thoughts", inputSchema: { limit: z.number().default(10), days: z.number().optional() } }, async ({ limit, days }) => {
    const sql = days ? "SELECT content, metadata, created_at FROM thoughts WHERE created_at >= NOW() - ($1::text || ' days')::interval ORDER BY created_at DESC LIMIT $2" : "SELECT content, metadata, created_at FROM thoughts ORDER BY created_at DESC LIMIT $1";
    const args = days ? [String(days), limit] : [limit];
    const rows = await withSchema(schema, (c) => c.queryObject(sql, args));
    const text = rows.rows.length ? rows.rows.map((r, i) => `${i + 1}. [${new Date(String(r.created_at)).toISOString()}] ${String(r.content)}`).join("\n\n") : "No thoughts found.";
    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("thought_stats", { title: "Thought Stats", description: "Count and latest thought in schema", inputSchema: {} }, async () => {
    const count = await withSchema(schema, (c) => c.queryObject("SELECT COUNT(*)::int AS count FROM thoughts"));
    const last = await withSchema(schema, (c) => c.queryObject("SELECT created_at FROM thoughts ORDER BY created_at DESC LIMIT 1"));
    return { content: [{ type: "text" as const, text: `Schema: ${schema}\nTotal thoughts: ${Number(count.rows[0]?.count || 0)}\nLatest: ${String(last.rows[0]?.created_at || "N/A")}` }] };
  });

  server.registerTool("capture_thought", { title: "Capture Thought", description: "Insert thought with embedding", inputSchema: { content: z.string(), metadata: z.record(z.string(), z.unknown()).optional() } }, async ({ content, metadata }) => {
    const emb = `[${(await getEmbedding(content)).join(",")}]`;
    await withSchema(schema, (c) => c.queryObject("INSERT INTO thoughts(content, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)", [content, emb, JSON.stringify(metadata || {})]));
    return { content: [{ type: "text" as const, text: `Captured thought in schema ${schema}.` }] };
  });
}

const app = new Hono();
app.all("*", async (c) => {
  const key = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key") || "";
  if (MCP_ACCESS_KEY && key !== MCP_ACCESS_KEY) return c.json({ error: "Invalid or missing access key" }, 401);
  const schema = ensureSchema(c.req.header("x-ob1-schema") || new URL(c.req.url).searchParams.get("schema") || DEFAULT_SCHEMA);
  const server = new McpServer({ name: `ob1-${schema}`, version: "1.0.0" });
  registerTools(server, schema);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve({ port: parseInt(Deno.env.get("PORT") || "8000", 10) }, app.fetch);
