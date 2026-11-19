import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authLimiter, authenticate, makeUploader, ocrLimiter, requireRole, validate, verifyUpload } from '../middleware/index.js';
import { AuditLog, DevOutbox, Expense, Group, GroupMember, Notification, Session, Settlement, User } from '../models/index.js';
import * as analytics from '../services/analytics.js';
import * as admin from '../services/admin.js';
import * as auth from '../services/auth.js';
import { groupBalances, groupLedger, userSummary } from '../services/balance.js';
import * as budget from '../services/budget.js';
import { actorOf, requireMember, userCards } from '../services/core.js';
import * as expense from '../services/expense.js';
import * as group from '../services/group.js';
import { scanReceipt } from '../services/ocr.js';
import * as settlement from '../services/settlement.js';
import { calculateSplit } from '../engine/splitters/index.js';
import { asyncHandler, badRequest, forbidden, monthKey, notFound } from '../utils/http.js';

const oidStr = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const idParam = z.object({ id: oidStr });
const r = Router();
const A = authenticate;
const avatarUpload = makeUploader('avatars');
const receiptUpload = makeUploader('receipts');
const ocrUpload = makeUploader('tmp');

/* ---------------- Meta ---------------- */
r.get('/health', asyncHandler(async (_q, res) => { res.json({ status: 'ok', time: new Date().toISOString() }); }));
r.get('/dev/outbox', asyncHandler(async (_q, res) => {
  if (env.isProd) throw notFound();
  res.json({ items: await DevOutbox.find().sort({ createdAt: -1 }).limit(20) });
}));

