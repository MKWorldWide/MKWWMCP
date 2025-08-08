import type { Idea } from '../models/store.js';

// Naive keyword-based planner. Swap for LLM-based strategy when scaling.
export function planFromIdea(idea: Idea) {
  const text = `${idea.title} ${idea.body}`.toLowerCase();
  const steps: string[] = [];

  // Detect deployment intents.
  if (text.includes('deploy')) steps.push(`deploy:${idea.targets[0] ?? 'MKWorldWide/Serafina'}`);

  // Announcements to council channel.
  if (text.includes('post') || text.includes('announce')) steps.push('post:council');

  // VRChat/OSC bridge hooks.
  if (text.includes('vrchat') || text.includes('osc')) steps.push('osc:/gamedin/orb/text="Update applied"');

  // Default action: let the council know we processed it.
  if (steps.length === 0) steps.push('post:council');

  const plan = `Auto-plan for idea[${idea.id}]: ${steps.join(' -> ')}`;
  return { plan, steps };
}
