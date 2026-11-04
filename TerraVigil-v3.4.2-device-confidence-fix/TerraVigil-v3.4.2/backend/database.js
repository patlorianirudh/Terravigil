'use strict';
const path = require('node:path');
const { createLocalDb } = require('./local-db');
let ready;
let client;
const dataDirectory = () => path.resolve(process.env.TERRAVIGIL_DATA_DIR || path.join(__dirname, 'data'));

async function connectDB() {
  if (!ready) ready = (async () => {
    const mode = process.env.TERRAVIGIL_DB || 'local';
    if (mode === 'local') return createLocalDb(path.join(dataDirectory(), 'missions.json'));
    if (mode !== 'mongodb') throw new Error('TERRAVIGIL_DB must be local or mongodb.');
    const { MongoClient } = require('mongodb');
    client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    return client.db(process.env.MONGODB_DATABASE || 'terravigil');
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}

async function closeDB() { if (client) await client.close(); ready = undefined; client = undefined; }
module.exports = { connectDB, closeDB, dataDirectory };