/* ---------------- Auth ---------------- */
r.post('/auth/register', authLimiter, validate({ body: auth.registerSchema }), asyncHandler(async (req, res) => { const u = await auth.register(req, res, req.body); res.status(201).json({ user: auth.publicUser(u) }); }));
r.post('/auth/login', authLimiter, validate({ body: auth.loginSchema }), asyncHandler(async (req, res) => { const u = await auth.login(req, res, req.body); res.json({ user: auth.publicUser(u) }); }));
r.post('/auth/refresh', authLimiter, asyncHandler(async (req, res) => { const u = await auth.refresh(req, res); res.json({ user: auth.publicUser(u) }); }));
r.post('/auth/logout', asyncHandler(async (req, res) => {
  try { const t = req.cookies?.sm_at; if (t) { const { verifyAccess } = await import('../utils/security.js'); const p = verifyAccess(t); req.user = { id: p.sub, role: p.role, sid: p.sid, name: '', email: '' }; } } catch { /* expired token: still clear cookies */ }
  await auth.logout(req, res); res.json({ ok: true });
}));
r.post('/auth/forgot-password', authLimiter, validate({ body: z.object({ email: z.string().trim().toLowerCase().email() }) }), asyncHandler(async (req, res) => {
  await auth.forgotPassword(req.body.email);
  res.json({ message: 'If that e-mail is registered, a reset link has been sent.', devHint: env.SMTP_HOST || env.isProd ? undefined : 'Dev mode: open /dev/outbox or check the server console for the link.' });
}));
r.post('/auth/reset-password', authLimiter, validate({ body: z.object({ token: z.string().min(20).max(200), password: auth.passwordRule }) }), asyncHandler(async (req, res) => { await auth.resetPassword(req.body.token, req.body.password); res.json({ ok: true }); }));
r.get('/auth/me', A, asyncHandler(async (req, res) => { const u = await User.findById(req.user!.id); res.json({ user: auth.publicUser(u) }); }));
r.get('/auth/sessions', A, asyncHandler(async (req, res) => {
  const ss = await Session.find({ userId: req.user!.id, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  res.json({ items: ss.map((s) => ({ id: String(s._id), userAgent: s.userAgent, ip: s.ip, createdAt: (s as any).createdAt, current: String(s._id) === req.user!.sid })) });
}));
r.delete('/auth/sessions/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await Session.updateOne({ _id: req.params.id, userId: req.user!.id }, { revokedAt: new Date() }); res.json({ ok: true }); }));

/* ---------------- Users ---------------- */
r.get('/users/me', A, asyncHandler(async (req, res) => res.json({ user: auth.publicUser(await User.findById(req.user!.id)) })));
r.patch('/users/me', A, validate({ body: z.object({ name: z.string().trim().min(2).max(80).optional(), upiId: z.string().trim().regex(/^[\w.\-]{2,256}@[A-Za-z]{2,64}$/, 'Enter a valid UPI ID like name@bank').or(z.literal('')).optional(), theme: z.enum(['light', 'dark', 'system']).optional() }) }), asyncHandler(async (req, res) => {
  const u = await User.findById(req.user!.id);
  if (req.body.name) u!.name = req.body.name;
  if (req.body.upiId !== undefined) u!.upiId = req.body.upiId || undefined;
  if (req.body.theme) u!.theme = req.body.theme;
  await u!.save(); res.json({ user: auth.publicUser(u) });
}));
r.post('/users/me/avatar', A, avatarUpload.single('avatar'), verifyUpload, asyncHandler(async (req, res) => {
  const u = await User.findById(req.user!.id);
  if (u!.avatarUrl) fs.unlink(path.join(path.resolve(env.UPLOAD_DIR), 'avatars', path.basename(u!.avatarUrl)), () => undefined);
  u!.avatarUrl = `/uploads/avatars/${req.file!.filename}`; await u!.save();
  res.json({ user: auth.publicUser(u) });
}));
r.post('/users/me/change-password', A, validate({ body: z.object({ currentPassword: z.string().min(1).max(72), newPassword: auth.passwordRule }) }), asyncHandler(async (req, res) => { await auth.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, req.user!.sid); res.json({ ok: true }); }));
r.get('/users/search', A, validate({ query: z.object({ q: z.string().trim().min(3).max(80) }) }), asyncHandler(async (req, res) => {
  const q = String((req.query as any).q).toLowerCase();
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const us = await User.find({ status: 'active', $or: [{ email: q }, { name: { $regex: `^${esc}`, $options: 'i' } }] }).limit(8).select('name email avatarUrl');
  res.json({ items: us.map((u) => ({ id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null, email: u.email.replace(/^(.{2}).*(@.*)$/, '$1***$2') })) });
}));
r.get('/users/:id/payment-instructions', A, validate({ params: idParam, query: z.object({ groupId: oidStr, amountPaise: z.coerce.number().int().positive().optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as any; res.json(await settlement.paymentInstructions(req.user!.id, req.params.id, q.groupId, q.amountPaise));
}));

/* ---------------- Groups & members ---------------- */
r.post('/groups', A, validate({ body: group.groupBody }), asyncHandler(async (req, res) => { const g = await group.createGroup(actorOf(req), req.body); res.status(201).json({ group: group.fmtGroup(g) }); }));
r.get('/groups', A, asyncHandler(async (req, res) => res.json({ items: await group.listGroups(req.user!.id) })));
r.get('/groups/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ group: await group.getGroup(req.params.id, req.user!.id) })));
r.patch('/groups/:id', A, validate({ params: idParam, body: group.groupPatch }), asyncHandler(async (req, res) => { const g = await group.updateGroup(actorOf(req), req.params.id, req.body); res.json({ group: group.fmtGroup(g) }); }));
r.delete('/groups/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await group.deleteGroup(actorOf(req), req.params.id); res.json({ ok: true }); }));
r.get('/groups/:id/members', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ items: await group.listMembers(req.params.id, req.user!.id) })));
r.post('/groups/:id/members', A, validate({ params: idParam, body: z.object({ email: z.string().trim().toLowerCase().email() }) }), asyncHandler(async (req, res) => res.status(201).json({ member: await group.addMemberByEmail(actorOf(req), req.params.id, req.body.email) })));
r.patch('/groups/:id/members/:userId', A, validate({ params: z.object({ id: oidStr, userId: oidStr }), body: z.object({ role: z.enum(['admin', 'member']) }) }), asyncHandler(async (req, res) => { await group.setMemberRole(actorOf(req), req.params.id, req.params.userId, req.body.role); res.json({ ok: true }); }));
r.delete('/groups/:id/members/:userId', A, validate({ params: z.object({ id: oidStr, userId: oidStr }) }), asyncHandler(async (req, res) => { await group.removeMember(actorOf(req), req.params.id, req.params.userId, 'remove'); res.json({ ok: true }); }));
r.post('/groups/:id/leave', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await group.removeMember(actorOf(req), req.params.id, req.user!.id, 'leave'); res.json({ ok: true }); }));
r.get('/groups/:id/activity', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ items: await group.groupActivity(req.params.id, req.user!.id) })));
r.post('/groups/:id/remind', A, validate({ params: idParam, body: z.object({ userId: oidStr }) }), asyncHandler(async (req, res) => {
  await requireMember(req.params.id, req.user!.id); await requireMember(req.params.id, req.body.userId);
  const g = await Group.findById(req.params.id);
  const { notify } = await import('../services/core.js');
  await notify([req.body.userId], { type: 'reminder', title: `${req.user!.name} sent a payment reminder`, body: `Please settle up in ${g?.name}`, link: `/groups/${req.params.id}` });
  res.json({ ok: true });
}));

