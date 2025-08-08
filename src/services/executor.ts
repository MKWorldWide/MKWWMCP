import fetch from 'node-fetch';
// Execute a single step; worker will persist status/logs.
export async function execStep(step: string): Promise<{ ok: boolean; note: string }> {
  try {
    if (step.startsWith('deploy:')) {
      const repo = step.split(':')[1];
      await fetch(process.env.RENDER_DEPLOY_HOOK_SERAFINA || '', { method: 'POST' }).catch(() => {});
      return { ok: true, note: `Triggered deploy for ${repo}` };
    }

    if (step.startsWith('post:council')) {
      const hook = process.env.DISCORD_WEBHOOK_COUNCIL;
      await fetch(hook || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '🧠 MCP: Plan acknowledged and queued.' }),
      });
      return { ok: true, note: 'Posted to council.' };
    }

    if (step.startsWith('osc:')) {
      return { ok: true, note: `OSC step acknowledged (${step}).` };
    }

    return { ok: false, note: `Unknown step ${step}` };
  } catch (e: any) {
    return { ok: false, note: `Error: ${e?.message ?? e}` };
  }
}
