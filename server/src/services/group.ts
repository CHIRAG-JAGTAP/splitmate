import { z } from 'zod';
import { runTx } from '../config/db.js';
import { CATEGORIES, GROUP_TYPES } from '../constants.js';
import { computeNetBalances } from '../engine/balances.js';
import { Expense, ExpenseSplit, Group, GroupMember, Invitation, Settlement, User } from '../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { randomCode, sha256 } from '../utils/security.js';
import { actorOf, audit, notify, requireGroupAdmin, requireMember, userCards, type Actor } from './core.js';
import { loadLedger, userSummary } from './balance.js';

export const groupBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  type: z.enum(GROUP_TYPES).default('friends'),
  simplifyDebts: z.boolean().optional(),
});
export const groupPatch = groupBody.partial();
void CATEGORIES;

export async function uniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const c = randomCode(8);
    if (!(await Group.exists({ inviteCode: c }))) return c;
  }
  throw new Error('Could not generate invite code');
}

export async function createGroup(actor: Actor, input: z.infer<typeof groupBody>) {
  return runTx(async (session) => {
    const [g] = await Group.create([{ ...input, createdBy: actor.id, inviteCode: await uniqueInviteCode() }], { session });
    await GroupMember.create([{ groupId: g._id, userId: actor.id, role: 'owner' }], { session });
    await audit(actor, 'group.create', 'Group', g._id, { groupId: g._id, after: { name: g.name, type: g.type } }, session);
    return g;
  });
}

