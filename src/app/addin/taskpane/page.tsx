'use client';

import { useEffect, useState, useRef } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Office: any;

type Status =
  | 'loading_office'
  | 'token_needed'
  | 'ready'
  | 'pushing'
  | 'success'
  | 'already_imported'
  | 'error';

interface EventData {
  outlookItemId: string;
  subject: string;
  body: string;
  startDateTime: string;
  endDateTime: string;
  isAllDay: boolean;
}

const TOKEN_KEY = 'org_tracker_addin_token';

export default function TaskPane() {
  const [status, setStatus] = useState<Status>('loading_office');
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [eventData, setEventData] = useState<EventData | null>(null);
  const [resultTaskId, setResultTaskId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const officeReady = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);

    const init = () => {
      if (officeReady.current) return;
      officeReady.current = true;
      try {
        const item = Office.context.mailbox.item;
        if (!item) {
          setStatus('error');
          setErrorMsg('No calendar item found. Open an appointment first.');
          return;
        }
        readItem(item, stored || '');
      } catch {
        setStatus('error');
        setErrorMsg('Could not read appointment data from Outlook.');
      }
    };

    const startPolling = () => {
      const interval = setInterval(() => {
        if (typeof Office !== 'undefined' && (Office as any)?.context) {
          clearInterval(interval);
          init();
        }
      }, 100);
      return () => clearInterval(interval);
    };

    // Inject Office.js dynamically so it doesn't affect the root HTML document
    if (typeof Office !== 'undefined' && (Office as any)?.context) {
      init();
      return;
    }

    const existing = document.querySelector('script[src*="office.js"]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js';
      script.async = true;
      document.head.appendChild(script);
    }

    const cleanup = startPolling();

    // After 6 seconds, if Office.js still hasn't connected we're in a plain browser
    const timeout = setTimeout(() => {
      if (!officeReady.current) {
        setStatus('error');
        setErrorMsg('Not running inside Outlook. Open this add-in from an Outlook calendar appointment.');
      }
    }, 6000);

    return () => {
      cleanup?.();
      clearTimeout(timeout);
    };
  }, []);

  function readItem(item: any, storedToken: string) {
    // subject: string in Read mode, Subject object in Edit/Compose mode
    const getSubject = (cb: (s: string) => void) => {
      if (typeof item.subject === 'string') {
        cb(item.subject);
      } else {
        item.subject.getAsync((r: any) => cb(r.value || ''));
      }
    };

    getSubject((subject) => {
      item.body.getAsync('text', (bodyResult: any) => {
        item.start.getAsync((startResult: any) => {
          item.end.getAsync((endResult: any) => {
            const startDt = startResult.value instanceof Date
              ? startResult.value.toISOString()
              : new Date(startResult.value).toISOString();
            const endDt = endResult.value instanceof Date
              ? endResult.value.toISOString()
              : new Date(endResult.value).toISOString();

            const data: EventData = {
              outlookItemId: item.itemId || `compose-${subject}-${startDt}`,
              subject: subject.trim() || '(No subject)',
              body: (bodyResult.value || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
              startDateTime: startDt,
              endDateTime: endDt,
              isAllDay: false,
            };
            setEventData(data);
            setStatus(storedToken ? 'ready' : 'token_needed');
          });
        });
      });
    });
  }

  function saveToken() {
    const t = tokenInput.trim();
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setTokenInput('');
    setStatus(eventData ? 'ready' : 'loading_office');
  }

  async function pushTask() {
    if (!eventData || !token) return;
    setStatus('pushing');
    try {
      const res = await fetch('/api/integrations/addin/import-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(eventData),
      });
      const json = await res.json();
      if (res.status === 401) {
        setErrorMsg('Invalid token. Regenerate it from the Task Tracker settings page.');
        setStatus('error');
        return;
      }
      if (!json.success) {
        setErrorMsg(json.error || 'Something went wrong.');
        setStatus('error');
        return;
      }
      setResultTaskId(json.data.taskId);
      setStatus(json.data.alreadyImported ? 'already_imported' : 'success');
    } catch {
      setErrorMsg('Network error. Check your connection and try again.');
      setStatus('error');
    }
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setStatus('token_needed');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  // ── Render ──────────────────────────────────────────────────────────────────

  if (status === 'loading_office') {
    return (
      <div className="flex items-center justify-center h-screen p-4">
        <div className="text-center space-y-2">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground">Loading Office.js…</p>
        </div>
      </div>
    );
  }

  if (status === 'token_needed') {
    return (
      <div className="p-4 space-y-4">
        <Header />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Paste your add-in token to connect this Outlook add-in to your Task Tracker account.
            Get the token from <strong>Task Tracker → Config → Integrations</strong>.
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveToken()}
            placeholder="Paste your token here…"
            className="w-full px-3 py-2 text-xs rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={saveToken}
            disabled={!tokenInput.trim()}
            className="w-full py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save Token
          </button>
        </div>
      </div>
    );
  }

  if (status === 'success' && resultTaskId !== null) {
    return (
      <div className="p-4 space-y-4">
        <Header />
        <div className="rounded-xl border border-success/30 bg-success/10 p-3 space-y-2">
          <p className="text-xs font-semibold text-success">Task created!</p>
          <p className="text-xs text-muted-foreground">
            Task <span className="font-medium text-foreground">#{resultTaskId}</span> has been added to the Task Tracker.
          </p>
          {appUrl && (
            <a
              href={`${appUrl}/tasks`}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-primary underline underline-offset-2"
            >
              View in Task Tracker →
            </a>
          )}
        </div>
        <button
          onClick={() => { setStatus('ready'); setResultTaskId(null); }}
          className="w-full py-2 text-xs rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          Push another event
        </button>
      </div>
    );
  }

  if (status === 'already_imported' && resultTaskId !== null) {
    return (
      <div className="p-4 space-y-4">
        <Header />
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-1">
          <p className="text-xs font-semibold text-warning">Already imported</p>
          <p className="text-xs text-muted-foreground">
            This event was already added as Task <span className="font-medium text-foreground">#{resultTaskId}</span>.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-4 space-y-4">
        <Header />
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 space-y-1">
          <p className="text-xs font-semibold text-destructive">Error</p>
          <p className="text-xs text-muted-foreground">{errorMsg}</p>
        </div>
        <button
          onClick={() => { setStatus('ready'); setErrorMsg(''); }}
          className="w-full py-2 text-xs rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          Try again
        </button>
        <button
          onClick={clearToken}
          className="w-full py-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          Reset token
        </button>
      </div>
    );
  }

  // status === 'ready' | 'pushing'
  return (
    <div className="p-4 space-y-4">
      <Header />

      {eventData && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Appointment
          </p>
          <p className="text-sm font-medium leading-snug line-clamp-2">{eventData.subject}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarIcon />
            <span>{formatDateTime(eventData.startDateTime)}</span>
            {eventData.endDateTime !== eventData.startDateTime && (
              <><span>→</span><span>{formatTime(eventData.endDateTime)}</span></>
            )}
          </div>
          {eventData.body && (
            <p className="text-[11px] text-muted-foreground line-clamp-3 leading-relaxed">
              {eventData.body}
            </p>
          )}
        </div>
      )}

      <button
        onClick={pushTask}
        disabled={status === 'pushing' || !eventData}
        className="w-full py-2.5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {status === 'pushing' ? (
          <>
            <div className="h-3.5 w-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            Creating task…
          </>
        ) : (
          'Push to Task Tracker'
        )}
      </button>

      <button
        onClick={clearToken}
        className="w-full py-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        Reset token
      </button>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-border">
      <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
        <CalendarIcon className="text-primary" />
      </div>
      <span className="text-sm font-semibold">Task Tracker</span>
    </div>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
