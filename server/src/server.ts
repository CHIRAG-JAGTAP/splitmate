import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';

await connectDb();
const app = createApp();
app.listen(env.PORT, () => console.log(`[server] SplitMate API on http://localhost:${env.PORT}  (docs: /docs)`));
