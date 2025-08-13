import { spawn, exec as _exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(_exec);
const { readFile, writeFile, readFileSync, writeFileSync, mkdirSync } = fs;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCKER_IMAGE = "ghcr.io/github/github-mcp-server:latest";
const LOG_LEVEL = process.env.LOG_LEVEL || "warn";
const PAT = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

const OUT_DIR = path.join(__dirname, "out");
const CACHE_DIR = path.join(__dirname, ".cache");

// Ensure directories exist
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

// ======================
// GitHub API Rate Limiting
// ======================
const RATE_LIMIT = {
  remaining: 60,
  reset: 0,
  lastUpdated: 0,
  
  async checkLimit() {
    const now = Date.now();
    if (now > this.reset) {
      // Reset rate limit counters if we're past the reset time
      this.remaining = 60;
      this.reset = now + 3600000; // 1 hour from now
    }
    
    if (this.remaining <= 0) {
      const waitTime = Math.ceil((this.reset - now) / 1000);
      console.log(`Rate limit reached. Waiting ${waitTime} seconds...`);
      await new Promise(resolve => setTimeout(resolve, (this.reset - now)));
      this.remaining = 60;
    }
    
    this.remaining--;
  },
  
  updateFromHeaders(headers) {
    if (headers['x-ratelimit-remaining']) {
      this.remaining = parseInt(headers['x-ratelimit-remaining'], 10);
      this.reset = parseInt(headers['x-ratelimit-reset'], 10) * 1000;
      this.lastUpdated = Date.now();
    }
  }
};

// ======================
// GitHub API Client
// ======================
class GitHubClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = 'https://api.github.com';
  }

  async request(endpoint, options = {}) {
    await RATE_LIMIT.checkLimit();
    
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `token ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MKWW-MCP-Driver',
      ...options.headers
    };

    const config = {
      method: 'GET',
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      RATE_LIMIT.updateFromHeaders(Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const error = new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.response = await response.json().catch(() => ({}));
        throw error;
      }
      
      return await response.json();
    } catch (error) {
      console.error(`GitHub API request failed: ${error.message}`);
      throw error;
    }
  }

  // Helper methods for common operations
  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  }

  async patch(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }

  // Repository operations
  async listRepos(org, type = 'all', sort = 'updated', direction = 'desc') {
    return this.get(`/orgs/${org}/repos?type=${type}&sort=${sort}&direction=${direction}&per_page=100`);
  }

  async getRepo(owner, repo) {
    return this.get(`/repos/${owner}/${repo}`);
  }

  // Issue operations
  async listIssues(owner, repo, state = 'open', labels = '') {
    const labelQuery = labels ? `&labels=${encodeURIComponent(labels)}` : '';
    return this.get(`/repos/${owner}/${repo}/issues?state=${state}${labelQuery}&per_page=100`);
  }

  async createIssue(owner, repo, title, body, labels = []) {
    return this.post(`/repos/${owner}/${repo}/issues`, { title, body, labels });
  }

  // Pull request operations
  async listPullRequests(owner, repo, state = 'open', sort = 'created', direction = 'desc') {
    return this.get(`/repos/${owner}/${repo}/pulls?state=${state}&sort=${sort}&direction=${direction}&per_page=100`);
  }

  async createPullRequest(owner, repo, title, head, base, body = '', draft = false) {
    return this.post(`/repos/${owner}/${repo}/pulls`, { title, head, base, body, draft });
  }

  // File operations
  async getFile(owner, repo, path, ref = 'main') {
    return this.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  }

  async createOrUpdateFile(owner, repo, path, message, content, sha = null, branch = 'main') {
    return this.put(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch
    });
  }

  // Workflow operations
  async listWorkflowRuns(owner, repo, workflowId, branch = '', event = '', status = '') {
    let url = `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`;
    const params = [];
    
    if (branch) params.push(`branch=${encodeURIComponent(branch)}`);
    if (event) params.push(`event=${encodeURIComponent(event)}`);
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    
    if (params.length) url += `?${params.join('&')}`;
    
    return this.get(url);
  }

  async rerunWorkflow(owner, repo, runId) {
    return this.post(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`);
  }
}

// Initialize GitHub client
const github = new GitHubClient(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '');

