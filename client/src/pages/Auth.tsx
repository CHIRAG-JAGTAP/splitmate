import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, errMsg, post } from '../lib/api';
import { toast, useAuth } from '../store';
import { Button, Field, Input } from '../ui';

const pwHint = 'At least 8 characters with upper, lower case and a number.';
const fieldError = (e: unknown, path: string) => (e instanceof ApiError ? e.details?.find((d) => d.path === path)?.message ?? null : null);

export function Login() {
  const { login } = useAuth(); const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(email, password); nav('/', { replace: true }); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div><h1 className="text-3xl font-extrabold">Welcome back</h1><p className="mt-1 text-sm text-muted">Log in to see who owes what.</p></div>
      {err && <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{err}</p>}
      <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <div className="flex justify-end"><Link to="/forgot-password" className="text-sm font-semibold text-brand hover:underline">Forgot password?</Link></div>
      <Button type="submit" loading={busy} className="w-full">Log in</Button>
      <p className="text-center text-sm text-muted">New to SplitMate? <Link to="/register" className="font-semibold text-brand hover:underline">Create an account</Link></p>
    </form>
  );
}

export function Register() {
  const { register } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await register(f.name, f.email, f.password); toast.success('Account created. Welcome to SplitMate!'); nav('/', { replace: true }); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div><h1 className="text-3xl font-extrabold">Create your account</h1><p className="mt-1 text-sm text-muted">Free forever. No card needed.</p></div>
      {err instanceof Error && !(err as ApiError).details?.length ? <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{errMsg(err)}</p> : null}
      <Field label="Full name" error={fieldError(err, 'name')}>{(id) => <Input id={id} autoComplete="name" required value={f.name} onChange={set('name')} />}</Field>
      <Field label="Email" error={fieldError(err, 'email')}>{(id) => <Input id={id} type="email" autoComplete="email" required value={f.email} onChange={set('email')} />}</Field>
      <Field label="Password" hint={pwHint} error={fieldError(err, 'password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} />}</Field>
      <Button type="submit" loading={busy} className="w-full">Create account</Button>
      <p className="text-center text-sm text-muted">Already have an account? <Link to="/login" className="font-semibold text-brand hover:underline">Log in</Link></p>
    </form>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; devHint?: string } | null>(null); const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone(await post('/auth/forgot-password', { email })); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return done ? (
    <div className="space-y-4"><h1 className="text-3xl font-extrabold">Check your email</h1><p className="text-sm text-muted">{done.message}</p>
      {done.devHint && <p className="rounded-ctl bg-gold-soft px-3 py-2 text-sm">{done.devHint} <a className="font-semibold underline" href="/api/v1/dev/outbox" target="_blank" rel="noreferrer">Open dev outbox</a></p>}
      <Link to="/login" className="text-sm font-semibold text-brand hover:underline">Back to log in</Link></div>
  ) : (
    <form onSubmit={submit} className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Reset your password</h1><p className="mt-1 text-sm text-muted">Enter your email and we'll prepare a reset link.</p></div>
      {err && <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{err}</p>}
      <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Button type="submit" loading={busy} className="w-full">Send reset link</Button>
      <p className="text-center text-sm"><Link to="/login" className="font-semibold text-brand hover:underline">Back to log in</Link></p>
    </form>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams(); const nav = useNavigate();
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/reset-password', { token: sp.get('token') ?? '', password }); toast.success('Password updated. Log in with your new password.'); nav('/login'); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Choose a new password</h1></div>
      {err ? <p role="alert" className="rounded-ctl bg-neg-soft px-3 py-2 text-sm text-neg">{errMsg(err)}</p> : null}
      <Field label="New password" hint={pwHint}>{(id) => <Input id={id} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Button type="submit" loading={busy} className="w-full">Update password</Button>
    </form>
  );
}
