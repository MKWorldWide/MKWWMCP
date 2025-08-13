import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCKER_IMAGE = "ghcr.io/github/github-mcp-server:latest";
const LOG_LEVEL = process.env.LOG_LEVEL || "warn";
const PAT = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

if (!PAT && process.argv[2] !== "format") {
  console.error("ERROR: GITHUB_PERSONAL_ACCESS_TOKEN not set.");
  process.exit(1);
}

// Simple line-buffered reader for JSON-RPC over stdio
function createJsonRpc(io) {
  let buf = "";
  const handlers = new Map();
  let nextId = 1;

  io.stdout.setEncoding("utf8");
  io.stdout.on("data", (chunk) => {
    buf += chunk;
    // server emits one JSON object per line
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && handlers.has(msg.id)) {
          const { resolve, reject } = handlers.get(msg.id);
          handlers.delete(msg.id);
          if ("error" in msg) reject(msg.error);
          else resolve(msg.result ?? msg);
        } else {
          // Notifications / logs — print at debug
          if (process.env.DEBUG_JSON) console.error("<<", line);
        }
      } catch (e) {
        console.error("Failed to parse:", line);
      }
    }
  });

  function call(method, params = {}) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    if (process.env.DEBUG_JSON) console.error(">>", payload.trim());
    io.stdin.write(payload);
    return new Promise((resolve, reject) => handlers.set(id, { resolve, reject }));
  }

  return { call };
}

// Start dockerized MCP server (stdio)
function startMcpDocker() {
  const args = [
    "run",
    "--pull=always",
    "-i",
    "--rm",
    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
    "-e", `LOG_LEVEL=${LOG_LEVEL}`,
    DOCKER_IMAGE
  ];
  const proc = spawn("docker", args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: PAT }
  });
  proc.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`MCP server exited with code ${code}`);
    }
  });
  return proc;
}

// Minimal MCP handshake + tool calls
async function runMcp(action, actionArg) {
  const server = startMcpDocker();
  const rpc = createJsonRpc(server);

  // 1) initialize
  await rpc.call("initialize", {
    protocolVersion: "2024-07-18",
    capabilities: { tools: {} },
    clientInfo: { name: "mcp-driver", version: "0.1.0" }
  });

  // 2) depending on action
  if (action === "tools/list") {
    const res = await rpc.call("tools/list", {});
    console.log(JSON.stringify(res, null, 2));
  } else if (action === "call") {
    // actionArg: { name, argsJSON }
    const [toolName, argsRaw] = parseCallArgs(actionArg);
    const toolArgs = argsRaw ? JSON.parse(argsRaw) : {};
    const res = await rpc.call("tools/call", { name: toolName, arguments: toolArgs });
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.error(`Unknown action: ${action}`);
  }

  server.stdin.end();
}

function parseCallArgs(argStr) {
  // Expect: `<toolName> '<json>'` OR `<toolName>`
  const parts = [];
  let current = "";
  let inQuotes = false;
  let quote = null;
  for (let i = 0; i < argStr.length; i++) {
    const c = argStr[i];
    if ((c === "'" || c === '"') && !inQuotes) {
      inQuotes = true; quote = c;
    } else if (inQuotes && c === quote) {
      inQuotes = false; quote = null;
    } else if (!inQuotes && /\s/.test(c)) {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += c;
    }
  }
  if (current) parts.push(current);
  const toolName = parts[0];
  const jsonArg = parts.slice(1).join(" ");
  return [toolName, jsonArg || null];
}

// Pretty formatter for repo list → Markdown table
function formatReposToMarkdown(inPath, outPath) {
  const raw = fs.readFileSync(inPath, "utf8");
  const data = JSON.parse(raw);

  // GitHub MCP returns { content: [{type:"text", text:"..."}] } OR structured.
  // Try to decode repos from either a direct list or a wrapped result.
  let repos = [];
  if (Array.isArray(data)) repos = data;
  else if (Array.isArray(data.tools)) repos = data.tools;
  else if (data?.content && Array.isArray(data.content)) {
    // try to parse JSON from first text chunk
    const t = data.content.find(c => c.type === "text")?.text ?? "";
    try { repos = JSON.parse(t); } catch { /* noop */ }
  } else if (data?.result?.content) {
    const t = data.result.content.find(c => c.type === "text")?.text ?? "";
    try { repos = JSON.parse(t); } catch { /* noop */ }
  } else if (data?.result?.data) {
    repos = data.result.data;
  }

  // If it's the GitHub search payload, normalize common fields
  const norm = repos.map(r => ({
    name: r.name || r.full_name?.split("/").pop() || "unknown",
    visibility: (r.private === true || r.visibility === "private") ? "private" : "public",
    language: r.language || r.primaryLanguage || "—",
    pushedAt: r.pushed_at || r.pushedAt || r.updated_at || "—"
  }));

  const lines = [
    "# Repository Inventory",
    "",
    "| Repo | Visibility | Language | Last Push |",
    "|---|---|---|---|",
    ...norm.map(r =>
      `| ${r.name} | ${r.visibility} | ${r.language} | ${r.pushedAt} |`
    ),
    ""
  ];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
}

// entry
(async () => {
  const cmd = process.argv[2];
  const arg = process.argv.slice(3).join(" ");

  if (cmd === "tools/list") {
    await runMcp("tools/list");
  } else if (cmd === "call") {
    // example: node mcp-driver.js call search_repositories '{"q":"org:MKWorldWide","per_page":100}'
    await runMcp("call", arg);
  } else if (cmd === "format") {
    // example: node mcp-driver.js format out/mkww.repos.json out/mkww.inventory.md
    const inFile = process.argv[3];
    const outFile = process.argv[4] || "out/inventory.md";
    if (!inFile) {
      console.error("Usage: node mcp-driver.js format <input.json> [output.md]");
      process.exit(1);
    }
    formatReposToMarkdown(inFile, outFile);
  } else {
    console.log(`Usage:
  node mcp-driver.js tools/list
  node mcp-driver.js call <toolName> '<jsonArgs>'
  node mcp-driver.js format <input.json> [output.md]

Examples:
  node mcp-driver.js tools/list
  node mcp-driver.js call search_repositories '{"q":"org:MKWorldWide","per_page":100}'
  node mcp-driver.js format out/mkww.repos.json out/mkww.inventory.md
`);
  }
})();
