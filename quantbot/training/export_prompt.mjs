// Prints the exact system prompt and tool list the chat gives the local model (built-in tools + load_skill + run_python,
// skills index, no MCP servers), so training examples match what the model sees inside QuantBot.
// usage: node training/export_prompt.mjs > training/prompt.json
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatSystem, toolsBrief } from '../server/lib/chatPrompt.js';
import { TOOL_DEFS } from '../server/lib/chatTools.js';
import { createSkills } from '../server/lib/skills.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skills = createSkills({ builtinDir: path.join(root, 'server', 'skills'), userDir: path.join(root, 'training', '.no-user-skills') });
const LOAD_SKILL = { name: 'load_skill', description: 'Load a skill (detailed rules, data formats, templates) by name from the SKILLS list in your system prompt. Do this before a task the skill covers.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } };
const system = chatSystem('MT5', 'Concise', 'Trader', { today: '2026-11-06', workspace: 'workspaces/quant-task', tools: toolsBrief({ skills: skills.index(), mcp: [] }) });
const tools = [...TOOL_DEFS, LOAD_SKILL].map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
const skillTexts = Object.fromEntries(skills.list().map((s) => [s.name, skills.load(s.name)]));
process.stdout.write(JSON.stringify({ system, tools, skills: skillTexts }));
