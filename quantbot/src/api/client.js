// Every data, file and AI call goes to QuantBot's local server (server/index.js) on this PC
const OPS = ['list', 'filter', 'get', 'create', 'bulkCreate', 'update', 'bulkUpdate', 'delete', 'deleteMany', 'updateMany', 'count', 'aggregate'];

async function call(kind, ...args) {
  const res = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Same error shape the pages read (e.response.data.error)
    const message = body.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.response = { data: { error: message } };
    throw err;
  }
  return body.result;
}

const entity = (name) => Object.fromEntries(OPS.map((op) => [op, (...args) => call('entity', name, op, ...args)]));

async function upload({ file }) {
  const res = await fetch(`/api/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'x-quantbot-upload': '1' },
    body: file,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
  return body;
}

export const client = {
  entities: new Proxy({}, { get: (_t, name) => entity(String(name)) }),
  auth: {
    me: () => call('user', 'me'),
    updateMe: (data) => call('user', 'update', data),
  },
  functions: {
    invoke: async (name, payload) => ({ data: await call('function', name, payload) }),
  },
  files: {
    upload,
    url: (fileUri) => `/api/files/${encodeURIComponent(String(fileUri).split('/').pop())}`,
  },
};

export default client;
