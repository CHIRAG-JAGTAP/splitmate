import { Camera, Laptop, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { del, errMsg, post, upload } from '../lib/api';
import { timeAgo } from '../lib/money';
import { useFetch } from '../lib/hooks';
import type { User } from '../lib/types';
import { toast, useAuth, useTheme } from '../store';
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select } from '../ui';

export default function Profile() {
  const { user, updateProfile, setUser } = useAuth();
  const setTheme = useTheme((s) => s.set);
  const [name, setName] = useState(user!.name); const [upi, setUpi] = useState(user!.upiId ?? '');
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const sessions = useFetch<{ items: { id: string; userAgent?: string; ip?: string; createdAt: string; current: boolean }[] }>('/auth/sessions');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' }); const [pwBusy, setPwBusy] = useState(false); const [pwErr, setPwErr] = useState<string | null>(null);

  const save = async (e: FormEvent) => { e.preventDefault(); setSaving(true); setErr(null); try { await updateProfile({ name, upiId: upi }); toast.success('Profile saved'); } catch (x) { setErr(errMsg(x)); } finally { setSaving(false); } };
  const avatar = async (f: File) => { try { setUser((await upload<{ user: User }>('/users/me/avatar', 'avatar', f)).user); toast.success('Photo updated'); } catch (x) { toast.error(errMsg(x)); } };
  const changePw = async (e: FormEvent) => { e.preventDefault(); setPwBusy(true); setPwErr(null); try { await post('/users/me/change-password', pw); toast.success('Password changed. Other devices were signed out.'); setPw({ currentPassword: '', newPassword: '' }); sessions.reload(); } catch (x) { setPwErr(errMsg(x)); } finally { setPwBusy(false); } };
  const revoke = async (id: string) => { try { await del(`/auth/sessions/${id}`); sessions.reload(); } catch (x) { toast.error(errMsg(x)); } };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Profile and security" />
      <Card>
        <form onSubmit={save} className="space-y-5">
          <div className="flex items-center gap-4"><Avatar name={user!.name} src={user!.avatarUrl} size={72} />
            <div><input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && avatar(e.target.files[0])} /><Button type="button" variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={() => file.current?.click()}>Change photo</Button><p className="mt-1 text-xs text-muted">JPEG, PNG or WebP, up to 5 MB.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />}</Field>
            <Field label="Email" hint="Email cannot be changed">{(id) => <Input id={id} value={user!.email} disabled />}</Field>
            <Field label="UPI ID" hint="Shown to people who need to pay you. SplitMate never moves money.">{(id) => <Input id={id} value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" />}</Field>
            <Field label="Theme">{(id) => <Select id={id} value={user!.theme} onChange={(e) => { const t = e.target.value as User['theme']; setTheme(t); void updateProfile({ theme: t }); }}><option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option></Select>}</Field>
          </div>
          {err && <p role="alert" className="text-sm text-neg">{err}</p>}
          <Button type="submit" loading={saving}>Save changes</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <form onSubmit={changePw} className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />}</Field>
          <Field label="New password" hint="8+ characters with upper, lower case and a number">{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={8} />}</Field>
          {pwErr && <p role="alert" className="text-sm text-neg sm:col-span-2">{pwErr}</p>}
          <div className="sm:col-span-2"><Button type="submit" loading={pwBusy}>Update password</Button></div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Active sessions" sub="Devices signed in to your account" />
        <ul className="divide-y divide-line">{sessions.data?.items.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3"><Laptop className="h-5 w-5 text-muted" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{s.userAgent?.split(')')[0].split('(')[1] ?? s.userAgent ?? 'Unknown device'}</p><p className="text-xs text-muted">{s.ip} · signed in {timeAgo(s.createdAt)}</p></div>
            {s.current ? <Badge tone="pos">This device</Badge> : <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => revoke(s.id)}>Sign out</Button>}</li>))}</ul>
      </Card>
    </div>
  );
}
