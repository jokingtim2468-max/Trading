// Query matching, sorting and grouping for the local database (the operators the app uses).
const valueAt = (row, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), row);
const same = (a, b) => (Array.isArray(a) ? a.includes(b) : a === b);
const isOps = (cond) => cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'));

function test(value, cond) {
  if (!isOps(cond)) return cond && typeof cond === 'object' ? JSON.stringify(value) === JSON.stringify(cond) : same(value, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$eq': return same(value, arg);
      case '$ne': return !same(value, arg);
      case '$gt': return value != null && value > arg;
      case '$gte': return value != null && value >= arg;
      case '$lt': return value != null && value < arg;
      case '$lte': return value != null && value <= arg;
      case '$in': return arg.some((a) => same(value, a));
      case '$nin': return !arg.some((a) => same(value, a));
      case '$exists': return (value !== undefined && value !== null) === !!arg;
      case '$regex': return new RegExp(arg, cond.$options || '').test(String(value ?? ''));
      case '$options': return true;
      default: throw new Error(`Unsupported query operator ${op}`);
    }
  });
}

export function matches(row, query) {
  return Object.entries(query || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some((q) => matches(row, q));
    if (key === '$and') return cond.every((q) => matches(row, q));
    return test(valueAt(row, key), cond);
  });
}

export function sortBy(rows, sort) {
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return rows.slice().sort((a, b) => {
    const x = valueAt(a, key);
    const y = valueAt(b, key);
    if (x === y) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : 1) * (desc ? -1 : 1);
  });
}

export const project = (row, fields) => (fields?.length
  ? Object.fromEntries(['id', ...fields].filter((f) => f in row).map((f) => [f, row[f]]))
  : { ...row });

const list = (v) => (v ? [].concat(v) : []);

// {rows: [{<groupBy>, count, sum_<f>, avg_<f>, min_<f>, max_<f>}], truncated}
export function aggregate(rows, { groupBy, sum, avg, min, max, sort, limit }) {
  const keys = list(groupBy);
  const groups = new Map();
  if (!keys.length) groups.set('all', []);
  for (const r of rows) {
    const k = keys.length ? JSON.stringify(keys.map((f) => valueAt(r, f) ?? null)) : 'all';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let out = [...groups.values()].map((g) => {
    const row = Object.fromEntries(keys.map((f) => [f, g.length ? valueAt(g[0], f) ?? null : null]));
    row.count = g.length;
    const nums = (f) => g.map((r) => Number(valueAt(r, f))).filter((n) => !Number.isNaN(n));
    const total = (n) => n.reduce((a, b) => a + b, 0);
    for (const f of list(sum)) row[`sum_${f}`] = total(nums(f));
    for (const f of list(avg)) { const n = nums(f); row[`avg_${f}`] = n.length ? total(n) / n.length : null; }
    for (const f of list(min)) { const n = nums(f); row[`min_${f}`] = n.length ? n.reduce((a, b) => Math.min(a, b)) : null; }
    for (const f of list(max)) { const n = nums(f); row[`max_${f}`] = n.length ? n.reduce((a, b) => Math.max(a, b)) : null; }
    return row;
  });
  if (sort) out = sortBy(out, sort);
  const truncated = !!limit && out.length > limit;
  if (limit) out = out.slice(0, limit);
  return { rows: out, truncated };
}