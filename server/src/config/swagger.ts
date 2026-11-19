/** OpenAPI 3 document. Endpoints are declared compactly: [method, path, tag, summary, auth?, body?] */
type Row = [string, string, string, string, ('user' | 'admin' | 'public')?, string?];
const rows: Row[] = [
  ['post', '/auth/register', 'Authentication', 'Create an account', 'public', 'name, email, password'],
  ['post', '/auth/login', 'Authentication', 'Log in (sets HTTP-only cookies)', 'public', 'email, password'],
  ['post', '/auth/logout', 'Authentication', 'Log out and revoke session', 'public'],
  ['post', '/auth/refresh', 'Authentication', 'Rotate refresh token', 'public'],
  ['post', '/auth/forgot-password', 'Authentication', 'Request reset link (dev outbox or SMTP)', 'public', 'email'],
  ['post', '/auth/reset-password', 'Authentication', 'Set a new password with a reset token', 'public', 'token, password'],
  ['get', '/auth/me', 'Authentication', 'Current user'],
  ['get', '/auth/sessions', 'Authentication', 'List my active sessions'],
  ['delete', '/auth/sessions/{id}', 'Authentication', 'Revoke a session'],
  ['get', '/users/me', 'Users', 'My profile'], ['patch', '/users/me', 'Users', 'Edit profile / UPI ID / theme', 'user', 'name?, upiId?, theme?'],
  ['post', '/users/me/avatar', 'Users', 'Upload profile image (multipart: avatar)'], ['post', '/users/me/change-password', 'Users', 'Change password', 'user', 'currentPassword, newPassword'],
  ['get', '/users/search', 'Users', 'Find users by name prefix or exact e-mail (q>=3 chars)'], ['get', '/users/{id}/payment-instructions', 'Users', 'Payee UPI details + deep link (no payment is processed)'],
  ['post', '/groups', 'Groups', 'Create group', 'user', 'name, description?, type, simplifyDebts?'], ['get', '/groups', 'Groups', 'My groups with balances'],
  ['get', '/groups/{id}', 'Groups', 'Group detail'], ['patch', '/groups/{id}', 'Groups', 'Edit group (admins)'], ['delete', '/groups/{id}', 'Groups', 'Delete group (owner, all settled)'],
  ['get', '/groups/{id}/members', 'Groups', 'List members'], ['post', '/groups/{id}/members', 'Groups', 'Add registered user by e-mail (admins)', 'user', 'email'],
  ['patch', '/groups/{id}/members/{userId}', 'Groups', 'Change role (owner)', 'user', 'role'], ['delete', '/groups/{id}/members/{userId}', 'Groups', 'Remove member (balance must be zero)'],
  ['post', '/groups/{id}/leave', 'Groups', 'Leave group (balance must be zero)'], ['get', '/groups/{id}/activity', 'Groups', 'Group activity history'], ['post', '/groups/{id}/remind', 'Groups', 'Send payment reminder', 'user', 'userId'],
  ['post', '/groups/{id}/invitations', 'Invitations', 'Create invitation (code shown once)', 'user', 'email?'], ['get', '/groups/{id}/invitations', 'Invitations', 'List pending invitations'],
  ['delete', '/invitations/{id}', 'Invitations', 'Revoke invitation'], ['post', '/invitations/join', 'Invitations', 'Join with group code or invitation code', 'user', 'code'],
  ['get', '/invitations/mine', 'Invitations', 'Invitations sent to my e-mail'], ['post', '/invitations/{id}/accept', 'Invitations', 'Accept'], ['post', '/invitations/{id}/decline', 'Invitations', 'Decline'],
  ['post', '/groups/{id}/expenses', 'Expenses', 'Add expense (server computes the split)', 'user', 'description, category, amountPaise, paidBy, splitMethod, participants[], expenseDate, notes?'],
  ['get', '/groups/{id}/expenses', 'Expenses', 'List expenses (page, limit, q, category, from, to, paidBy)'], ['get', '/expenses/{id}', 'Expenses', 'Expense detail'],
  ['patch', '/expenses/{id}', 'Expenses', 'Edit expense (atomic split replace, optimistic version)'], ['delete', '/expenses/{id}', 'Expenses', 'Soft-delete expense'], ['post', '/expenses/{id}/receipt', 'Expenses', 'Upload receipt image (multipart: receipt)'],
  ['post', '/splits/calculate', 'Splits', 'Stateless split preview from the engine', 'user', 'amountPaise, splitMethod, participants[]'], ['post', '/expenses/preview-split', 'Splits', 'Alias of /splits/calculate'], ['get', '/expenses/{id}/splits', 'Splits', 'Stored splits of an expense'],
  ['get', '/groups/{id}/balances', 'Balances', 'Net, pairwise and simplified balances'], ['get', '/groups/{id}/balances/simplified', 'Balances', 'Simplified settlement plan'], ['get', '/groups/{id}/ledger', 'Balances', 'Transaction ledger'], ['get', '/balances/summary', 'Balances', 'Totals across my groups'], ['get', '/dashboard', 'Balances', 'Dashboard data'],
  ['post', '/groups/{id}/settlements', 'Settlements', 'Record a payment you made (cash / manual UPI)', 'user', 'toUser, amountPaise, method, upiRef?, note?, idempotencyKey'],
  ['get', '/groups/{id}/settlements', 'Settlements', 'Group settlement history'], ['get', '/settlements/mine', 'Settlements', 'My settlements (status filter)'],
  ['post', '/settlements/{id}/confirm', 'Settlements', 'Receiver confirms'], ['post', '/settlements/{id}/reject', 'Settlements', 'Receiver rejects', 'user', 'reason?'], ['post', '/settlements/{id}/cancel', 'Settlements', 'Creator cancels'], ['get', '/settlements/{id}/receipt', 'Settlements', 'Printable HTML receipt'],
  ...['monthly', 'weekly', 'categories', 'groups', 'contributions', 'trends', 'compare', 'top-categories', 'insights'].map((p): Row => ['get', `/analytics/${p}`, 'Analytics', `Analytics: ${p}`]),
  ['get', '/analytics/export.csv', 'Analytics', 'CSV export of my expenses'], ['post', '/ocr/scan', 'Analytics', 'Local Tesseract OCR of a receipt image (multipart: receipt)'],
  ['post', '/budgets', 'Budgets', 'Create budget', 'user', 'scope, groupId?, category?, month, limitPaise, alertThresholdPct'], ['get', '/budgets', 'Budgets', 'Budgets with progress (this month)'], ['get', '/budgets/progress', 'Budgets', 'Progress for ?month'], ['get', '/budgets/history', 'Budgets', 'Budget history'], ['patch', '/budgets/{id}', 'Budgets', 'Edit budget'], ['delete', '/budgets/{id}', 'Budgets', 'Delete budget'],
  ['get', '/notifications', 'Notifications', 'List'], ['get', '/notifications/unread-count', 'Notifications', 'Unread count'], ['patch', '/notifications/{id}/read', 'Notifications', 'Mark read'], ['post', '/notifications/read-all', 'Notifications', 'Mark all read'], ['delete', '/notifications/{id}', 'Notifications', 'Delete'],
  ['post', '/reports', 'Admin', 'Report abuse (any user)', 'user', 'targetType, targetId, reason'],
  ['get', '/admin/stats', 'Admin', 'Platform statistics', 'admin'], ['get', '/admin/users', 'Admin', 'User management', 'admin'], ['patch', '/admin/users/{id}/suspend', 'Admin', 'Suspend account', 'admin'], ['patch', '/admin/users/{id}/reinstate', 'Admin', 'Reinstate account', 'admin'],
  ['get', '/admin/groups', 'Admin', 'Group statistics', 'admin'], ['get', '/admin/activity', 'Admin', 'Activity monitor (audit log)', 'admin'], ['get', '/admin/reports', 'Admin', 'Abuse reports', 'admin'], ['patch', '/admin/reports/{id}', 'Admin', 'Resolve report', 'admin'],
  ['get', '/health', 'Meta', 'Health check', 'public'],
];

const paths: Record<string, any> = {};
for (const [method, path, tag, summary, access = 'user', body] of rows) {
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
  (paths[path] ??= {})[method] = {
    tags: [tag], summary, description: access === 'admin' ? 'Requires role=admin.' : access === 'user' ? 'Requires login (cookie).' : undefined, parameters: params,
    ...(body && { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: body } } } } }),
    responses: { '200': { description: 'OK' }, '400': { description: 'Validation / business rule error' }, ...(access !== 'public' && { '401': { description: 'Not logged in' }, '403': { description: 'Not allowed' } }) },
  };
}
export const openApiSpec = {
  openapi: '3.0.3',
  info: { title: 'SplitMate API', version: '1.0.0', description: 'All money is integer paise. Auth uses HTTP-only cookies; state-changing requests need header `X-Requested-With: SplitMate`.' },
  servers: [{ url: '/api/v1' }],
  tags: ['Authentication', 'Users', 'Groups', 'Invitations', 'Expenses', 'Splits', 'Balances', 'Settlements', 'Analytics', 'Budgets', 'Notifications', 'Admin', 'Meta'].map((name) => ({ name })),
  paths,
};
