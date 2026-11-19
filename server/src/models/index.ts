import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { CATEGORIES, GROUP_TYPES } from '../constants.js';

const ref = (name: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true } as const;

/* ---------------- Users ---------------- */
const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  avatarUrl: { type: String },
  upiId: { type: String, trim: true, maxlength: 80 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  suspendedReason: String,
  theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
  lastLoginAt: Date,
  resetTokenHash: { type: String, select: false },
  resetExpiresAt: { type: Date, select: false },
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date,
}, opts);
export const User = mongoose.model('User', userSchema);

/* ---------------- Sessions (refresh tokens, hashed) ---------------- */
const sessionSchema = new Schema({
  userId: ref('User', { required: true, index: true }),
  refreshTokenHash: { type: String, required: true, index: true },
  userAgent: String,
  ip: String,
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
}, opts);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = mongoose.model('Session', sessionSchema);

/* ---------------- Groups & members ---------------- */
const groupSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  type: { type: String, enum: GROUP_TYPES, default: 'friends' },
  currency: { type: String, default: 'INR' },
  createdBy: ref('User', { required: true, index: true }),
  inviteCode: { type: String, required: true, unique: true },
  simplifyDebts: { type: Boolean, default: true },
  archivedAt: Date,
}, opts);
export const Group = mongoose.model('Group', groupSchema);

const memberSchema = new Schema({
  groupId: ref('Group', { required: true }),
  userId: ref('User', { required: true, index: true }),
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  status: { type: String, enum: ['active', 'left', 'removed'], default: 'active' },
  joinedAt: { type: Date, default: Date.now },
}, opts);
memberSchema.index({ groupId: 1, userId: 1 }, { unique: true });
export const GroupMember = mongoose.model('GroupMember', memberSchema);

/* ---------------- Expenses & splits ---------------- */
const expenseSchema = new Schema({
  groupId: ref('Group', { required: true }),
  description: { type: String, required: true, trim: true, maxlength: 200 },
  category: { type: String, enum: CATEGORIES, default: 'other' },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  paidBy: ref('User', { required: true, index: true }),
  splitMethod: { type: String, enum: ['equal', 'exact', 'percentage', 'shares', 'unequal'], required: true },
  expenseDate: { type: Date, required: true },
  notes: { type: String, maxlength: 1000, default: '' },
  receiptUrl: String,
  createdBy: ref('User', { required: true }),
  updatedBy: ref('User'),
  version: { type: Number, default: 1 },
  deletedAt: Date,
  deletedBy: ref('User'),
}, opts);
expenseSchema.index({ groupId: 1, deletedAt: 1, expenseDate: -1 });
export const Expense = mongoose.model('Expense', expenseSchema);

const splitSchema = new Schema({
  expenseId: ref('Expense', { required: true, index: true }),
  groupId: ref('Group', { required: true }),
  userId: ref('User', { required: true }),
  owedPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  inputValue: Number,
}, opts);
splitSchema.index({ groupId: 1, userId: 1 });
export const ExpenseSplit = mongoose.model('ExpenseSplit', splitSchema);

/* ---------------- Settlements ---------------- */
const settlementSchema = new Schema({
  groupId: ref('Group', { required: true }),
  fromUser: ref('User', { required: true }), // the person who pays
  toUser: ref('User', { required: true }), // the person who receives
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  method: { type: String, enum: ['cash', 'upi_manual'], required: true },
  upiRef: { type: String, maxlength: 60 },
  status: { type: String, enum: ['pending', 'completed', 'rejected', 'cancelled'], default: 'pending' },
  note: { type: String, maxlength: 300, default: '' },
  requestedBy: ref('User', { required: true }),
  respondedAt: Date,
  rejectReason: String,
  idempotencyKey: { type: String, required: true, unique: true },
}, opts);
settlementSchema.index({ groupId: 1, status: 1 });
settlementSchema.index({ fromUser: 1, toUser: 1 });
export const Settlement = mongoose.model('Settlement', settlementSchema);

/* ---------------- Invitations ---------------- */
const invitationSchema = new Schema({
  groupId: ref('Group', { required: true, index: true }),
  invitedBy: ref('User', { required: true }),
  email: { type: String, lowercase: true, trim: true, index: true },
  codeHash: { type: String, required: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'revoked', 'expired'], default: 'pending' },
  expiresAt: { type: Date, required: true },
}, opts);
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
export const Invitation = mongoose.model('Invitation', invitationSchema);

/* ---------------- Notifications ---------------- */
const notificationSchema = new Schema({
  userId: ref('User', { required: true }),
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  link: String,
  readAt: Date,
  meta: Schema.Types.Mixed,
}, opts);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', notificationSchema);

/* ---------------- Budgets ---------------- */
const budgetSchema = new Schema({
  userId: ref('User', { required: true }),
  scope: { type: String, enum: ['monthly', 'group', 'category'], required: true },
  groupId: ref('Group'),
  category: { type: String, enum: CATEGORIES },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  limitPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  alertThresholdPct: { type: Number, default: 80, min: 1, max: 100 },
  lastAlertLevel: { type: Number, default: 0 },
}, opts);
budgetSchema.index({ userId: 1, scope: 1, groupId: 1, category: 1, month: 1 }, { unique: true });
export const Budget = mongoose.model('Budget', budgetSchema);

/* ---------------- Audit, abuse, dev outbox ---------------- */
const auditSchema = new Schema({
  actorId: ref('User', { index: true }),
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: String,
  groupId: ref('Group', { index: true }),
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ip: String,
  requestId: String,
}, opts);
auditSchema.index({ entityType: 1, entityId: 1 });
auditSchema.index({ createdAt: -1 });
export const AuditLog = mongoose.model('AuditLog', auditSchema);

const abuseSchema = new Schema({
  reporterId: ref('User', { required: true }),
  targetType: { type: String, enum: ['user', 'group', 'expense'], required: true },
  targetId: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open' },
  adminNote: String,
}, opts);
export const AbuseReport = mongoose.model('AbuseReport', abuseSchema);

const outboxSchema = new Schema({ to: String, subject: String, body: String, link: String }, opts);
outboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });
export const DevOutbox = mongoose.model('DevOutbox', outboxSchema);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