// ======================
// MCP Tool Definitions
// ======================
const TOOLS = {
  // Repository Management
  list_repositories: {
    description: 'List repositories in an organization',
    parameters: {
      org: { type: 'string', description: 'Organization name' },
      type: { type: 'string', enum: ['all', 'public', 'private', 'forks', 'sources', 'member'], default: 'all' },
      sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'], default: 'updated' },
      direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      per_page: { type: 'number', default: 30, maximum: 100 },
      page: { type: 'number', default: 1 }
    },
    execute: async ({ org, type, sort, direction, per_page, page }) => {
      const repos = await github.listRepos(org, type, sort, direction);
      return { repositories: repos };
    }
  },
  
  get_repository: {
    description: 'Get details about a repository',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' }
    },
    execute: async ({ owner, repo }) => {
      return github.getRepo(owner, repo);
    }
  },
  
  // Issue Management
  list_issues: {
    description: 'List issues in a repository',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
      labels: { type: 'string', description: 'Comma-separated list of label names' },
      sort: { type: 'string', enum: ['created', 'updated', 'comments'], default: 'created' },
      direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      since: { type: 'string', format: 'date-time', description: 'Only show notifications updated after the given time' },
      per_page: { type: 'number', default: 30, maximum: 100 },
      page: { type: 'number', default: 1 }
    },
    execute: async ({ owner, repo, state, labels, sort, direction, since, per_page, page }) => {
      return github.listIssues(owner, repo, state, labels);
    }
  },
  
  create_issue: {
    description: 'Create a new issue',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      title: { type: 'string', description: 'Issue title' },
      body: { type: 'string', description: 'Issue body' },
      labels: { type: 'array', items: { type: 'string' }, default: [] },
      assignees: { type: 'array', items: { type: 'string' }, default: [] },
      milestone: { type: ['number', 'null'], default: null },
      assignee: { type: ['string', 'null'], default: null }
    },
    execute: async ({ owner, repo, title, body, labels, assignees, milestone, assignee }) => {
      return github.createIssue(owner, repo, title, body, labels);
    }
  },
  
  // Pull Request Management
  list_pull_requests: {
    description: 'List pull requests in a repository',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
      head: { type: 'string', description: 'Filter by head user or head organization and branch name' },
      base: { type: 'string', description: 'Filter by base branch name' },
      sort: { type: 'string', enum: ['created', 'updated', 'popularity', 'long-running'], default: 'created' },
      direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      per_page: { type: 'number', default: 30, maximum: 100 },
      page: { type: 'number', default: 1 }
    },
    execute: async ({ owner, repo, state, head, base, sort, direction, per_page, page }) => {
      return github.listPullRequests(owner, repo, state, sort, direction);
    }
  },
  
  create_pull_request: {
    description: 'Create a new pull request',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      title: { type: 'string', description: 'Pull request title' },
      head: { type: 'string', description: 'The name of the branch where your changes are implemented' },
      base: { type: 'string', description: 'The name of the branch you want the changes pulled into' },
      body: { type: 'string', description: 'Pull request body/description', default: '' },
      maintainer_can_modify: { type: 'boolean', default: true },
      draft: { type: 'boolean', default: false },
      issue: { type: 'number', description: 'Issue number in the same repository to convert to a pull request' }
    },
    execute: async ({ owner, repo, title, head, base, body, maintainer_can_modify, draft, issue }) => {
      return github.createPullRequest(owner, repo, title, head, base, body, draft);
    }
  },
  
  // File Operations
  get_file: {
    description: 'Get the contents of a file or directory',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      path: { type: 'string', description: 'Path to the file or directory' },
      ref: { type: 'string', description: 'The name of the commit/branch/tag', default: 'main' }
    },
    execute: async ({ owner, repo, path, ref }) => {
      return github.getFile(owner, repo, path, ref);
    }
  },
  
  create_or_update_file: {
    description: 'Create or update a file',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      path: { type: 'string', description: 'Path to the file' },
      message: { type: 'string', description: 'Commit message' },
      content: { type: 'string', description: 'File content' },
      sha: { type: 'string', description: 'The blob SHA of the file being replaced (required when updating a file)' },
      branch: { type: 'string', description: 'Branch name', default: 'main' }
    },
    execute: async ({ owner, repo, path, message, content, sha, branch }) => {
      return github.createOrUpdateFile(owner, repo, path, message, content, sha, branch);
    }
  },
  
  // Workflow Operations
  list_workflow_runs: {
    description: 'List workflow runs',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      workflow_id: { type: 'string', description: 'The ID of the workflow' },
      branch: { type: 'string', description: 'Filter workflow runs by branch name' },
      event: { type: 'string', description: 'Filter workflow runs by event type' },
      status: { type: 'string', enum: ['completed', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'success', 'timed_out', 'in_progress', 'queued', 'requested', 'waiting', 'pending'], description: 'Filter workflow runs by status' },
      per_page: { type: 'number', default: 30, maximum: 100 },
      page: { type: 'number', default: 1 }
    },
    execute: async ({ owner, repo, workflow_id, branch, event, status, per_page, page }) => {
      return github.listWorkflowRuns(owner, repo, workflow_id, branch, event, status);
    }
  },
  
  rerun_workflow: {
    description: 'Re-run a workflow',
    parameters: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      run_id: { type: 'number', description: 'The ID of the workflow run' }
    },
    execute: async ({ owner, repo, run_id }) => {
      return github.rerunWorkflow(owner, repo, run_id);
    }
  },
  
  // Add more tools here following the same pattern...
};

