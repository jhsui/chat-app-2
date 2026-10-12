import { useState, type FormEvent } from 'react';
import type { PublicUser } from '../../../shared/types';
import { api, errorMessage } from '../api.ts';

interface AuthPageProps {
  onAuthenticated: (user: PublicUser) => void;
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isLogin = mode === 'login';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = isLogin ? await api.login(username, password) : await api.register(username, password);
      onAuthenticated(user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isLogin ? 'register' : 'login');
    setError('');
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-logo" aria-hidden="true">
          <img src="/favicon.svg" alt="" width="40" height="40" />
        </div>
        <h1>{isLogin ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted">{isLogin ? 'Sign in to keep chatting.' : 'Pick a username people can find you by.'}</p>

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
            title="Letters, numbers or underscores"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            minLength={6}
            maxLength={72}
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Sign up'}
        </button>

        <p className="muted switch">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" className="link" onClick={switchMode}>
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </form>
    </main>
  );
}
