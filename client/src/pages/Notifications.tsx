import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { del, errMsg, patch, post } from '../lib/api';
import { timeAgo } from '../lib/money';
import { useFetch } from '../lib/hooks';
import type { Notice } from '../lib/types';
import { toast } from '../store';
import { Button, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, cx } from '../ui';

export default function Notifications() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch<{ items: Notice[] }>('/notifications', { limit: 60 });
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const open = async (n: Notice) => { if (!n.read) await patch(`/notifications/${n.id}/read`).catch(() => undefined); if (n.link) nav(n.link); else reload(); };
  const unread = data?.items.filter((n) => !n.read).length ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" sub={unread ? `${unread} unread` : 'You are all caught up'} action={<Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} disabled={!unread} onClick={() => run(() => post('/notifications/read-all'))}>Mark all read</Button>} />
      {loading && !data ? <PageSkeleton /> : error ? <ErrorState message={error} retry={reload} /> : !data?.items.length ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications yet" body="New expenses, invitations, payment requests and budget warnings will show up here." />
      ) : (
        <Card className="p-0"><ul className="divide-y divide-line">{data.items.map((n) => (
          <li key={n.id} className={cx('flex items-start gap-3 px-4 py-3.5', !n.read && 'bg-brand/5')}>
            <span className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} aria-label={n.read ? 'Read' : 'Unread'} />
            <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
              <p className="text-sm font-semibold">{n.title}</p>{n.body && <p className="text-sm text-muted">{n.body}</p>}<p className="mt-0.5 text-xs text-muted">{timeAgo(n.createdAt)}</p>
            </button>
            <button aria-label="Delete notification" className="rounded-lg p-2 text-muted hover:bg-raised hover:text-neg" onClick={() => run(() => del(`/notifications/${n.id}`))}><Trash2 className="h-4 w-4" /></button>
          </li>))}</ul></Card>
      )}
    </div>
  );
}
