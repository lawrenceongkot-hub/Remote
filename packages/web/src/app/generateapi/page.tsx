'use client';

import { useCallback, useEffect, useState } from 'react';

export default function GenerateApiPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [missingEnvVars, setMissingEnvVars] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/admin/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) setAuthed(true);
        if (Array.isArray(d.missingEnvVars)) setMissingEnvVars(d.missingEnvVars);
      })
      .catch(() => {});
  }, []);

  const login = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Login failed');
      }
      setAuthed(true);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }, [username, password]);

  const generateKey = useCallback(async () => {
    setError(null);
    setApiKey(null);
    setCopied(false);
    try {
      const res = await fetch('/api/admin/generate-key', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Generation failed');
      }
      const data = await res.json();
      setApiKey(data.apiKey);
      setOperatorId(data.operatorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  }, []);

  const copyKey = useCallback(() => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [apiKey]);

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <form onSubmit={login} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <h1 className="mb-2 text-2xl font-bold">Admin Login</h1>
          <p className="mb-6 text-sm text-slate-400">Authenticate to manage API keys.</p>
          {missingEnvVars.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
              <p className="mb-1 font-medium">Configuration Required</p>
              <p className="mb-2 text-xs">
                Set these environment variables in your Vercel project settings (or .env.local for local dev),
                then redeploy. The application fails securely — it will not start with insecure defaults.
              </p>
              <ul className="list-inside list-disc text-xs">
                {missingEnvVars.map((name) => (
                  <li key={name} className="font-mono">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500"
            >
              Sign In
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="mb-2 text-2xl font-bold">Admin Panel</h1>
        <p className="mb-6 text-sm text-slate-400">Generate Your API Key</p>

        <div className="mb-6 rounded-xl border border-slate-700 bg-slate-800 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">API Key</p>
          <p className="break-all font-mono text-sm text-slate-200">
            {apiKey ? apiKey : '***********************'}
          </p>
        </div>

        {operatorId && <p className="mb-4 text-xs text-slate-500">Operator: {operatorId}</p>}

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={generateKey}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500"
          >
            Generate New API Key
          </button>
          <button
            onClick={copyKey}
            disabled={!apiKey}
            className="flex-1 rounded-lg border border-slate-700 px-4 py-3 font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            {copied ? 'Copied!' : 'Copy API Key'}
          </button>
        </div>

        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-400">
          <p className="mb-1">
            <span className="font-medium text-green-400">Status:</span> API Key Active
          </p>
          <p className="text-xs">
            The API key is shown only once after generation. It is stored as a SHA-256 hash.
            Copy it now — you will need it to access the Remote Support Dashboard.
          </p>
        </div>

        <a
          href="/"
          className="mt-6 block rounded-lg border border-slate-700 px-4 py-3 text-center font-medium text-slate-300 hover:bg-slate-800"
        >
          Go to Remote Support Dashboard
        </a>
      </div>
    </main>
  );
}