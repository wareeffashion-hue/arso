'use client';

import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';

export function AuthForm({
  title,
  lead,
  submitLabel,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  lead?: string;
  submitLabel: string;
  onSubmit: (data: FormData) => Promise<string | void>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit(new FormData(e.currentTarget));
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إتمام الطلب');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="auth-title">{title}</h1>
      {lead ? <p className="auth-lead">{lead}</p> : null}
      {notice ? (
        <p className="alert alert-ok" role="status">
          {notice}
        </p>
      ) : (
        <form onSubmit={handle} className="form" noValidate={false}>
          {children}
          {error ? (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'لحظة…' : submitLabel}
          </button>
        </form>
      )}
      {footer ? <div className="auth-footer">{footer}</div> : null}
    </>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  minLength,
  hint,
  dir,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  hint?: string;
  dir?: 'ltr' | 'rtl';
}) {
  const id = `f-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        minLength={minLength}
        dir={dir}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <small id={`${id}-hint`} className="field-hint">
          {hint}
        </small>
      ) : null}
    </div>
  );
}