/* ---------------- Invitations ---------------- */
r.post('/groups/:id/invitations', A, validate({ params: idParam, body: group.inviteBody }), asyncHandler(async (req, res) => res.status(201).json({ invitation: await group.createInvitation(actorOf(req), req.params.id, req.body.email) })));
r.get('/groups/:id/invitations', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ items: await group.listInvitations(req.params.id, req.user!.id) })));
r.get('/invitations/mine', A, asyncHandler(async (req, res) => res.json({ items: await group.myInvitations(req.user!.id) })));
r.post('/invitations/join', A, validate({ body: z.object({ code: z.string().trim().min(6).max(40) }) }), asyncHandler(async (req, res) => res.json(await group.joinByCode(actorOf(req), req.body.code))));
r.post('/invitations/:id/accept', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await group.respondInvitation(actorOf(req), req.params.id, true))));
r.post('/invitations/:id/decline', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await group.respondInvitation(actorOf(req), req.params.id, false))));
r.delete('/invitations/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await group.revokeInvitation(actorOf(req), req.params.id); res.json({ ok: true }); }));

/* ---------------- Expenses & splits ---------------- */
r.post('/groups/:id/expenses', A, validate({ params: idParam, body: expense.expenseBody }), asyncHandler(async (req, res) => res.status(201).json({ expense: await expense.createExpense(actorOf(req), req.params.id, req.body) })));
r.get('/groups/:id/expenses', A, validate({ params: idParam, query: expense.listQuery }), asyncHandler(async (req, res) => res.json(await expense.listExpenses(req.user!.id, req.params.id, req.query as any))));
r.get('/expenses/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ expense: await expense.getExpense(req.user!.id, req.params.id) })));
r.patch('/expenses/:id', A, validate({ params: idParam, body: expense.expenseBody.and(z.object({ version: z.number().int().optional() })) }), asyncHandler(async (req, res) => res.json({ expense: await expense.updateExpense(actorOf(req), req.params.id, req.body, req.body.version) })));
r.delete('/expenses/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await expense.deleteExpense(actorOf(req), req.params.id); res.json({ ok: true }); }));
r.post('/expenses/:id/receipt', A, validate({ params: idParam }), receiptUpload.single('receipt'), verifyUpload, asyncHandler(async (req, res) => res.json({ expense: await expense.attachReceipt(actorOf(req), req.params.id, `/uploads/receipts/${req.file!.filename}`) })));
r.get('/expenses/:id/splits', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ splits: (await expense.getExpense(req.user!.id, req.params.id)).splits })));
r.post('/splits/calculate', A, validate({ body: expense.previewBody }), asyncHandler(async (req, res) => { const b = req.body; res.json({ splits: calculateSplit(b.splitMethod, b.amountPaise, b.participants) }); }));
r.post('/expenses/preview-split', A, validate({ body: expense.previewBody }), asyncHandler(async (req, res) => { const b = req.body; res.json({ splits: calculateSplit(b.splitMethod, b.amountPaise, b.participants) }); }));