// ======================
// JSON-RPC Helper
// ======================
/** ---------- JSON-RPC helper ---------- */
function createJsonRpc(io) {
  let buf = "";
  const handlers = new Map();
  let nextId = 1;

  io.stdout.setEncoding("utf8");
  io.stdout.on("data", (chunk) => {
    buf += chunk;
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

/** ---------- Start dockerized MCP server (stdio) ---------- */
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
    if (code && code !== 0) console.error(`MCP server exited with code ${code}`);
  });
  return proc;
}

/** ---------- Utility: infer placeholder args from JSON Schema ---------- */
function inferArgsFromSchema(schema) {
  if (!schema || typeof schema !== "object") return {};
  const out = {};
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  for (const [k, v] of Object.entries(props)) {
    // Try a sensible default
    const t = Array.isArray(v.type) ? v.type[0] : v.type;
    if (t === "string") out[k] = v.default ?? (required.has(k) ? "<REQUIRED_STRING>" : "");
    else if (t === "number" || t === "integer") out[k] = v.default ?? (required.has(k) ? 0 : 0);
    else if (t === "boolean") out[k] = v.default ?? false;
    else if (t === "array") out[k] = v.default ?? [];
    else if (t === "object") out[k] = v.default ?? {};
    else out[k] = v.default ?? null;
  }
  return out;
}

function toolHasRequiredArgs(schema) {
  if (!schema || typeof schema !== "object") return false;
  return (schema.required && schema.required.length > 0);
}

/** ---------- MCP run core ---------- */
async function withMcp(fn) {
  if (!PAT) {
    console.error("ERROR: GITHUB_PERSONAL_ACCESS_TOKEN not set.");
    process.exit(1);
  }
  const server = startMcpDocker();
  const rpc = createJsonRpc(server);

  await rpc.call("initialize", {
    protocolVersion: "2024-07-18",
    capabilities: { tools: {} },
    clientInfo: { name: "mcp-driver", version: "0.2.0" }
  });

  try {
    return await fn(rpc);
  } finally {
    try { server.stdin.end(); } catch {}
  }
}

/** ---------- Commands ---------- */
async function listTools() {
  return withMcp(async (rpc) => {
    const res = await rpc.call("tools/list", {});
    const outPath = path.join(OUT_DIR, "tools.list.json");
    fs.writeFileSync(outPath, JSON.stringify(res, null, 2), "utf8");
    console.log(`Wrote ${outPath}`);
    return res;
  });
}

async function callTool(toolName, argsObj = {}, timeoutMs = 60000) {
  return withMcp(async (rpc) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await rpc.call("tools/call", { name: toolName, arguments: argsObj });
      console.log(JSON.stringify(result, null, 2));
      return result;
    } finally {
      clearTimeout(t);
    }
  });
}

/** Plan = array of { name, args, run: true|false, note } */
async function generatePlan() {
  const toolsList = await listTools();
  const tools = toolsList?.tools ?? []; // {name, description, inputSchema?}
  const plan = tools.map((t) => {
    const args = inferArgsFromSchema(t.inputSchema);
    const needs = toolHasRequiredArgs(t.inputSchema);
    // Default policy: run if no required args; otherwise pause for human edit
    const run = !needs;
    return {
      name: t.name,
      description: t.description || "",
      args,
      run,
      note: needs ? "Has required args — review and fill before execution." : "Safe to run with defaults."
    };
  });

  // Heuristics: If a tool name implies a search/list in GitHub, nudge an example
  for (const item of plan) {
    const n = item.name.toLowerCase();
    if (/(search|list).*repo/.test(n) || /repositories/.test(n)) {
      if (item.args.q !== undefined) item.args.q = "org:MKWorldWide";
      if (item.args.organization !== undefined) item.args.organization = "MKWorldWide";
      if (item.args.per_page !== undefined) item.args.per_page = 100;
      item.run = true; // generally safe
    }
  }

  const outPath = path.join(OUT_DIR, "tools.plan.json");
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), plan }, null, 2));
  console.log(`Wrote ${outPath}`);
}

