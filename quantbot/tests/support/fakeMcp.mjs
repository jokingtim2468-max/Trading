// A tiny MCP server over stdio for tests: one tool, "add", that adds two numbers
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id == null) return;
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  else if (msg.method === 'tools/list') send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }] } });
  else if (msg.method === 'tools/call') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String(msg.params.arguments.a + msg.params.arguments.b) }] } });
  else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method' } });
});
