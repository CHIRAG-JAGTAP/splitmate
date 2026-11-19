import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/splitmate'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(16).optional(),
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(7),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
  TESSERACT_PATH: z.string().default('tesseract'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('SplitMate <no-reply@splitmate.local>'),
  ADMIN_EMAIL: z.string().default('admin@splitmate.local'),
  ADMIN_PASSWORD: z.string().default('Admin@12345'),
});

const parsed = schema.parse(process.env);
const isProd = parsed.NODE_ENV === 'production';
if (isProd && (!parsed.JWT_ACCESS_SECRET || !parsed.JWT_REFRESH_SECRET)) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production');
}
if (!parsed.JWT_ACCESS_SECRET || !parsed.JWT_REFRESH_SECRET) {
  console.warn('[env] JWT secrets not set - generating random ones for this run (sessions reset on restart). Set them in .env');
}

export const env = {
  ...parsed,
  isProd,
  JWT_ACCESS_SECRET: parsed.JWT_ACCESS_SECRET ?? randomBytes(32).toString('hex'),
  JWT_REFRESH_SECRET: parsed.JWT_REFRESH_SECRET ?? randomBytes(32).toString('hex'),
  cookieSecure: parsed.COOKIE_SECURE ? parsed.COOKIE_SECURE === 'true' : isProd,
};
