'use strict';

function clone(value) {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

function equal(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}

function matches(row, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(condition => matches(row, condition));
    if (key === '$and') return expected.every(condition => matches(row, condition));
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ('$ne' in expected && equal(row[key], expected.$ne)) return false;
      if ('$in' in expected && !expected.$in.some(value => equal(row[key], value))) return false;
      if ('$exists' in expected && (row[key] !== undefined) !== Boolean(expected.$exists)) return false;
      return true;
    }
    return equal(row[key], expected);
  });
}

function memoryDb(seed = {}) {
  const data = new Map();
  const calls = [];
  for (const [name, rows] of Object.entries(seed)) data.set(name, (rows || []).map(clone));

  const ensure = name => {
    if (!data.has(name)) data.set(name, []);
    return data.get(name);
  };
  const writeOne = (rows, row) => {
    if (row._id !== undefined && rows.some(existing => equal(existing._id, row._id))) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    rows.push(clone(row));
    return { acknowledged: true, insertedId: row._id };
  };

  const collection = name => {
    const rows = ensure(name);
    return {
      find(query = {}) {
        calls.push({ operation: 'find', collection: name, query: clone(query) });
        let selected = rows.filter(row => matches(row, query)).map(clone);
        return {
          sort(spec = {}) {
            const entries = Object.entries(spec);
            selected.sort((a, b) => {
              for (const [field, direction] of entries) {
                const av = a[field];
                const bv = b[field];
                if (equal(av, bv)) continue;
                return (av < bv ? -1 : 1) * (direction < 0 ? -1 : 1);
              }
              return 0;
            });
            return this;
          },
          async toArray() { return selected.map(clone); }
        };
      },
      async findOne(query = {}) {
        calls.push({ operation: 'findOne', collection: name, query: clone(query) });
        const row = rows.find(item => matches(item, query));
        return row ? clone(row) : null;
      },
      async insertOne(document) {
        calls.push({ operation: 'insertOne', collection: name, document: clone(document) });
        return writeOne(rows, document);
      },
      async insertMany(documents) {
        calls.push({ operation: 'insertMany', collection: name, documents: clone(documents) });
        const insertedIds = {};
        for (const document of documents) {
          writeOne(rows, document);
          if (document._id !== undefined) insertedIds[Object.keys(insertedIds).length] = document._id;
        }
        return { acknowledged: true, insertedCount: documents.length, insertedIds };
      },
      async updateOne(query, update, options = {}) {
        calls.push({ operation: 'updateOne', collection: name, query: clone(query), update: clone(update), options: clone(options) });
        const index = rows.findIndex(item => matches(item, query));
        if (index < 0 && options.upsert) {
          const base = {};
          for (const [key, value] of Object.entries(query)) if (!key.startsWith('$') && !(value && typeof value === 'object')) base[key] = clone(value);
          const inserted = { ...base, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
          writeOne(rows, inserted);
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: inserted._id };
        }
        if (index < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, modifiedCount: 0 };
        const before = clone(rows[index]);
        if (update && update.$set) Object.assign(rows[index], clone(update.$set));
        if (update && update.$unset) for (const key of Object.keys(update.$unset)) delete rows[index][key];
        const changed = JSON.stringify(before) !== JSON.stringify(rows[index]);
        return { acknowledged: true, matchedCount: 1, modifiedCount: changed ? 1 : 0 };
      },
      async replaceOne(query, replacement, options = {}) {
        calls.push({ operation: 'replaceOne', collection: name, query: clone(query), replacement: clone(replacement), options: clone(options) });
        const index = rows.findIndex(item => matches(item, query));
        if (index < 0 && options.upsert) { writeOne(rows, replacement); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
        if (index < 0) return { matchedCount: 0, modifiedCount: 0 };
        rows[index] = clone(replacement);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      async deleteMany(query = {}) {
        calls.push({ operation: 'deleteMany', collection: name, query: clone(query) });
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) if (matches(rows[index], query)) rows.splice(index, 1);
        return { acknowledged: true, deletedCount: before - rows.length };
      },
      async deleteOne(query = {}) {
        calls.push({ operation: 'deleteOne', collection: name, query: clone(query) });
        const index = rows.findIndex(item => matches(item, query));
        if (index < 0) return { acknowledged: true, deletedCount: 0 };
        rows.splice(index, 1);
        return { acknowledged: true, deletedCount: 1 };
      },
      async createIndex(keys, options = {}) {
        calls.push({ operation: 'createIndex', collection: name, keys: clone(keys), options: clone(options) });
        return options.name || Object.keys(keys).join('_');
      }
    };
  };

  return {
    calls,
    collection,
    rows(name) { return ensure(name).map(clone); }
  };
}

module.exports = { memoryDb, matches };
