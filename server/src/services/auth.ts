import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { env } from '../config/env.js';
import { DevOutbox, Session, User } from '../models/index.js';
import { HttpError, badRequest, unauthorized } from '../utils/http.js';
import { randomToken, sha256, signAccess } from '../utils/security.js';
import { audit } from './core.js';

export const passwordRule = z.string().min(8, 'Password must be at least 8 characters').max(72)
  .regex(/[a-z]/, 'Password needs a lowercase letter').regex(/[A-Z]/, 'Password needs an uppercase letter').regex(/\d/, 'Password needs a number');

export const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(), password: passwordRule });
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(72) });

const cookieBase = { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax' as const };

export async function issueSession(req: Request, res: Response, user: { _id: unknown; role: 'user' | 'admin' }) {
  const refresh = randomToken(40);
  const session = await Session.create({
    userId: user._id, refreshTokenHash: sha256(refresh), userAgent: req.headers['user-agent']?.slice(0, 200), ip: req.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000),
  });
  setAuthCookies(res, signAccess({ sub: String(user._id), role: user.role, sid: String(session._id) }), refresh);
  return session;
}
export function setAuthCookies(res: Response, access: string, refresh: string) {
  res.cookie('sm_at', access, { ...cookieBase, maxAge: env.ACCESS_TTL_MIN * 60_000, path: '/' });
  res.cookie('sm_rt', refresh, { ...cookieBase, maxAge: env.REFRESH_TTL_DAYS * 86_400_000, path: '/api/v1/auth' });
}
export function clearAuthCookies(res: Response) {
  res.clearCookie('sm_at', { ...cookieBase, path: '/' });
  res.clearCookie('sm_rt', { ...cookieBase, path: '/api/v1/auth' });
}

export const publicUser = (u: any) => ({
  id: String(u._id), name: u.name, email: u.email, avatarUrl: u.avatarUrl ?? null, upiId: u.upiId ?? null,
  role: u.role, status: u.status, theme: u.theme, createdAt: u.createdAt,
});

export async function register(req: Request, res: Response, input: z.infer<typeof registerSchema>) {
  if (await User.exists({ email: input.email })) throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  const user = await User.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) });
  await issueSession(req, res, user);
  await audit({ id: String(user._id), ip: req.ip, requestId: req.requestId }, 'user.register', 'User', user._id);
  return user;
}

// Pre-computed hash so unknown e-mails take as long as real ones (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

export async function login(req: Request, res: Response, input: z.infer<typeof loginSchema>) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (user?.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(429, 'Account temporarily locked. Try again later.', 'LOCKED');
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      user.failedLogins += 1;
      if (user.failedLogins >= 8) { user.lockedUntil = new Date(Date.now() + 15 * 60_000); user.failedLogins = 0; }
      await user.save();
    }
    throw unauthorized('Invalid email or password');
  }
  if (user.status === 'suspended') throw new HttpError(403, 'Your account has been suspended', 'SUSPENDED');
  user.failedLogins = 0; user.lockedUntil = undefined; user.lastLoginAt = new Date();
  await user.save();
  await issueSession(req, res, user);
  await audit({ id: String(user._id), ip: req.ip, requestId: req.requestId }, 'user.login', 'User', user._id);
  return user;
}

/** Refresh-token rotation: old token is revoked, a new pair issued. Re-use of a revoked token kills the session family. */
export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.sm_rt;
  if (!token) throw unauthorized();
  const s = await Session.findOne({ refreshTokenHash: sha256(token) });
  if (!s) throw unauthorized();
  if (s.revokedAt || s.expiresAt < new Date()) {
    await Session.updateMany({ userId: s.userId, revokedAt: { $exists: false } }, { revokedAt: new Date() });
    clearAuthCookies(res);
    throw unauthorized('Session expired');
  }
  const user = await User.findById(s.userId);
  if (!user || user.status === 'suspended') throw unauthorized();
  s.revokedAt = new Date();
  await s.save();
  await issueSession(req, res, user);
  return user;
}

export async function logout(req: Request, res: Response) {
  if (req.user) await Session.updateOne({ _id: req.user.sid }, { revokedAt: new Date() });
  clearAuthCookies(res);
}

/* ---------- forgot / reset password (local-first) ---------- */
let transport: nodemailer.Transporter | null = null;
if (env.SMTP_HOST) transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT ?? 587, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });

export async function forgotPassword(email: string) {
  const user = await User.findOne({ email });
  if (!user || user.status === 'suspended') return; // same response either way
  const token = randomToken(32);
  user.resetTokenHash = sha256(token);
  user.resetExpiresAt = new Date(Date.now() + 30 * 60_000);
  await user.save();
  const link = `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;
  const body = `Hi ${user.name},\n\nUse this link to reset your SplitMate password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, ignore this e-mail.`;
  if (transport) await transport.sendMail({ from: env.SMTP_FROM, to: email, subject: 'Reset your SplitMate password', text: body });
  else {
    await DevOutbox.create({ to: email, subject: 'Reset your SplitMate password', body, link });
    console.log(`[dev-outbox] password reset link for ${email}: ${link}`);
  }
}

export async function resetPassword(token: string, password: string) {
  const user = await User.findOne({ resetTokenHash: sha256(token), resetExpiresAt: { $gt: new Date() } }).select('+resetTokenHash +resetExpiresAt +passwordHash');
  if (!user) throw badRequest('Reset link is invalid or has expired');
  user.passwordHash = await bcrypt.hash(password, 12);
  user.resetTokenHash = undefined; user.resetExpiresAt = undefined; user.failedLogins = 0; user.lockedUntil = undefined;
  await user.save();
  await Session.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  await audit({ id: String(user._id) }, 'user.password_reset', 'User', user._id);
}

export async function changePassword(userId: string, current: string, next: string, keepSid: string) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw badRequest('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(next, 12);
  await user.save();
  await Session.updateMany({ userId, _id: { $ne: keepSid }, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  await audit({ id: userId }, 'user.password_change', 'User', userId);
}