async function executePlan(concurrency = Math.max(2, os.cpus().length - 1), timeoutMs = 60000) {
  const planPath = path.join(OUT_DIR, "tools.plan.json");
  if (!fs.existsSync(planPath)) {
    console.error("No plan found. Run: node mcp-driver.js plan:generate");
    process.exit(1);
  }
  const { plan } = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const toRun = plan.filter(p => p.run);

  console.log(`Executing ${toRun.length} tools (of ${plan.length}) with concurrency=${concurrency} …`);

  // simple pool
  const queue = [...toRun];
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        const res = await callTool(job.name, job.args, timeoutMs);
        results.push({ name: job.name, ok: true, res });
      } catch (err) {
        results.push({ name: job.name, ok: false, err });
        console.error(`❌ ${job.name}:`, err?.message || err);
      }
    }
  });
  await Promise.all(workers);

  const out = { executedAt: new Date().toISOString(), results: results.map(r => ({ name: r.name, ok: r.ok })) };
  const outPath = path.join(OUT_DIR, "tools.results.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

async function runAllSafe() {
  // one-shot that lists, filters by no required args, and runs immediately
  const toolsList = await listTools();
  const tools = toolsList?.tools ?? [];
  const auto = tools.filter(t => !toolHasRequiredArgs(t.inputSchema));
  console.log(`Auto-running ${auto.length} tools (no required args)…`);
  const results = [];
  for (const t of auto) {
    try {
      const args = inferArgsFromSchema(t.inputSchema);
      const res = await callTool(t.name, args, 45000);
      results.push({ name: t.name, ok: true, res: !!res });
    } catch (e) {
      results.push({ name: t.name, ok: false, err: e?.message || String(e) });
    }
  }
  const outPath = path.join(OUT_DIR, "tools.safe.results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${outPath}`);
}

/** ---------- Formatting (unchanged from prior) ---------- */
function formatReposToMarkdown(inPath, outPath) {
  const raw = fs.readFileSync(inPath, "utf8");
  const data = JSON.parse(raw);
  let repos = [];
  if (Array.isArray(data)) repos = data;
  else if (data?.content && Array.isArray(data.content)) {
    const t = data.content.find(c => c.type === "text")?.text ?? "";
    try { repos = JSON.parse(t); } catch {}
  } else if (data?.result?.content) {
    const t = data.result.content.find(c => c.type === "text")?.text ?? "";
    try { repos = JSON.parse(t); } catch {}
  } else if (data?.result?.data) {
    repos = data.result.data;
  }
}

/** ---------- CLI ---------- */
(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(" ");

  try {
    if (cmd === "tools/list") {
      await listTools();
    } else if (cmd === "call") {
      // node mcp-driver.js call <toolName> '<jsonArgs>'
      const firstSpace = arg.indexOf(" ");
      const toolName = firstSpace === -1 ? arg : arg.slice(0, firstSpace);
      const argsRaw = firstSpace === -1 ? "{}" : arg.slice(firstSpace + 1);
      const argsObj = argsRaw ? JSON.parse(argsRaw) : {};
      await callTool(toolName, argsObj, 60000);
    } else if (cmd === "plan:generate") {
      await generatePlan();
    } else if (cmd === "plan:execute") {
      const c = Number(process.env.MCP_CONCURRENCY || 4);
      const t = Number(process.env.MCP_TIMEOUT_MS || 60000);
      await executePlan(c, t);
    } else if (cmd === "run-all-safe") {
      await runAllSafe();
    } else if (cmd === "format") {
      const inFile = rest[0];
      const outFile = rest[1] || "out/inventory.md";
      if (!inFile) {
        console.error("Usage: node mcp-driver.js format <input.json> [output.md]");
        process.exit(1);
      }
      formatReposToMarkdown(inFile, outFile);
    } else {
      console.log(`Usage:
  node mcp-driver.js tools/list
  node mcp-driver.js call <toolName> '<jsonArgs>'
  node mcp-driver.js plan:generate
  node mcp-driver.js plan:execute
  node mcp-driver.js run-all-safe
  node mcp-driver.js format <input.json> [output.md]

Examples:
  node mcp-driver.js plan:generate
  node mcp-driver.js plan:execute
  node mcp-driver.js run-all-safe
  node mcp-driver.js call search_repositories '{"q":"org:MKWorldWide","per_page":100}'
`);
    }
  } catch (e) {
    console.error("ERROR:", e?.message || e);
    process.exit(1);
  }
})();
