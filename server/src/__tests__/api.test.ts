import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearDb, startDb, stopDb } from './setup.js';

let app: any;
const H = { 'X-Requested-With': 'SplitMate' };
beforeAll(async () => { await startDb(); app = (await import('../app.js')).createApp(); });
afterAll(stopDb);
beforeEach(clearDb);

async function signup(name: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').set(H).send({ name, email: `${name.toLowerCase()}@test.dev`, password: 'Passw0rdX' });
  expect(res.status).toBe(201);
  return { agent, id: res.body.user.id as string };
}
const post = (a: any, url: string, body: object = {}) => a.post(`/api/v1${url}`).set(H).send(body);
const get = (a: any, url: string) => a.get(`/api/v1${url}`);

async function groupOf(...users: { agent: any; id: string }[]) {
  const g = await post(users[0].agent, '/groups', { name: 'Trip', type: 'trips' });
  expect(g.status).toBe(201);
  for (const u of users.slice(1)) {
    const email = `${(await get(u.agent, '/auth/me')).body.user.email}`;
    expect((await post(users[0].agent, `/groups/${g.body.group.id}/members`, { email })).status).toBe(201);
  }
  return g.body.group.id as string;
}
const expenseBody = (paidBy: string, ids: string[], amountPaise = 3000, splitMethod = 'equal') => ({
  description: 'Dinner', category: 'food', amountPaise, paidBy, splitMethod, participants: ids.map((userId) => ({ userId })), expenseDate: new Date().toISOString(),
});

