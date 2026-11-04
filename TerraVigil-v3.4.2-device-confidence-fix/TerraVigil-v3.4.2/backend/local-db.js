'use strict';

// A single-process, durable collection store for the local desktop application.
// MongoDB remains available for deployments with multiple backend processes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
const duplicate = () => Object.assign(new Error('Duplicate record identity.'), { code: 11000 });

function matches(row, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$and') return expected.every(part => matches(row, part));
    if (key === '$or') return expected.some(part => matches(row, part));
    const value = field(row, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      const operators = Object.keys(expected);
      if (!operators.some(op => op.startsWith('$'))) return same(value, expected);
      return operators.every(op => {
        const other = expected[op];
        if (op === '$ne') return !same(value, other);
        if (op === '$eq') return same(value, other);
        if (op === '$in') return other.some(item => same(value, item));
        if (op === '$nin') return !other.some(item => same(value, item));
        if (op === '$exists') return (value !== undefined) === Boolean(other);
        if (op === '$gt') return value > other;
        if (op === '$gte') return value >= other;
        if (op === '$lt') return value < other;
        if (op === '$lte') return value <= other;
        throw new Error(`Unsupported local query operator: ${op}`);
      });
    }
    return same(value, copy(expected));
  });
}

function createLocalDb(filename) {
  const file = path.resolve(filename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let state = { version: 1, collections: {}, indexes: {} };
  if (fs.existsSync(file)) {
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.version !== 1 || !state.collections || !state.indexes ||
          !Object.values(state.collections).every(Array.isArray)) throw new Error('Invalid schema');
    } catch {
      throw new Error(`The local database is corrupt or invalid: ${file}. Restore a backup; it has not been overwritten.`);
    }
  }
  const rows = (data, name) => data.collections[name] || [];
  function checkUnique(data, name) {
    const records = rows(data, name);
    const indexes = [{ keys: { _id: 1 }, unique: true }, ...(data.indexes[name] || [])];
    for (const index of indexes.filter(item => item.unique)) {
      const seen = new Set();
      for (const row of records) {
        if (index.partialFilterExpression && !matches(row, index.partialFilterExpression)) continue;
        const key = JSON.stringify(Object.keys(index.keys).map(k => field(row, k) ?? null));
        if (seen.has(key)) throw duplicate();
        seen.add(key);
      }
    }
  }
  function mutate(name, operation) {
    const next = copy(state);
    next.collections[name] ||= [];
    const result = operation(next.collections[name], next);
    checkUnique(next, name);
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(next));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
      state = next;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return result;
  }
  function collection(name) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new Error('Invalid collection name.');
    return {
      find(query = {}) {
        let selected = copy(rows(state, name).filter(row => matches(row, query)));
        return {
          sort(spec = {}) {
            selected.sort((a, b) => {
              for (const [key, direction] of Object.entries(spec)) {
                const av = field(a, key), bv = field(b, key);
                if (!same(av, bv)) return (av < bv ? -1 : 1) * (direction < 0 ? -1 : 1);
              }
              return 0;
            });
            return this;
          },
          limit(count) { if (Number.isInteger(count) && count > 0) selected = selected.slice(0, count); return this; },
          maxTimeMS() { return this; },
          async toArray() { return copy(selected); }
        };
      },
      async findOne(query = {}) { return copy(rows(state, name).find(row => matches(row, query))) || null; },
      async countDocuments(query = {}) { return rows(state, name).filter(row => matches(row, query)).length; },
      async insertOne(document) {
        const row = { ...copy(document), _id: document._id ?? crypto.randomUUID() };
        return mutate(name, records => { records.push(row); return { acknowledged: true, insertedId: row._id }; });
      },
      async insertMany(documents) {
        return mutate(name, records => {
          const insertedIds = {};
          documents.forEach((document, index) => {
            const row = { ...copy(document), _id: document._id ?? crypto.randomUUID() };
            records.push(row); insertedIds[index] = row._id;
          });
          return { acknowledged: true, insertedCount: documents.length, insertedIds };
        });
      },
      async updateOne(query, update, options = {}) {
        for (const key of Object.keys(update)) if (!['$set', '$unset', '$inc', '$setOnInsert'].includes(key)) throw new Error('Unsupported local update.');
        return mutate(name, records => {
          let index = records.findIndex(row => matches(row, query));
          const inserted = index < 0;
          if (inserted && !options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
          if (inserted) {
            const base = Object.fromEntries(Object.entries(query).filter(([key, value]) => !key.startsWith('$') && (value === null || typeof value !== 'object')));
            records.push({ _id: crypto.randomUUID(), ...copy(base), ...copy(update.$setOnInsert || {}) });
            index = records.length - 1;
          }
          const row = records[index], before = JSON.stringify(row);
          Object.assign(row, copy(update.$set || {}));
          for (const key of Object.keys(update.$unset || {})) delete row[key];
          for (const [key, amount] of Object.entries(update.$inc || {})) row[key] = (row[key] ?? 0) + amount;
          return { acknowledged: true, matchedCount: inserted ? 0 : 1, modifiedCount: before === JSON.stringify(row) ? 0 : 1, upsertedCount: inserted ? 1 : 0, ...(inserted ? { upsertedId: row._id } : {}) };
        });
      },
      async replaceOne(query, replacement, options = {}) {
        return mutate(name, records => {
          const index = records.findIndex(row => matches(row, query));
          if (index < 0 && !options.upsert) return { matchedCount: 0, modifiedCount: 0 };
          const row = { ...copy(replacement), _id: replacement._id ?? records[index]?._id ?? crypto.randomUUID() };
          if (index < 0) records.push(row); else records[index] = row;
          return { matchedCount: index < 0 ? 0 : 1, modifiedCount: index < 0 ? 0 : 1, upsertedCount: index < 0 ? 1 : 0 };
        });
      },
      async deleteMany(query = {}) {
        return mutate(name, records => {
          let deletedCount = 0;
          for (let i = records.length - 1; i >= 0; i--) if (matches(records[i], query)) { records.splice(i, 1); deletedCount++; }
          return { acknowledged: true, deletedCount };
        });
      },
      async deleteOne(query = {}) {
        return mutate(name, records => {
          const index = records.findIndex(row => matches(row, query));
          if (index >= 0) records.splice(index, 1);
          return { acknowledged: true, deletedCount: index < 0 ? 0 : 1 };
        });
      },
      async createIndex(keys, options = {}) {
        const indexName = options.name || Object.keys(keys).join('_');
        const definition = { keys, ...copy(options), name: indexName };
        if ((state.indexes[name] || []).some(index => same(index, definition))) return indexName;
        return mutate(name, (_records, data) => {
          data.indexes[name] ||= [];
          data.indexes[name] = data.indexes[name].filter(index => index.name !== indexName);
          data.indexes[name].push(definition);
          return indexName;
        });
      }
    };
  }
  return { collection, filename: file };
}

module.exports = { createLocalDb, matches };
