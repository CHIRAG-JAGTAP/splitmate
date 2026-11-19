import { HandCoins } from 'lucide-react';
import { useState } from 'react';
import { useFetch } from '../lib/hooks';
import type { Settlement } from '../lib/types';
import { useAuth } from '../store';
import { Card, EmptyState, ErrorState, PageHeader, PageSkeleton, Tabs } from '../ui';
import { SettlementRow } from './GroupDetail';

type Filter = 'all' | 'pending' | 'completed' | 'rejected';
export default function Settlements() {
  const me = useAuth((s) => s.user)!;
  const [tab, setTab] = useState<Filter>('pending');
  const { data, loading, error, reload } = useFetch<{ items: Settlement[] }>('/settlements/mine', tab === 'all' ? {} : { status: tab });
  return (
    <div className="space-y-6">
      <PageHeader title="Settlements" sub="Payments you have made, received or still need to confirm." />
      <Tabs<Filter> value={tab} onChange={setTab} items={[{ id: 'pending', label: 'Pending' }, { id: 'completed', label: 'Completed' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' }]} />
      {loading && !data ? <PageSkeleton /> : error ? <ErrorState message={error} retry={reload} /> : !data?.items.length ? (
        <EmptyState icon={<HandCoins className="h-6 w-6" />} title="Nothing here" body="Open a group and choose Settle up to record a cash or UPI payment. The other person confirms it before balances change." />
      ) : (
        <Card className="p-0"><ul className="divide-y divide-line">{data.items.map((s) => <SettlementRow key={s.id} s={s} meId={me.id} onChanged={reload} showGroup />)}</ul></Card>
      )}
      <p className="text-xs text-muted">SplitMate does not move money. UPI payments are made in your own UPI app and then confirmed manually here.</p>
    </div>
  );
}