/* ---------------- Balances ---------------- */
r.get('/groups/:id/balances', A, validate({ params: idParam }), asyncHandler(async (req, res) => {
  await requireMember(req.params.id, req.user!.id);
  const ids = (await GroupMember.find({ groupId: req.params.id, status: 'active' })).map((m) => String(m.userId));
  const g = await Group.findById(req.params.id);
  res.json(await groupBalances(req.params.id, ids, g?.simplifyDebts));
}));
r.get('/groups/:id/balances/simplified', A, validate({ params: idParam }), asyncHandler(async (req, res) => {
  await requireMember(req.params.id, req.user!.id);
  const ids = (await GroupMember.find({ groupId: req.params.id, status: 'active' })).map((m) => String(m.userId));
  const b = await groupBalances(req.params.id, ids); res.json({ transfers: b.simplified, original: b.pairwise.length, simplified: b.simplified.length });
}));
r.get('/groups/:id/ledger', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await requireMember(req.params.id, req.user!.id); res.json({ items: await groupLedger(req.params.id) }); }));
r.get('/balances/summary', A, asyncHandler(async (req, res) => {
  const gids = (await GroupMember.find({ userId: req.user!.id, status: 'active' })).map((m) => String(m.groupId));
  const s = await userSummary(req.user!.id, gids); res.json({ owePaise: s.owePaise, owedPaise: s.owedPaise, netPaise: s.netPaise });
}));

/* ---------------- Dashboard (everything from DB) ---------------- */
r.get('/dashboard', A, asyncHandler(async (req, res) => {
  const uid = req.user!.id;
  const mems = await GroupMember.find({ userId: uid, status: 'active' });
  const gids = mems.map((m) => m.groupId);
  const [summary, groups, recent, sets, activity, monthly, cats] = await Promise.all([
    userSummary(uid, gids.map(String)), group.listGroups(uid),
    Expense.find({ groupId: { $in: gids }, deletedAt: { $exists: false } }).sort({ expenseDate: -1, createdAt: -1 }).limit(6),
    Settlement.find({ groupId: { $in: gids }, $or: [{ fromUser: uid }, { toUser: uid }] }).sort({ createdAt: -1 }).limit(5),
    AuditLog.find({ groupId: { $in: gids } }).sort({ createdAt: -1 }).limit(8),
    analytics.monthly(uid, 6), analytics.categories(uid, monthKey()),
  ]);
  const gnames = new Map(groups.map((g) => [g.id, g.name]));
  const cards = await userCards([...recent.map((e) => e.paidBy), ...activity.map((a) => a.actorId).filter(Boolean)]);
  res.json({
    summary: { owePaise: summary.owePaise, owedPaise: summary.owedPaise, netPaise: summary.netPaise },
    groups: groups.slice(0, 6), activeGroupCount: groups.length,
    recentExpenses: recent.map((e) => ({ id: String(e._id), groupId: String(e.groupId), groupName: gnames.get(String(e.groupId)), description: e.description, category: e.category, amountPaise: e.amountPaise, paidBy: cards.get(String(e.paidBy))?.name, date: e.expenseDate })),
    recentSettlements: await settlement.fmtMany(sets),
    activity: activity.map((a) => ({ id: String(a._id), actor: cards.get(String(a.actorId))?.name ?? 'Someone', action: a.action, groupName: gnames.get(String(a.groupId)), at: (a as any).createdAt })),
    monthly, categories: cats, thisMonthPaise: monthly[monthly.length - 1]?.totalPaise ?? 0,
  });
}));