export async function listGroups(userId: string) {
  const mems = await GroupMember.find({ userId, status: 'active' });
  const ids = mems.map((m) => String(m.groupId));
  const groups = await Group.find({ _id: { $in: ids }, archivedAt: { $exists: false } }).sort({ updatedAt: -1 });
  const counts = await GroupMember.aggregate([{ $match: { groupId: { $in: groups.map((g) => g._id) }, status: 'active' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n as number]));
  const summary = await userSummary(userId, groups.map((g) => String(g._id)));
  const netMap = new Map(summary.perGroup.map((p) => [p.groupId, p.netPaise]));
  const roleMap = new Map(mems.map((m) => [String(m.groupId), m.role]));
  return groups.map((g) => ({ ...fmtGroup(g), memberCount: countMap.get(String(g._id)) ?? 0, myNetPaise: netMap.get(String(g._id)) ?? 0, myRole: roleMap.get(String(g._id)) }));
}

export const fmtGroup = (g: any) => ({ id: String(g._id), name: g.name, description: g.description, type: g.type, currency: g.currency, simplifyDebts: g.simplifyDebts, createdBy: String(g.createdBy), createdAt: g.createdAt });

export async function getGroup(groupId: string, userId: string) {
  const me = await requireMember(groupId, userId);
  const g = await Group.findById(groupId);
  if (!g) throw notFound('Group not found');
  const out: any = { ...fmtGroup(g), myRole: me.role };
  if (me.role !== 'member') out.inviteCode = g.inviteCode; // only admins see the join code
  return out;
}

export async function updateGroup(actor: Actor, groupId: string, input: z.infer<typeof groupPatch>) {
  await requireGroupAdmin(groupId, actor.id);
  const g = await Group.findById(groupId);
  if (!g) throw notFound('Group not found');
  const before = { name: g.name, description: g.description, type: g.type, simplifyDebts: g.simplifyDebts };
  Object.assign(g, input);
  await g.save();
  await audit(actor, 'group.update', 'Group', g._id, { groupId: g._id, before, after: input });
  return g;
}

export async function groupNetsAllZero(groupId: string) {
  const { expenses, settlements } = await loadLedger(groupId);
  return [...computeNetBalances(expenses, settlements).values()].every((v) => v === 0);
}

export async function deleteGroup(actor: Actor, groupId: string) {
  const m = await requireMember(groupId, actor.id);
  if (m.role !== 'owner') throw forbidden('Only the group owner can delete a group');
  if (!(await groupNetsAllZero(groupId))) throw conflict('All balances must be settled before the group can be deleted');
  if (await Settlement.exists({ groupId, status: 'pending' })) throw conflict('Resolve pending settlements first');
  await runTx(async (session) => {
    await ExpenseSplit.deleteMany({ groupId }, { session });
    await Expense.deleteMany({ groupId }, { session });
    await Settlement.deleteMany({ groupId }, { session });
    await Invitation.deleteMany({ groupId }, { session });
    await GroupMember.deleteMany({ groupId }, { session });
    await Group.deleteOne({ _id: groupId }, { session });
    await audit(actor, 'group.delete', 'Group', groupId, { groupId });
  });
}

export async function listMembers(groupId: string, userId: string) {
  await requireMember(groupId, userId);
  const ms = await GroupMember.find({ groupId, status: 'active' }).sort({ joinedAt: 1 });
  const cards = await userCards(ms.map((m) => m.userId));
  return ms.map((m) => ({ ...cards.get(String(m.userId))!, role: m.role, joinedAt: m.joinedAt }));
}

async function addMemberRecord(groupId: string, userId: string, actor: Actor) {
  const existing = await GroupMember.findOne({ groupId, userId });
  if (existing?.status === 'active') throw conflict('Already a member of this group');
  if (existing) { existing.status = 'active'; existing.role = 'member'; existing.joinedAt = new Date(); await existing.save(); }
  else await GroupMember.create({ groupId, userId, role: 'member' });
  const g = await Group.findById(groupId);
  const u = await User.findById(userId);
  await audit(actor, 'group.member_add', 'Group', groupId, { groupId, after: { userId, name: u?.name } });
  const others = (await GroupMember.find({ groupId, status: 'active', userId: { $ne: userId } })).map((m) => m.userId);
  await notify(others, { type: 'group_activity', title: `${u?.name} joined ${g?.name}`, link: `/groups/${groupId}` });
}

/** Add an already-registered user directly by e-mail. */
export async function addMemberByEmail(actor: Actor, groupId: string, email: string) {
  await requireGroupAdmin(groupId, actor.id);
  const u = await User.findOne({ email: email.toLowerCase() });
  if (!u) throw notFound('No registered user with that e-mail. Send them an invitation instead.');
  if (u.status === 'suspended') throw badRequest('That account is suspended');
  await addMemberRecord(groupId, String(u._id), actor);
  const g = await Group.findById(groupId);
  await notify([u._id], { type: 'group_invite', title: `You were added to ${g?.name}`, link: `/groups/${groupId}` });
  return { id: String(u._id), name: u.name };
}

export async function setMemberRole(actor: Actor, groupId: string, userId: string, role: 'admin' | 'member') {
  const me = await requireMember(groupId, actor.id);
  if (me.role !== 'owner') throw forbidden('Only the owner can change roles');
  const t = await GroupMember.findOne({ groupId, userId, status: 'active' });
  if (!t) throw notFound('Member not found');
  if (t.role === 'owner') throw badRequest('The owner role cannot be changed');
  t.role = role; await t.save();
  await audit(actor, 'group.member_role', 'Group', groupId, { groupId, after: { userId, role } });
}

async function memberBalance(groupId: string, userId: string) {
  const { expenses, settlements } = await loadLedger(groupId);
  return computeNetBalances(expenses, settlements).get(userId) ?? 0;
}

export async function removeMember(actor: Actor, groupId: string, userId: string, mode: 'remove' | 'leave') {
  const me = await requireMember(groupId, actor.id);
  const target = await GroupMember.findOne({ groupId, userId, status: 'active' });
  if (!target) throw notFound('Member not found');
  if (mode === 'remove') {
    if (me.role === 'member') throw forbidden('Only admins can remove members');
    if (target.role === 'owner') throw forbidden('The owner cannot be removed');
    if (target.role === 'admin' && me.role !== 'owner') throw forbidden('Only the owner can remove an admin');
  } else if (target.role === 'owner') throw badRequest('The owner cannot leave. Delete the group or transfer ownership first.');
  if ((await memberBalance(groupId, userId)) !== 0) throw conflict('This member still has an unsettled balance');
  if (await Settlement.exists({ groupId, status: 'pending', $or: [{ fromUser: userId }, { toUser: userId }] })) throw conflict('This member has a pending settlement');
  target.status = mode === 'leave' ? 'left' : 'removed';
  await target.save();
  await audit(actor, mode === 'leave' ? 'group.member_leave' : 'group.member_remove', 'Group', groupId, { groupId, after: { userId } });
  if (mode === 'remove') {
    const g = await Group.findById(groupId);
    await notify([userId], { type: 'group_activity', title: `You were removed from ${g?.name}` });
  }
}

/* ---------------- invitations ---------------- */
export const inviteBody = z.object({ email: z.string().trim().toLowerCase().email().optional() });

export async function createInvitation(actor: Actor, groupId: string, email?: string) {
  await requireGroupAdmin(groupId, actor.id);
  const g = await Group.findById(groupId);
  const code = randomCode(10);
  const inv = await Invitation.create({ groupId, invitedBy: actor.id, email, codeHash: sha256(code), expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  await audit(actor, 'invitation.create', 'Invitation', inv._id, { groupId, after: { email } });
  if (email) {
    const u = await User.findOne({ email });
    if (u) await notify([u._id], { type: 'group_invite', title: `Invitation to join ${g?.name}`, body: 'Open Invitations to accept or decline.', link: '/invitations', meta: { invitationId: String(inv._id) } });
  }
  return { id: String(inv._id), code, email: email ?? null, expiresAt: inv.expiresAt, groupCode: g!.inviteCode };
}

export async function listInvitations(groupId: string, userId: string) {
  await requireGroupAdmin(groupId, userId);
  const invs = await Invitation.find({ groupId, status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  return invs.map((i) => ({ id: String(i._id), email: i.email ?? null, expiresAt: i.expiresAt, createdAt: i.createdAt }));
}

export async function revokeInvitation(actor: Actor, id: string) {
  const inv = await Invitation.findById(id);
  if (!inv) throw notFound('Invitation not found');
  await requireGroupAdmin(String(inv.groupId), actor.id);
  inv.status = 'revoked'; await inv.save();
  await audit(actor, 'invitation.revoke', 'Invitation', id, { groupId: inv.groupId });
}

export async function joinByCode(actor: Actor, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  let groupId: string | undefined;
  const g = await Group.findOne({ inviteCode: code, archivedAt: { $exists: false } });
  if (g) groupId = String(g._id);
  else {
    const inv = await Invitation.findOne({ codeHash: sha256(rawCode.trim()), status: 'pending', expiresAt: { $gt: new Date() } })
      ?? await Invitation.findOne({ codeHash: sha256(code), status: 'pending', expiresAt: { $gt: new Date() } });
    if (inv) {
      const me = await User.findById(actor.id);
      if (inv.email && inv.email !== me?.email) throw forbidden('This invitation was sent to a different e-mail address');
      groupId = String(inv.groupId); inv.status = 'accepted'; await inv.save();
    }
  }
  if (!groupId) throw notFound('Invalid or expired invitation code');
  await addMemberRecord(groupId, actor.id, actor);
  return { groupId };
}

export async function myInvitations(userId: string) {
  const me = await User.findById(userId);
  const invs = await Invitation.find({ email: me!.email, status: 'pending', expiresAt: { $gt: new Date() } });
  const groups = new Map((await Group.find({ _id: { $in: invs.map((i) => i.groupId) } })).map((g) => [String(g._id), g]));
  const inviters = await userCards(invs.map((i) => i.invitedBy));
  return invs.map((i) => ({ id: String(i._id), groupId: String(i.groupId), groupName: groups.get(String(i.groupId))?.name ?? 'Group', invitedBy: inviters.get(String(i.invitedBy))?.name ?? 'Someone', expiresAt: i.expiresAt }));
}

export async function respondInvitation(actor: Actor, id: string, accept: boolean) {
  const me = await User.findById(actor.id);
  const inv = await Invitation.findOne({ _id: id, email: me!.email, status: 'pending', expiresAt: { $gt: new Date() } });
  if (!inv) throw notFound('Invitation not found or expired');
  inv.status = accept ? 'accepted' : 'declined'; await inv.save();
  if (accept) await addMemberRecord(String(inv.groupId), actor.id, actor);
  return { groupId: String(inv.groupId) };
}

export async function groupActivity(groupId: string, userId: string, limit = 50) {
  await requireMember(groupId, userId);
  const logs = await (await import('../models/index.js')).AuditLog.find({ groupId }).sort({ createdAt: -1 }).limit(limit);
  const cards = await userCards(logs.map((l) => l.actorId).filter(Boolean));
  return logs.map((l) => ({ id: String(l._id), action: l.action, actor: cards.get(String(l.actorId)) ?? null, at: (l as any).createdAt, detail: summarize(l) }));
}
function summarize(l: any): string {
  const a = l.after ?? {};
  switch (l.action) {
    case 'expense.create': return `added "${a.description}"`;
    case 'expense.update': return `edited "${a.description ?? l.before?.description}"`;
    case 'expense.delete': return `deleted "${l.before?.description}"`;
    case 'settlement.create': return 'recorded a payment';
    case 'settlement.confirm': return 'confirmed a payment';
    case 'settlement.reject': return 'rejected a payment';
    case 'settlement.cancel': return 'cancelled a payment';
    case 'group.create': return `created the group`;
    case 'group.update': return 'updated the group';
    case 'group.member_add': return `added ${a.name ?? 'a member'}`;
    case 'group.member_leave': return 'left the group';
    case 'group.member_remove': return 'removed a member';
    case 'group.member_role': return `changed a member's role to ${a.role}`;
    default: return l.action.replace('.', ' ');
  }
}
export { actorOf };
