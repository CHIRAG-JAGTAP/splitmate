import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { ZodError, type ZodTypeAny } from 'zod';
import { env } from '../config/env.js';
import { Session, User } from '../models/index.js';
import { HttpError, forbidden, unauthorized } from '../utils/http.js';
import { verifyAccess } from '../utils/security.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; role: 'user' | 'admin'; sid: string; name: string; email: string };
    requestId?: string;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

/** CSRF defence: cookies use SameSite=Lax AND every state-changing browser request must carry a custom header. */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next(); // not cookie-based => not CSRF-able
  if (req.headers['x-requested-with'] === 'SplitMate') return next();
  next(new HttpError(403, 'Missing CSRF header', 'CSRF'));
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const token = req.cookies?.sm_at ?? bearer;
    if (!token) throw unauthorized();
    let payload;
    try { payload = verifyAccess(token); } catch { throw unauthorized('Session expired'); }
    const [user, session] = await Promise.all([
      User.findById(payload.sub).select('name email role status'),
      Session.exists({ _id: payload.sid, revokedAt: { $exists: false } }),
    ]);
    if (!user || !session) throw unauthorized('Session expired');
    if (user.status === 'suspended') throw new HttpError(403, 'Your account has been suspended', 'SUSPENDED');
    req.user = { id: String(user._id), role: user.role, sid: payload.sid, name: user.name, email: user.email };
    next();
  } catch (e) { next(e); }
};

export const requireRole = (role: 'admin'): RequestHandler => (req, _res, next) =>
  req.user?.role === role ? next() : next(forbidden('Admin access required'));

export const validate =
  (schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) Object.defineProperty(req, 'query', { value: schemas.query.parse(req.query), writable: true });
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (e) { next(e); }
  };

const limiterBase = { standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' };
export const globalLimiter = rateLimit({ ...limiterBase, windowMs: 15 * 60_000, limit: 600, message: { error: { message: 'Too many requests, slow down.', code: 'RATE_LIMIT' } } });
export const authLimiter = rateLimit({ ...limiterBase, windowMs: 15 * 60_000, limit: 30, message: { error: { message: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMIT' } } });
export const ocrLimiter = rateLimit({ ...limiterBase, windowMs: 15 * 60_000, limit: 30 });

/* ---------- uploads: type + size + magic-byte validation, random filenames ---------- */
const ALLOWED: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export const uploadRoot = () => path.resolve(env.UPLOAD_DIR);
export function makeUploader(sub: 'receipts' | 'avatars' | 'tmp') {
  const dir = path.join(uploadRoot(), sub);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED[file.mimetype] ?? ''}`),
    }),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only JPEG, PNG or WebP images are allowed', 'BAD_FILE'))),
  });
}

function looksLikeImage(buf: Buffer) {
  if (buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return jpeg || png || webp;
}
/** Run after multer: the file extension/mime can be spoofed, the first bytes cannot. */
export const verifyUpload: RequestHandler = (req, _res, next) => {
  const f = req.file;
  if (!f) return next(new HttpError(400, 'No file uploaded', 'BAD_FILE'));
  const fd = fs.openSync(f.path, 'r');
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  if (!looksLikeImage(head)) { fs.unlink(f.path, () => undefined); return next(new HttpError(400, 'File content is not a valid image', 'BAD_FILE')); }
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'Route not found', 'NOT_FOUND'));

export const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next: NextFunction) => {
  let status = 500, message = 'Something went wrong', code = 'INTERNAL', details: unknown;
  if (err instanceof ZodError) {
    status = 400; code = 'VALIDATION'; message = err.issues[0]?.message ?? 'Invalid input';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof HttpError) {
    ({ status, message } = err); code = err.code ?? 'ERROR'; details = err.details;
  } else if (err?.name === 'EngineError') {
    status = 400; code = err.code ?? 'ENGINE_ERROR'; message = err.message;
  } else if (err instanceof multer.MulterError) {
    status = 400; code = 'BAD_FILE'; message = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${env.MAX_UPLOAD_MB} MB)` : err.message;
  } else if (err?.code === 11000) {
    status = 409; code = 'DUPLICATE'; message = 'That record already exists';
  } else if (err?.name === 'CastError') {
    status = 400; code = 'BAD_ID'; message = 'Invalid identifier';
  } else {
    console.error(`[error] ${req.requestId}`, err);
  }
  res.status(status).json({ error: { message, code, details, requestId: req.requestId } });
};