describe('auth', () => {
  it('registers, rejects weak passwords and duplicate e-mails', async () => {
    const a = request(app);
    expect((await a.post('/api/v1/auth/register').set(H).send({ name: 'Al', email: 'al@t.dev', password: 'weak' })).status).toBe(400);
    await signup('Alice');
    expect((await a.post('/api/v1/auth/register').set(H).send({ name: 'Alice', email: 'alice@test.dev', password: 'Passw0rdX' })).status).toBe(409);
  });
  it('login / me / logout and wrong password', async () => {
    await signup('Alice');
    const agent = request.agent(app);
    expect((await post(agent, '/auth/login', { email: 'alice@test.dev', password: 'nope' })).status).toBe(401);
    expect((await post(agent, '/auth/login', { email: 'alice@test.dev', password: 'Passw0rdX' })).status).toBe(200);
    expect((await get(agent, '/auth/me')).body.user.email).toBe('alice@test.dev');
    await post(agent, '/auth/logout');
    expect((await get(agent, '/auth/me')).status).toBe(401);
  });
  it('blocks unauthenticated access and missing CSRF header', async () => {
    expect((await request(app).get('/api/v1/groups')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x' })).status).toBe(403);
  });
  it('forgot/reset password flow via dev outbox', async () => {
    await signup('Alice');
    const a = request(app);
    await a.post('/api/v1/auth/forgot-password').set(H).send({ email: 'alice@test.dev' });
    const link = (await a.get('/api/v1/dev/outbox')).body.items[0].link as string;
    const token = new URL(link).searchParams.get('token');
    expect((await a.post('/api/v1/auth/reset-password').set(H).send({ token, password: 'NewPassw0rd' })).status).toBe(200);
    expect((await a.post('/api/v1/auth/reset-password').set(H).send({ token, password: 'Another1Pass' })).status).toBe(400); // single use
    expect((await a.post('/api/v1/auth/login').set(H).send({ email: 'alice@test.dev', password: 'NewPassw0rd' })).status).toBe(200);
  });
  it('admin routes reject normal users', async () => {
    const u = await signup('Alice');
    expect((await get(u.agent, '/admin/stats')).status).toBe(403);
  });
});

describe('groups & permissions', () => {
  it('creates a group and lists it; outsiders cannot read it', async () => {
    const a = await signup('Alice'), eve = await signup('Eve');
    const gid = await groupOf(a);
    expect((await get(a.agent, '/groups')).body.items).toHaveLength(1);
    expect((await get(eve.agent, `/groups/${gid}`)).status).toBe(403);
    expect((await get(eve.agent, `/groups/${gid}/expenses`)).status).toBe(403);
  });
  it('joins with invite code; plain members cannot add members or see the code', async () => {
    const a = await signup('Alice'), b = await signup('Bob'), c = await signup('Carol');
    const gid = await groupOf(a);
    const code = (await get(a.agent, `/groups/${gid}`)).body.group.inviteCode;
    expect((await post(b.agent, '/invitations/join', { code })).status).toBe(200);
    expect((await get(b.agent, `/groups/${gid}`)).body.group.inviteCode).toBeUndefined();
    expect((await post(b.agent, `/groups/${gid}/members`, { email: 'carol@test.dev' })).status).toBe(403);
    expect((await post(c.agent, '/invitations/join', { code: 'WRONGCODE' })).status).toBe(404);
  });
  it('only the owner can delete a group', async () => {
    const a = await signup('Alice'), b = await signup('Bob');
    const gid = await groupOf(a, b);
    expect((await b.agent.delete(`/api/v1/groups/${gid}`).set(H)).status).toBe(403);
    expect((await a.agent.delete(`/api/v1/groups/${gid}`).set(H)).status).toBe(200);
  });
});

describe('expenses, balances, simplification', () => {
  it('creates an equal-split expense and derives balances', async () => {
    const a = await signup('Alice'), b = await signup('Bob'), c = await signup('Carol');
    const gid = await groupOf(a, b, c);
    const r = await post(a.agent, `/groups/${gid}/expenses`, expenseBody(a.id, [a.id, b.id, c.id], 1000));
    expect(r.status).toBe(201);
    expect(r.body.expense.splits.map((s: any) => s.owedPaise).sort()).toEqual([333, 333, 334]);
    const bal = (await get(a.agent, `/groups/${gid}/balances`)).body;
    expect(bal.balances.reduce((x: number, y: any) => x + y.netPaise, 0)).toBe(0);
    expect(bal.balances.find((x: any) => x.userId === a.id).netPaise).toBeGreaterThan(0);
  });
  it('rejects bad splits (server-side validation)', async () => {
    const a = await signup('Alice'), b = await signup('Bob');
    const gid = await groupOf(a, b);
    const bad = { ...expenseBody(a.id, [a.id, b.id], 1000, 'exact'), participants: [{ userId: a.id, value: 100 }, { userId: b.id, value: 100 }] };
    expect((await post(a.agent, `/groups/${gid}/expenses`, bad)).status).toBe(400);
    expect((await post(a.agent, `/groups/${gid}/expenses`, { ...expenseBody(a.id, [a.id, b.id]), amountPaise: 10.5 })).status).toBe(400);
  });
  it('outsiders cannot be participants; non-members cannot add expenses', async () => {
    const a = await signup('Alice'), b = await signup('Bob'), eve = await signup('Eve');
    const gid = await groupOf(a, b);
    expect((await post(a.agent, `/groups/${gid}/expenses`, expenseBody(a.id, [a.id, eve.id]))).status).toBe(400);
    expect((await post(eve.agent, `/groups/${gid}/expenses`, expenseBody(eve.id, [eve.id]))).status).toBe(403);
  });
  it('edit recalculates and delete removes from balances; member cannot edit others expenses', async () => {
    const a = await signup('Alice'), b = await signup('Bob'), c = await signup('Carol');
    const gid = await groupOf(a, b, c);
    const e = (await post(a.agent, `/groups/${gid}/expenses`, expenseBody(a.id, [a.id, b.id], 2000))).body.expense;
    const bobNet = async () => (await get(a.agent, `/groups/${gid}/balances`)).body.balances.find((x: any) => x.userId === b.id).netPaise;
    expect(await bobNet()).toBe(-1000);
    expect((await a.agent.patch(`/api/v1/expenses/${e.id}`).set(H).send(expenseBody(a.id, [a.id, b.id], 4000))).status).toBe(200);
    expect(await bobNet()).toBe(-2000);
    expect((await c.agent.patch(`/api/v1/expenses/${e.id}`).set(H).send(expenseBody(a.id, [a.id, b.id], 100))).status).toBe(403);
    expect((await a.agent.delete(`/api/v1/expenses/${e.id}`).set(H)).status).toBe(200);
    expect(await bobNet()).toBe(0);
  });
  it('simplifies a three-person cycle to two transfers', async () => {
    const A = await signup('Alice'), B = await signup('Bob'), C = await signup('Carol');
    const gid = await groupOf(A, B, C);
    const one = (payer: any, owes: any, amt: number) => post(payer.agent, `/groups/${gid}/expenses`, { ...expenseBody(payer.id, [owes.id], amt, 'equal') });
    await one(B, A, 50000); await one(C, B, 30000); await one(A, C, 20000);
    const b = (await get(A.agent, `/groups/${gid}/balances`)).body;
    expect(b.pairwise).toHaveLength(3);
    expect(b.simplified).toHaveLength(2);
  });
});

describe('settlements', () => {
  async function setup() {
    const a = await signup('Alice'), b = await signup('Bob');
    const gid = await groupOf(a, b);
    await post(a.agent, `/groups/${gid}/expenses`, expenseBody(a.id, [a.id, b.id], 10000)); // bob owes alice 5000
    return { a, b, gid };
  }
  const pay = (u: any, gid: string, to: string, amountPaise: number, key = Math.random().toString(36).slice(2) + 'abcdefgh') => post(u.agent, `/groups/${gid}/settlements`, { toUser: to, amountPaise, method: 'cash', idempotencyKey: key });

  it('pending does not change balances; confirm does (partial allowed)', async () => {
    const { a, b, gid } = await setup();
    const s = await pay(b, gid, a.id, 2000);
    expect(s.status).toBe(201);
    const net = async () => (await get(a.agent, `/groups/${gid}/balances`)).body.balances.find((x: any) => x.userId === b.id).netPaise;
    expect(await net()).toBe(-5000);
    expect((await post(b.agent, `/settlements/${s.body.settlement.id}/confirm`)).status).toBe(403); // payer cannot self-confirm
    expect((await post(a.agent, `/settlements/${s.body.settlement.id}/confirm`)).status).toBe(200);
    expect(await net()).toBe(-3000);
    expect((await post(a.agent, `/settlements/${s.body.settlement.id}/confirm`)).status).toBe(409); // already completed
  });
  it('is idempotent and caps overpayment', async () => {
    const { a, b, gid } = await setup();
    const k = 'unique-key-12345';
    const s1 = await pay(b, gid, a.id, 1000, k), s2 = await pay(b, gid, a.id, 1000, k);
    expect(s2.body.settlement.id).toBe(s1.body.settlement.id);
    expect((await pay(b, gid, a.id, 9999)).status).toBe(400);
    expect((await pay(a, gid, b.id, 100)).status).toBe(400); // alice owes nothing
  });
  it('reject and cancel work and leave balances unchanged', async () => {
    const { a, b, gid } = await setup();
    const s = (await pay(b, gid, a.id, 1000)).body.settlement;
    expect((await post(a.agent, `/settlements/${s.id}/reject`, { reason: 'not received' })).status).toBe(200);
    const s2 = (await pay(b, gid, a.id, 1000)).body.settlement;
    expect((await post(a.agent, `/settlements/${s2.id}/cancel`)).status).toBe(403);
    expect((await post(b.agent, `/settlements/${s2.id}/cancel`)).status).toBe(200);
    expect((await get(a.agent, `/groups/${gid}/balances`)).body.balances.find((x: any) => x.userId === b.id).netPaise).toBe(-5000);
  });
  it('members with a balance cannot leave', async () => {
    const { b, gid } = await setup();
    expect((await post(b.agent, `/groups/${gid}/leave`)).status).toBe(409);
  });
});

describe('budgets, notifications, analytics', () => {
  it('budget progress, warning notification, analytics and CSV', async () => {
    const a = await signup('Alice'), b = await signup('Bob');
    const gid = await groupOf(a, b);
    expect((await post(b.agent, '/budgets', { scope: 'category', category: 'food', limitPaise: 10000 })).status).toBe(201);
    await post(a.agent, `/groups/${gid}/expenses`, expenseBody(a.id, [a.id, b.id], 18000)); // bob share 9000 = 90%
    const bud = (await get(b.agent, '/budgets')).body.items[0];
    expect(bud.spentPaise).toBe(9000); expect(bud.status).toBe('warning');
    const notes = (await get(b.agent, '/notifications')).body.items;
    expect(notes.some((n: any) => n.type === 'budget_warning')).toBe(true);
    expect(notes.some((n: any) => n.type === 'expense_new')).toBe(true);
    expect((await get(b.agent, '/analytics/categories')).body.items[0]).toMatchObject({ category: 'food', totalPaise: 9000 });
    const csv = await get(b.agent, '/analytics/export.csv');
    expect(csv.text).toContain('Dinner'); expect(csv.headers['content-type']).toContain('text/csv');
    expect((await get(b.agent, '/dashboard')).body.summary.owePaise).toBe(9000);
    expect((await get(b.agent, '/analytics/insights')).body.items.length).toBeGreaterThan(0);
  });
});

describe('admin', () => {
  it('admin can suspend a user, who is then locked out', async () => {
    const { User } = await import('../models/index.js');
    const bob = await signup('Bob'); await signup('Root');
    await User.updateOne({ email: 'root@test.dev' }, { role: 'admin' });
    const agent = request.agent(app); await post(agent, '/auth/login', { email: 'root@test.dev', password: 'Passw0rdX' });
    expect((await get(agent, '/admin/stats')).status).toBe(200);
    expect((await agent.patch(`/api/v1/admin/users/${bob.id}/suspend`).set(H).send({ reason: 'abuse' })).status).toBe(200);
    expect((await get(bob.agent, '/groups')).status).toBe(403);
    expect((await post(request(app), '/auth/login', { email: 'bob@test.dev', password: 'Passw0rdX' })).status).toBe(403);
  });
});
