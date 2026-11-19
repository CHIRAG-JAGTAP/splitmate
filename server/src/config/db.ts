import mongoose from 'mongoose';
import { env } from './env.js';

export let supportsTransactions = false;

export async function connectDb(uri = env.MONGODB_URI) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    supportsTransactions = false;
  }
  await mongoose.syncIndexes();
  console.log(`[db] connected. transactions: ${supportsTransactions ? 'ON (replica set)' : 'OFF (standalone - see README to enable)'}`);
}

/**
 * Run `fn` inside a MongoDB transaction when the server supports it (replica set),
 * otherwise run it without one. All writes in `fn` must pass the given session.
 */
export async function runTx<T>(fn: (session: mongoose.ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!supportsTransactions) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}
