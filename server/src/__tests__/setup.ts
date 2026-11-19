import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let repl: MongoMemoryReplSet;
export async function startDb() {
  process.env.NODE_ENV = 'test';
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const { connectDb } = await import('../config/db.js');
  await connectDb(repl.getUri());
}
export async function stopDb() { await mongoose.disconnect(); await repl?.stop(); }
export async function clearDb() { for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({}); }
