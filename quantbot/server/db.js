// Local database: each entity is one JSON file in the app's data folder,
// held in memory and saved shortly after each change.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { matches, sortBy, project, aggregate } from './query.js';

const OPS = ['list', 'filter', 'get', 'create', 'bulkCreate', 'update', 'bulkUpdate', 'delete', 'deleteMany', 'updateMany', 'count', 'aggregate'];

// defaults: { EntityName: { field: value } } from the entity schemas
export function createDb(dir, userId, defaults = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const tables = new Map();
  const timers = new Map();
  const file = (name) => path.join(dir, `${name}.json`);
  const now = () => new Date().toISOString();

  function table(name) {
    if (!/^[A-Za-z]\w*$/.test(name)) throw new Error('Unknown entity');
    if (!tables.has(name)) {
      let rows = [];
      try { rows = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { rows = []; }
      tables.set(name, rows);
    }
    return tables.get(name);
  }

  function write(name) {
    clearTimeout(timers.get(name));
    timers.delete(name);
    fs.writeFileSync(`${file(name)}.tmp`, JSON.stringify(tables.get(name)));
    fs.renameSync(`${file(name)}.tmp`, file(name));
  }

  const changed = (name) => {
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => write(name), 300));
  };

  const newRecord = (name, data) => ({
    ...defaults[name], ...data,
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 24), created_date: now(), updated_date: now(), created_by_id: userId,
  });

  const find = (name, id) => {
    const row = table(name).find((r) => r.id === id);
    if (!row) throw new Error(`${name} record not found`);
    return row;
  };

  const patch = (row, data) => Object.assign(row, data, { id: row.id, updated_date: now() });
  const select = (name, query) => table(name).filter((r) => matches(r, query));

  const ops = {
    list: (name, a, b) => ops.filter(name, {}, a, b),
    // Options object -> a page {items, next_cursor, has_more}; positional (sort, limit) -> an array, like the SDK the pages were written for
    filter(name, query, a, b) {
      const paged = !!a && typeof a === 'object';
      const opts = paged ? a : { sort: a, limit: b };
      let rows = select(name, query);
      if (opts.distinct) {
        const values = [...new Set(rows.map((r) => r[opts.distinct]).filter((v) => v !== undefined && v !== null && v !== ''))];
        return { items: values, next_cursor: null, has_more: false };
      }
      if (opts.sort) rows = sortBy(rows, opts.sort);
      const start = Number(opts.cursor) || 0;
      const limit = Number(opts.limit) || (paged ? 1000 : rows.length);
      const items = rows.slice(start, start + limit).map((r) => project(r, opts.fields));
      if (!paged) return items;
      const hasMore = start + limit < rows.length;
      return { items, next_cursor: hasMore ? String(start + limit) : null, has_more: hasMore };
    },
    get: (name, id) => ({ ...find(name, id) }),
    create(name, data) {
      const row = newRecord(name, data);
      table(name).push(row);
      changed(name);
      return { ...row };
    },
    bulkCreate(name, list) {
      const rows = list.map((d) => newRecord(name, d));
      table(name).push(...rows);
      changed(name);
      return rows.map((r) => ({ ...r }));
    },
    update(name, id, data) {
      const row = patch(find(name, id), data);
      changed(name);
      return { ...row };
    },
    bulkUpdate(name, list) {
      const out = list.map(({ id, ...data }) => ({ ...patch(find(name, id), data) }));
      changed(name);
      return out;
    },
    delete(name, id) {
      const rows = table(name);
      const k = rows.findIndex((r) => r.id === id);
      if (k >= 0) rows.splice(k, 1);
      changed(name);
      return {};
    },
    deleteMany(name, query) {
      const rows = table(name);
      const keep = rows.filter((r) => !matches(r, query));
      tables.set(name, keep);
      changed(name);
      return { deleted: rows.length - keep.length };
    },
    updateMany(name, query, update) {
      const rows = select(name, query);
      for (const r of rows) {
        patch(r, update.$set || {});
        for (const k of Object.keys(update.$unset || {})) delete r[k];
        for (const [k, v] of Object.entries(update.$inc || {})) r[k] = (Number(r[k]) || 0) + v;
      }
      changed(name);
      return { updated: rows.length, has_more: false };
    },
    count: (name, query) => select(name, query).length,
    aggregate: (name, opts = {}) => aggregate(select(name, opts.query), opts),
  };

  return {
    run(name, op, ...args) {
      if (!OPS.includes(op)) throw new Error(`Unsupported operation ${op}`);
      return ops[op](name, ...args);
    },
    // Writes pending changes now (before quitting or updating)
    flush() { for (const name of [...timers.keys()]) write(name); },
  };
}