/* ---------------- Settlements ---------------- */
r.post('/groups/:id/settlements', A, validate({ params: idParam, body: settlement.settlementBody }), asyncHandler(async (req, res) => res.status(201).json({ settlement: await settlement.createSettlement(actorOf(req), req.params.id, req.body) })));
r.get('/groups/:id/settlements', A, validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ items: await settlement.listForGroup(req.user!.id, req.params.id) })));
r.get('/settlements/mine', A, validate({ query: z.object({ status: z.enum(['pending', 'completed', 'rejected', 'cancelled']).optional() }) }), asyncHandler(async (req, res) => res.json({ items: await settlement.listMine(req.user!.id, (req.query as any).status) })));
for (const act of ['confirm', 'reject', 'cancel'] as const)
  r.post(`/settlements/:id/${act}`, A, validate({ params: idParam, body: z.object({ reason: z.string().trim().max(200).optional() }).default({}) }), asyncHandler(async (req, res) => res.json({ settlement: await settlement.respond(actorOf(req), req.params.id, act, req.body.reason) })));
r.get('/settlements/:id/receipt', A, validate({ params: idParam }), asyncHandler(async (req, res) => { res.type('html').send(await settlement.receiptHtml(req.user!.id, req.params.id)); }));

/* ---------------- Analytics ---------------- */
const mq = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
r.get('/analytics/monthly', A, asyncHandler(async (req, res) => res.json({ items: await analytics.monthly(req.user!.id) })));
r.get('/analytics/weekly', A, asyncHandler(async (req, res) => res.json({ items: await analytics.weekly(req.user!.id) })));
r.get('/analytics/categories', A, validate({ query: mq }), asyncHandler(async (req, res) => res.json({ items: await analytics.categories(req.user!.id, (req.query as any).month) })));
r.get('/analytics/groups', A, validate({ query: mq }), asyncHandler(async (req, res) => res.json({ items: await analytics.byGroup(req.user!.id, (req.query as any).month) })));
r.get('/analytics/contributions', A, validate({ query: z.object({ groupId: oidStr.optional() }) }), asyncHandler(async (req, res) => res.json({ items: await analytics.contributions(req.user!.id, (req.query as any).groupId) })));
r.get('/analytics/trends', A, asyncHandler(async (req, res) => res.json({ items: await analytics.trends(req.user!.id) })));
r.get('/analytics/compare', A, validate({ query: mq }), asyncHandler(async (req, res) => res.json(await analytics.compare(req.user!.id, (req.query as any).month))));
r.get('/analytics/top-categories', A, asyncHandler(async (req, res) => res.json({ items: await analytics.topCategories(req.user!.id) })));
r.get('/analytics/insights', A, asyncHandler(async (req, res) => res.json({ items: await analytics.insights(req.user!.id) })));
r.get('/analytics/export.csv', A, validate({ query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as any;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="splitmate-report.csv"');
  res.send('﻿' + (await analytics.exportCsv(req.user!.id, q.from, q.to)));
}));

/* ---------------- OCR ---------------- */
r.post('/ocr/scan', A, ocrLimiter, ocrUpload.single('receipt'), verifyUpload, asyncHandler(async (req, res) => {
  const file = req.file!.path;
  try { res.json(await scanReceipt(file)); } finally { fs.unlink(file, () => undefined); }
}));

