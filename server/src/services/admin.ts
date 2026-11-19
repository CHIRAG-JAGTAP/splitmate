import { z } from 'zod';
import { AbuseReport, AuditLog, Expense, Group, GroupMember, Notification, Session, Settlement, User } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../utils/http.js';
import { audit, notify, userCards, type Actor } from './core.js';

export async function platformStats() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [users, suspended, groups, expenses, settlements, pendingSettlements, openReports, newUsers, volume, byDay] = await Promise.all([
    User.countDocuments(), User.countDocuments({ status: 'suspended' }), Group.countDocuments(),
    Expense.countDocuments({ deletedAt: { $exists: false } }), Settlement.countDocuments({ status: 'completed' }), Settlement.countDocuments({ status: 'pending' }),
    AbuseReport.countDocuments({ status: 'open' }), User.countDocuments({ createdAt: { $gte: since } }),
    Expense.aggregate([{ $match: { deletedAt: { $exists: false } } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
    User.aggregate([{ $match: { createdAt: { $gte: new Date(Date.now() - 14 * 86_400_000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  return { users, suspended, groups, expenses, completedSettlements: settlements, pendingSettlements, openReports, newUsersLast7Days: newUsers, totalVolumePaise: volume[0]?.total ?? 0, signupsByDay: byDay.map((d) => ({ date: d._id, count: d.n })) };
}

export const adminUsersQuery = z.object({ q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export async function listUsers(q: z.infer<typeof adminUsersQuery>) {
  const f: any = {};
  if (q.q) { const rx = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }; f.$or = [{ name: rx }, { email: rx }]; }
  const [total, users] = await Promise.all([User.countDocuments(f), User.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit)]);
  const counts = await GroupMember.aggregate([{ $match: { userId: { $in: users.map((u) => u._id) }, status: 'active' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
  const cm = new Map(counts.map((c) => [String(c._id), c.n]));
  return { total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)), items: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status, suspendedReason: u.suspendedReason ?? null, groups: cm.get(String(u._id)) ?? 0, lastLoginAt: u.lastLoginAt ?? null, createdAt: (u as any).createdAt })) };
}

export async function setSuspended(actor: Actor, userId: string, suspend: boolean, reason?: string) {
  if (userId === actor.id) throw badRequest('You cannot suspend your own account');
  const u = await User.findById(userId);
  if (!u) throw notFound('User not found');
  if (u.role === 'admin') throw forbidden('Admin accounts cannot be suspended here');
  u.status = suspend ? 'suspended' : 'active'; u.suspendedReason = suspend ? reason?.slice(0, 200) : undefined;
  await u.save();
  if (suspend) await Session.updateMany({ userId, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  await audit(actor, suspend ? 'admin.suspend' : 'admin.reinstate', 'User', userId, { after: { reason } });
  return { id: userId, status: u.status };
}

export async function listGroups(page = 1, limit = 20) {
  const [total, groups] = await Promise.all([Group.countDocuments(), Group.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)]);
  const ids = groups.map((g) => g._id);
  const [mc, ec] = await Promise.all([
    GroupMember.aggregate([{ $match: { groupId: { $in: ids }, status: 'active' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]),
    Expense.aggregate([{ $match: { groupId: { $in: ids }, deletedAt: { $exists: false } } }, { $group: { _id: '$groupId', n: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
  ]);
  const cards = await userCards(groups.map((g) => g.createdBy));
  const m = new Map(mc.map((x) => [String(x._id), x.n])), e = new Map(ec.map((x) => [String(x._id), x]));
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), items: groups.map((g) => ({ id: String(g._id), name: g.name, type: g.type, owner: cards.get(String(g.createdBy))?.name, members: m.get(String(g._id)) ?? 0, expenses: e.get(String(g._id))?.n ?? 0, volumePaise: e.get(String(g._id))?.total ?? 0, createdAt: (g as any).createdAt })) };
}

export async function activity(limit = 100) {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit);
  const cards = await userCards(logs.map((l) => l.actorId).filter(Boolean));
  return logs.map((l) => ({ id: String(l._id), action: l.action, entityType: l.entityType, entityId: l.entityId, actor: cards.get(String(l.actorId))?.name ?? 'system', ip: l.ip, at: (l as any).createdAt }));
}

export const reportBody = z.object({ targetType: z.enum(['user', 'group', 'expense']), targetId: z.string().min(1).max(40), reason: z.string().trim().min(5).max(500) });
export async function createReport(actor: Actor, input: z.infer<typeof reportBody>) {
  const r = await AbuseReport.create({ reporterId: actor.id, ...input });
  const admins = await User.find({ role: 'admin' }).select('_id');
  await notify(admins.map((a) => a._id), { type: 'abuse_report', title: 'New abuse report', body: input.reason.slice(0, 100), link: '/admin/reports' });
  return { id: String(r._id) };
}
export async function listReports(status?: string) {
  const reports = await AbuseReport.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200);
  const cards = await userCards(reports.map((r) => r.reporterId));
  return reports.map((r) => ({ id: String(r._id), reporter: cards.get(String(r.reporterId))?.name, targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status, adminNote: r.adminNote ?? null, createdAt: (r as any).createdAt }));
}
export async function updateReport(actor: Actor, id: string, status: 'reviewed' | 'dismissed', adminNote?: string) {
  const r = await AbuseReport.findById(id);
  if (!r) throw notFound('Report not found');
  r.status = status; r.adminNote = adminNote?.slice(0, 300); await r.save();
  await audit(actor, 'admin.report', 'AbuseReport', id, { after: { status } });
}
void Notification;
