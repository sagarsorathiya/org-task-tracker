'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, AlertCircle, RefreshCw, Copy, Check, Download, Trash2, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import toast from 'react-hot-toast';

interface AddinToken {
  id: number;
  device_label: string;
  created_at: string;
  last_used_at: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OutlookAddinModal({ open, onClose }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [newTokenId, setNewTokenId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [tokens, setTokens] = useState<AddinToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const fetchTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const res = await fetch('/api/integrations/addin/tokens');
      const json = await res.json();
      if (json.success) setTokens(json.data);
    } catch {
      // ignore
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchTokens();
      setNewToken(null);
      setNewTokenId(null);
      setDeviceLabel('');
    }
  }, [open, fetchTokens]);

  async function generateToken() {
    const label = deviceLabel.trim() || 'My Device';
    setIsGenerating(true);
    setNewToken(null);
    try {
      const res = await fetch('/api/integrations/addin/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceLabel: label }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to generate token');
        return;
      }
      setNewToken(json.data.token);
      setNewTokenId(json.data.tokenId);
      setDeviceLabel('');
      await fetchTokens();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  }

  async function revokeToken(id: number, label: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/integrations/addin/tokens/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to revoke token');
        return;
      }
      toast.success(`Token for "${label}" revoked`);
      if (newTokenId === id) {
        setNewToken(null);
        setNewTokenId(null);
      }
      await fetchTokens();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  function handleClose() {
    setNewToken(null);
    setNewTokenId(null);
    setDeviceLabel('');
    onClose();
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="max-w-lg flex flex-col max-h-[90vh] overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
              <Calendar className="h-3.5 w-3.5 text-primary" />
            </div>
            Outlook Add-in Setup
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-0 pr-0.5">
          <p className="text-xs text-muted-foreground leading-relaxed -mt-1 mb-3">
            Push calendar appointments from Outlook Desktop directly into Task Tracker using a one-click macro.
            Each device (laptop/PC) needs its own token — tokens are independent and can be revoked individually.
          </p>

          {/* Step 1 — Token */}
          <Step n={1} title="Generate a device token">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Give this device a label so you can identify it later, then generate a token.
              Each device needs its own token — generating one here will <span className="text-foreground font-medium">not</span> affect tokens on other devices.
            </p>

            <div className="flex gap-2 mt-2">
              <Input
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder="Device name (e.g. Office Laptop)"
                className="h-7 text-xs flex-1"
                maxLength={80}
                onKeyDown={(e) => e.key === 'Enter' && !isGenerating && generateToken()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={generateToken}
                disabled={isGenerating}
                className="h-7 text-xs gap-1.5 shrink-0"
              >
                {isGenerating
                  ? <><RefreshCw className="h-3 w-3 animate-spin" /> Generating…</>
                  : <><RefreshCw className="h-3 w-3" /> Generate</>
                }
              </Button>
            </div>

            {newToken && (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-border bg-muted">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <code className="flex-1 text-[11px] font-mono break-all leading-relaxed text-foreground select-all">
                      {newToken}
                    </code>
                    <button
                      onClick={copyToken}
                      className="flex-shrink-0 ml-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy token"
                    >
                      {copied
                        ? <Check className="h-3.5 w-3.5 text-success" />
                        : <Copy className="h-3.5 w-3.5" />
                      }
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-warning flex items-start gap-1.5">
                  <AlertCircle className="h-3 w-3 flex-shrink-0 mt-px" />
                  Copy now — this token will not be shown again. Paste it into Outlook on this device only.
                </p>
              </div>
            )}
          </Step>

          <Divider />

          {/* Active tokens list */}
          <div className="py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2">
              Active Device Tokens
            </p>
            {loadingTokens ? (
              <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : tokens.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No tokens yet — generate one above.</p>
            ) : (
              <div className="space-y-1.5">
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                      newTokenId === t.id ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted'
                    }`}
                  >
                    <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{t.device_label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Created {formatDate(t.created_at)}
                        {t.last_used_at && ` · Last used ${formatDate(t.last_used_at)}`}
                        {newTokenId === t.id && (
                          <span className="ml-1.5 text-success font-semibold">· New</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => revokeToken(t.id, t.device_label)}
                      disabled={revokingId === t.id}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      title="Revoke this token"
                    >
                      {revokingId === t.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />
                      }
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Divider />

          {/* Step 2 — Install macro */}
          <Step n={2} title="Install the macro in Outlook (one-time per device)">
            <ol className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5 list-decimal list-inside">
              <li>Download the macro file below</li>
              <li>
                In Outlook press{' '}
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground border border-border">Alt+F11</kbd>
                {' '}to open the VBA editor
              </li>
              <li>
                In the editor: <span className="text-foreground">File → Import File</span> → select <span className="text-foreground font-medium">TaskTracker.bas</span>
              </li>
              <li>Close the editor</li>
              <li>
                Right-click the <span className="text-foreground">Quick Access Toolbar</span> → <span className="text-foreground">Customize</span> → Commands from: <span className="text-foreground">Macros</span> → select <span className="text-foreground font-medium">TaskTracker.PushToTaskTracker</span> → <span className="text-foreground">Add &gt;&gt;</span> then OK
              </li>
            </ol>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-2 mt-3 w-full"
              asChild
            >
              <a href="/outlook-addin/TaskTracker.bas" download="TaskTracker.bas">
                <Download className="h-3.5 w-3.5" />
                Download TaskTracker.bas
              </a>
            </Button>
          </Step>

          <Divider />

          {/* Step 3 — Use */}
          <Step n={3} title="Push calendar events to Task Tracker">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Open any calendar appointment → click the{' '}
              <span className="text-foreground font-medium">Task Tracker</span> button in the Quick Access Toolbar →
              paste your device token when prompted (first time only) → the event is added as a task.
            </p>
          </Step>
        </div>

        <div className="flex justify-end pt-2 border-t border-border shrink-0">
          <Button size="sm" variant="outline" onClick={handleClose} className="h-8 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3">
      <div className="flex-shrink-0 h-6 w-6 rounded-lg bg-muted border border-border text-primary text-[11px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/50 mx-9" />;
}