/* ---------------- Budgets ---------------- */
r.post('/budgets', A, validate({ body: budget.budgetBody }), asyncHandler(async (req, res) => res.status(201).json({ budget: await budget.createBudget(actorOf(req), req.body) })));
r.get('/budgets', A, asyncHandler(async (req, res) => res.json({ items: await budget.budgetProgress(req.user!.id, monthKey()) })));
r.get('/budgets/progress', A, validate({ query: mq }), asyncHandler(async (req, res) => res.json({ items: await budget.budgetProgress(req.user!.id, (req.query as any).month ?? monthKey()) })));
r.get('/budgets/history', A, asyncHandler(async (req, res) => res.json({ items: await budget.budgetHistory(req.user!.id) })));
r.patch('/budgets/:id', A, validate({ params: idParam, body: z.object({ limitPaise: z.number().int().positive().optional(), alertThresholdPct: z.number().int().min(1).max(100).optional() }) }), asyncHandler(async (req, res) => res.json({ budget: await budget.updateBudget(actorOf(req), req.params.id, req.body) })));
r.delete('/budgets/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await budget.deleteBudget(actorOf(req), req.params.id); res.json({ ok: true }); }));

/* ---------------- Notifications ---------------- */
r.get('/notifications', A, validate({ query: z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) }), asyncHandler(async (req, res) => {
  const q = req.query as any;
  const items = await Notification.find({ userId: req.user!.id, ...(q.unread === 'true' && { readAt: { $exists: false } }) }).sort({ createdAt: -1 }).limit(q.limit);
  res.json({ items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link ?? null, read: Boolean(n.readAt), createdAt: (n as any).createdAt })) });
}));
r.get('/notifications/unread-count', A, asyncHandler(async (req, res) => res.json({ count: await Notification.countDocuments({ userId: req.user!.id, readAt: { $exists: false } }) })));
r.post('/notifications/read-all', A, asyncHandler(async (req, res) => { await Notification.updateMany({ userId: req.user!.id, readAt: { $exists: false } }, { readAt: new Date() }); res.json({ ok: true }); }));
r.patch('/notifications/:id/read', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await Notification.updateOne({ _id: req.params.id, userId: req.user!.id }, { readAt: new Date() }); res.json({ ok: true }); }));
r.delete('/notifications/:id', A, validate({ params: idParam }), asyncHandler(async (req, res) => { await Notification.deleteOne({ _id: req.params.id, userId: req.user!.id }); res.json({ ok: true }); }));

/* ---------------- Reports + Admin ---------------- */
r.post('/reports', A, validate({ body: admin.reportBody }), asyncHandler(async (req, res) => res.status(201).json(await admin.createReport(actorOf(req), req.body))));
const ad = Router(); ad.use(A, requireRole('admin'));
ad.get('/stats', asyncHandler(async (_q, res) => res.json(await admin.platformStats())));
ad.get('/users', validate({ query: admin.adminUsersQuery }), asyncHandler(async (req, res) => res.json(await admin.listUsers(req.query as any))));
ad.patch('/users/:id/suspend', validate({ params: idParam, body: z.object({ reason: z.string().trim().max(200).optional() }).default({}) }), asyncHandler(async (req, res) => res.json(await admin.setSuspended(actorOf(req), req.params.id, true, req.body.reason))));
ad.patch('/users/:id/reinstate', validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await admin.setSuspended(actorOf(req), req.params.id, false))));
ad.get('/groups', validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1) }) }), asyncHandler(async (req, res) => res.json(await admin.listGroups((req.query as any).page))));
ad.get('/activity', asyncHandler(async (_q, res) => res.json({ items: await admin.activity() })));
ad.get('/reports', validate({ query: z.object({ status: z.enum(['open', 'reviewed', 'dismissed']).optional() }) }), asyncHandler(async (req, res) => res.json({ items: await admin.listReports((req.query as any).status) })));
ad.patch('/reports/:id', validate({ params: idParam, body: z.object({ status: z.enum(['reviewed', 'dismissed']), adminNote: z.string().max(300).optional() }) }), asyncHandler(async (req, res) => { await admin.updateReport(actorOf(req), req.params.id, req.body.status, req.body.adminNote); res.json({ ok: true }); }));
r.use('/admin', ad);

void badRequest; void forbidden;
export default r;
