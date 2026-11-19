import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/index.js';

await connectDb();
const email = env.ADMIN_EMAIL.toLowerCase();
const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
const existing = await User.findOne({ email });
if (existing) { existing.role = 'admin'; existing.status = 'active'; existing.passwordHash = passwordHash; await existing.save(); }
else await User.create({ name: 'Platform Admin', email, passwordHash, role: 'admin' });
console.log(`Admin ready: ${email}  (change ADMIN_PASSWORD in .env and re-run to reset)`);
await mongoose.disconnect();
