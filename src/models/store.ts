import { Pool } from 'pg';

// Single Postgres connection pool for persistence.
export const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

export type Idea = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  targets: string[];
  source: string;
  createdAt: string;
};

export type Task = {
  id: string;
  kind: 'deploy' | 'post' | 'dispatch' | 'osc';
  payload: Record<string, any>;
  status: 'queued' | 'running' | 'done' | 'error';
  runId?: string;
};

export type Run = {
  id: string;
  ideaId?: string;
  plan: string;
  steps: string[];
  result?: string;
  logs: string[];
  startedAt: string;
  endedAt?: string;
};

// Ensure tables exist. Called on server bootstrap.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      tags JSONB,
      targets JSONB,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      idea_id TEXT REFERENCES ideas(id),
      plan TEXT,
      steps JSONB,
      result TEXT,
      logs JSONB,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      kind TEXT,
      payload JSONB,
      status TEXT,
      run_id TEXT REFERENCES runs(id)
    );
  `);
}

// Insert a record into the appropriate table.
export async function push(key: 'ideas', item: Idea): Promise<Idea>;
export async function push(key: 'tasks', item: Task): Promise<Task>;
export async function push(key: 'runs', item: Run): Promise<Run>;
export async function push(key: any, item: any) {
  switch (key) {
    case 'ideas':
      await pool.query(
        'INSERT INTO ideas(id,title,body,tags,targets,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [item.id, item.title, item.body, JSON.stringify(item.tags), JSON.stringify(item.targets), item.source, item.createdAt]
      );
      return item;
    case 'tasks':
      await pool.query(
        'INSERT INTO tasks(id,kind,payload,status,run_id) VALUES($1,$2,$3,$4,$5)',
        [item.id, item.kind, JSON.stringify(item.payload), item.status, item.runId]
      );
      return item;
    case 'runs':
      await pool.query(
        'INSERT INTO runs(id,idea_id,plan,steps,result,logs,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          item.id,
          item.ideaId ?? null,
          item.plan,
          JSON.stringify(item.steps),
          item.result ?? null,
          JSON.stringify(item.logs),
          item.startedAt,
          item.endedAt ?? null,
        ]
      );
      return item;
    default:
      throw new Error(`Unknown table ${key}`);
  }
}

// Fetch all records of a given type (limited to tasks for now).
export async function getAll(key: 'tasks'): Promise<Task[]>;
export async function getAll(key: any): Promise<any[]> {
  if (key === 'tasks') {
    const { rows } = await pool.query('SELECT id,kind,payload,status,run_id AS "runId" FROM tasks');
    return rows.map((r: any) => ({ ...r, payload: r.payload || {} }));
  }
  return [];
}

// Retrieve a single run by id.
export async function getRun(id: string): Promise<Run | undefined> {
  const { rows } = await pool.query(
    'SELECT id,idea_id AS "ideaId",plan,steps,result,logs,started_at AS "startedAt",ended_at AS "endedAt" FROM runs WHERE id=$1',
    [id]
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    ...r,
    steps: r.steps ?? [],
    logs: r.logs ?? [],
  } as Run;
}

// Update an existing task, used by worker to track status.
export async function updateTask(id: string, patch: Partial<Task>) {
  const fields: string[] = [];
  const values: any[] = [id];
  if (patch.status) {
    values.push(patch.status);
    fields.push(`status=$${values.length}`);
  }
  if (patch.payload) {
    values.push(JSON.stringify(patch.payload));
    fields.push(`payload=$${values.length}`);
  }
  if (patch.runId) {
    values.push(patch.runId);
    fields.push(`run_id=$${values.length}`);
  }
  if (!fields.length) return;
  await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id=$1`, values);
}

// Append a log line to a run.
export async function appendRunLog(runId: string, note: string) {
  const { rows } = await pool.query('SELECT logs FROM runs WHERE id=$1', [runId]);
  const logs: string[] = rows[0]?.logs ?? [];
  logs.push(note);
  await pool.query('UPDATE runs SET logs=$2 WHERE id=$1', [runId, JSON.stringify(logs)]);
}

// Cheap id generator; replace with UUID in production.
export async function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
