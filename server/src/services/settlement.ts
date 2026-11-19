import { z } from 'zod';
import { runTx } from '../config/db.js';
import { pairwiseDebt } from '../engine/balances.js';
import { Group, Settlement, User } from '../models/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { activeMemberIds, audit, notify, requireMember, userCards, type Actor } from './core.js';
import { loadLedger } from './balance.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
export const settlementBody = z.object({
  toUser: id,
  amountPaise: z.number().int().positive().max(100_000_000_00),
  method: z.enum(['cash', 'upi_manual']),
  upiRef: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

async function currentDebt(groupId: string, from: string, to: string, excludeSettlementId?: string) {
  const { expenses, settlements } = await loadLedger(groupId);
  const debt = pairwiseDebt(expenses, settlements, from, to);
  const pending = await Settlement.find({ groupId, fromUser: from, toUser: to, status: 'pending', ...(excludeSettlementId && { _id: { $ne: excludeSettlementId } }) });
  return { debt, pending: pending.reduce((a, s) => a + s.amountPaise, 0) };
}

/** The PAYER records "I paid X". The RECEIVER then confirms or rejects. Money is never moved by this app. */
export async function createSettlement(actor: Actor, groupId: string, input: z.infer<typeof settlementBody>) {
  await requireMember(groupId, actor.id);
  const dup = await Settlement.findOne({ idempotencyKey: input.idempotencyKey });
  if (dup) {
    if (String(dup.requestedBy) !== actor.id) throw conflict('Duplicate request key');
    return fmt(dup);
  }
  if (input.toUser === actor.id) throw badRequest('You cannot pay yourself');
  const members = await activeMemberIds(groupId);
  if (!members.includes(input.toUser)) throw badRequest('Recipient is not an active member of this group');
  const { debt, pending } = await currentDebt(groupId, actor.id, input.toUser);
  if (input.amountPaise > debt - pending) throw badRequest(debt === 0 ? 'You do not owe this person anything in this group' : `You can settle at most ₹${((debt - pending) / 100).toFixed(2)} right now (₹${(debt / 100).toFixed(2)} owed, ₹${(pending / 100).toFixed(2)} already pending)`);
  const g = await Group.findById(groupId);
  const s = await runTx(async (session) => {
    const [s] = await Settlement.create([{ groupId, fromUser: actor.id, toUser: input.toUser, amountPaise: input.amountPaise, method: input.method, upiRef: input.method === 'upi_manual' ? input.upiRef : undefined, note: input.note ?? '', requestedBy: actor.id, idempotencyKey: input.idempotencyKey }], { session });
    await audit(actor, 'settlement.create', 'Settlement', s._id, { groupId, after: { amountPaise: s.amountPaise, to: input.toUser, method: s.method } }, session);
    await notify([input.toUser], { type: 'settlement_request', title: `${actor.name ?? 'Someone'} says they paid you`, body: `₹${(input.amountPaise / 100).toFixed(2)} in ${g?.name} - please confirm`, link: '/settlements', meta: { settlementId: String(s._id) } }, session);
    return s;
  });
  return fmt(s);
}

async function load(idv: string) {
  const s = await Settlement.findById(idv);
  if (!s) throw notFound('Settlement not found');
  return s;
}

export async function respond(actor: Actor, settlementId: string, action: 'confirm' | 'reject' | 'cancel', reason?: string) {
  const s = await load(settlementId);
  await requireMember(String(s.groupId), actor.id);
  if (s.status !== 'pending') throw conflict(`This settlement is already ${s.status}`);
  if (action === 'cancel') { if (String(s.requestedBy) !== actor.id) throw forbidden('Only the person who created it can cancel'); }
  else if (String(s.toUser) !== actor.id) throw forbidden('Only the receiver can confirm or reject a payment');
  if (action === 'confirm') {
    const { debt, pending } = await currentDebt(String(s.groupId), String(s.fromUser), String(s.toUser), String(s._id));
    void pending;
    if (s.amountPaise > debt) throw conflict('Balances changed since this was recorded (an expense was edited). Reject it and record a new payment.');
  }
  const next = action === 'confirm' ? 'completed' : action === 'reject' ? 'rejected' : 'cancelled';
  await runTx(async (session) => {
    s.status = next; s.respondedAt = new Date(); if (action === 'reject') s.rejectReason = reason?.slice(0, 200);
    await s.save({ session });
    await audit(actor, `settlement.${action}`, 'Settlement', s._id, { groupId: s.groupId, after: { amountPaise: s.amountPaise } }, session);
    const other = action === 'cancel' ? s.toUser : s.fromUser;
    const title = action === 'confirm' ? 'Payment confirmed' : action === 'reject' ? 'Payment rejected' : 'Payment request cancelled';
    await notify([other], { type: action === 'confirm' ? 'payment_confirmed' : 'settlement_update', title, body: `₹${(s.amountPaise / 100).toFixed(2)}${reason ? ` - ${reason}` : ''}`, link: '/settlements' }, session);
  });
  return fmt(s);
}

export async function fmtMany(list: any[]) {
  const cards = await userCards(list.flatMap((s) => [s.fromUser, s.toUser]));
  const groups = new Map((await Group.find({ _id: { $in: list.map((s) => s.groupId) } }).select('name')).map((g) => [String(g._id), g.name]));
  return list.map((s) => ({ id: String(s._id), groupId: String(s.groupId), groupName: groups.get(String(s.groupId)) ?? '', fromUser: cards.get(String(s.fromUser)), toUser: cards.get(String(s.toUser)), amountPaise: s.amountPaise, method: s.method, upiRef: s.upiRef ?? null, status: s.status, note: s.note, requestedBy: String(s.requestedBy), rejectReason: s.rejectReason ?? null, createdAt: s.createdAt, respondedAt: s.respondedAt ?? null }));
}
const fmt = async (s: any) => (await fmtMany([s]))[0];

export async function listForGroup(userId: string, groupId: string) {
  await requireMember(groupId, userId);
  return fmtMany(await Settlement.find({ groupId }).sort({ createdAt: -1 }).limit(200));
}
export async function listMine(userId: string, status?: string) {
  const f: any = { $or: [{ fromUser: userId }, { toUser: userId }] };
  if (status) f.status = status;
  return fmtMany(await Settlement.find(f).sort({ createdAt: -1 }).limit(200));
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export async function receiptHtml(userId: string, settlementId: string) {
  const s = await load(settlementId);
  await requireMember(String(s.groupId), userId);
  const [f] = await fmt(s).then((x) => [x]);
  const rupees = (s.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Settlement receipt</title><style>
body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#1c1917}
.card{border:1px solid #e7e5e4;border-radius:16px;padding:28px}h1{margin:0 0 4px;font-size:20px}.muted{color:#78716c;font-size:13px}
.amt{font-size:38px;font-weight:700;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:8px 0;border-top:1px solid #f5f5f4;font-size:14px}td:first-child{color:#78716c}
.badge{display:inline-block;padding:3px 10px;border-radius:99px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600}.warn{margin-top:18px;font-size:12px;color:#78716c}
@media print{.noprint{display:none}}</style></head><body><div class="card">
<h1>SplitMate settlement receipt</h1><div class="muted">Receipt #${esc(s._id)}</div>
<div class="amt">₹${rupees}</div><span class="badge">${esc(s.status.toUpperCase())}</span>
<table><tr><td>From</td><td>${esc(f.fromUser?.name)}</td></tr><tr><td>To</td><td>${esc(f.toUser?.name)}</td></tr><tr><td>Group</td><td>${esc(f.groupName)}</td></tr>
<tr><td>Method</td><td>${s.method === 'cash' ? 'Cash' : 'UPI (manually confirmed)'}</td></tr>${s.upiRef ? `<tr><td>UPI reference</td><td>${esc(s.upiRef)}</td></tr>` : ''}
<tr><td>Recorded</td><td>${esc(new Date((s as any).createdAt).toLocaleString('en-IN'))}</td></tr>${s.respondedAt ? `<tr><td>Responded</td><td>${esc(s.respondedAt.toLocaleString('en-IN'))}</td></tr>` : ''}
${s.note ? `<tr><td>Note</td><td>${esc(s.note)}</td></tr>` : ''}</table>
<p class="warn">SplitMate does not process payments. This receipt records a payment that the two members confirmed between themselves.</p>
<button class="noprint" onclick="print()">Print / Save as PDF</button></div></body></html>`;
}

/** Payment instructions: payee details + a UPI deep link the payer can open in their own UPI app. We never move money. */
export async function paymentInstructions(userId: string, payeeId: string, groupId: string, amountPaise?: number) {
  await requireMember(groupId, userId);
  await requireMember(groupId, payeeId);
  const u = await User.findById(payeeId);
  if (!u) throw notFound('User not found');
  const link = u.upiId ? `upi://pay?pa=${encodeURIComponent(u.upiId)}&pn=${encodeURIComponent(u.name)}${amountPaise ? `&am=${(amountPaise / 100).toFixed(2)}` : ''}&cu=INR&tn=${encodeURIComponent('SplitMate settlement')}` : null;
  return { payee: { id: String(u._id), name: u.name }, upiId: u.upiId ?? null, upiLink: link, instructions: u.upiId ? `Pay ${u.name} using UPI ID ${u.upiId} in your own UPI app, then record the payment here so they can confirm it.` : `${u.name} has not added a UPI ID. Pay in cash or ask them for details, then record the payment here.` };
}
void HttpError;
