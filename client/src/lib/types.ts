export type Role = 'user' | 'admin';
export interface User { id: string; name: string; email: string; avatarUrl: string | null; upiId: string | null; role: Role; status: string; theme: 'light' | 'dark' | 'system' }
export interface UserCard { id: string; name: string; email?: string; avatarUrl: string | null }
export const CATEGORIES = ['food', 'travel', 'accommodation', 'shopping', 'entertainment', 'transport', 'utilities', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const GROUP_TYPES = ['friends', 'trips', 'flatmates', 'family', 'office', 'custom'] as const;
export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares' | 'unequal';
export interface Group { id: string; name: string; description: string; type: (typeof GROUP_TYPES)[number]; simplifyDebts: boolean; memberCount?: number; myNetPaise?: number; myRole?: 'owner' | 'admin' | 'member'; inviteCode?: string; createdBy: string }
export interface Member extends UserCard { role: 'owner' | 'admin' | 'member'; joinedAt: string }
export interface Expense { id: string; groupId: string; description: string; category: Category; amountPaise: number; paidBy: UserCard; createdBy: string; splitMethod: SplitMethod; expenseDate: string; notes: string; receiptUrl: string | null; version: number; splits: { user: UserCard; owedPaise: number; inputValue?: number }[] }
export interface Transfer { from: string; to: string; amountPaise: number; fromUser?: UserCard; toUser?: UserCard }
export interface Balances { balances: { userId: string; user?: UserCard; netPaise: number }[]; pairwise: Transfer[]; simplified: Transfer[]; savedTransfers: number }
export interface Settlement { id: string; groupId: string; groupName: string; fromUser: UserCard; toUser: UserCard; amountPaise: number; method: 'cash' | 'upi_manual'; upiRef: string | null; status: 'pending' | 'completed' | 'rejected' | 'cancelled'; note: string; requestedBy: string; rejectReason: string | null; createdAt: string; respondedAt: string | null }
export interface Notice { id: string; type: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }
export interface BudgetRow { id: string; scope: 'monthly' | 'group' | 'category'; groupId: string | null; groupName: string | null; category: Category | null; month: string; limitPaise: number; alertThresholdPct: number; spentPaise: number; pct: number; status: 'ok' | 'warning' | 'over' }
export interface Insight { id: string; level: 'info' | 'good' | 'warning'; title: string; detail: string; link?: string }
