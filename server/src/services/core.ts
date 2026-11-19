import type { ClientSession, Types } from 'mongoose';
import { AuditLog, Group, GroupMember, Notification, User } from '../models/index.js';
import { forbidden, notFound } from '../utils/http.js';

/* ---------- audit ---------- */
export interface Actor { id: string; name?: string; ip?: string; requestId?: string }
export const actorOf = (req: { user?: { id: string; name?: string }; ip?: string; requestId?: string }): Actor => ({ id: req.user?.id ?? '', name: req.user?.name, ip: req.ip, requestId: req.requestId });

export async function audit(
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: unknown,
  extra: { groupId?: unknown; before?: unknown; after?: unknown } = {},
  session?: ClientSession,
) {
  await AuditLog.create(
    [{ actorId: actor?.id || undefined, action, entityType, entityId: String(entityId), groupId: extra.groupId as Types.ObjectId | undefined, before: extra.before, after: extra.after, ip: actor?.ip, requestId: actor?.requestId }],
    { session },
  );
}

/* ---------- notifications ---------- */
export async function notify(
  userIds: unknown[],
  n: { type: string; title: string; body?: string; link?: string; meta?: unknown },
  session?: ClientSession,
) {
  const unique = [...new Set(userIds.map(String))];
  if (!unique.length) return;
  await Notification.insertMany(unique.map((userId) => ({ userId, ...n })), { session });
}

/* ---------- group access ---------- */
export async function requireMember(groupId: string, userId: string) {
  const m = await GroupMember.findOne({ groupId, userId, status: 'active' });
  if (!m) {
    const exists = await Group.exists({ _id: groupId });
    throw exists ? forbidden('You are not a member of this group') : notFound('Group not found');
  }
  return m;
}
export async function requireGroupAdmin(groupId: string, userId: string) {
  const m = await requireMember(groupId, userId);
  if (m.role === 'member') throw forbidden('Only group admins can do that');
  return m;
}
export async function activeMemberIds(groupId: string): Promise<string[]> {
  const ms = await GroupMember.find({ groupId, status: 'active' }).select('userId');
  return ms.map((m) => String(m.userId));
}

export async function userCards(ids: unknown[]) {
  const users = await User.find({ _id: { $in: [...new Set(ids.map(String))] } }).select('name email avatarUrl upiId');
  return new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, email: u.email, avatarUrl: u.avatarUrl ?? null }]));
}
