'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, Download, Copy, Check, RefreshCw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';

export function AddinIntegrationCard() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isHttp, setIsHttp] = useState(false);

  useEffect(() => {
    setIsHttp(window.location.protocol === 'http:');
  }, []);

  async function generateToken() {
    setIsGenerating(true);
    setGeneratedToken(null);
    try {
      const res = await fetch('/api/integrations/addin/token', { method: 'POST' });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to generate token');
        return;
      }
      setGeneratedToken(json.data.token);
      toast.success('Token generated — copy it now, it will not be shown again.');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyToken() {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — please select and copy manually.');
    }
  }

  return (
    <div className="space-y-5">
      {/* HTTPS Warning */}
      {isHttp && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/10 p-3">
          <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
          <p className="text-xs text-warning leading-relaxed">
            <span className="font-semibold">HTTPS required.</span> Outlook Desktop will not load add-ins over plain HTTP.
            Configure TLS in IIS before sideloading the manifest.
          </p>
        </div>
      )}

      {/* Description */}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
          <Calendar className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">Outlook Desktop Add-in</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Push calendar appointments directly into the Task Tracker from Outlook Desktop.
            Works with Zimbra, Exchange, and any IMAP-configured account.
          </p>
        </div>
      </div>

      {/* Setup Steps */}
      <div className="space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Setup Steps
        </p>

        {/* Step 1 — Generate token */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StepBadge n={1} />
            <span className="text-xs font-medium">Generate your add-in token</span>
          </div>
          <p className="text-[11px] text-muted-foreground pl-6 leading-relaxed">
            Each user needs their own token. It will be stored securely and shown only once.
          </p>
          <div className="pl-6">
            <Button
              size="sm"
              variant="outline"
              onClick={generateToken}
              disabled={isGenerating}
              className="h-8 text-xs gap-1.5"
            >
              {isGenerating
                ? <><RefreshCw className="h-3 w-3 animate-spin" /> Generating…</>
                : <><RefreshCw className="h-3 w-3" /> Generate Token</>
              }
            </Button>
          </div>

          {generatedToken && (
            <div className="pl-6 space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
                <code className="flex-1 text-[11px] font-mono truncate text-foreground select-all">
                  {generatedToken}
                </code>
                <button
                  onClick={copyToken}
                  className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy token"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-warning flex items-center gap-1">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                Copy this now — it will not be shown again. Generating a new token invalidates the old one.
              </p>
            </div>
          )}
        </div>

        {/* Step 2 — Download manifest */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StepBadge n={2} />
            <span className="text-xs font-medium">Download the manifest</span>
          </div>
          <p className="text-[11px] text-muted-foreground pl-6 leading-relaxed">
            Before downloading, open the file and replace <code className="text-[10px] bg-muted px-1 rounded">TASKTRACKER_URL</code> with
            your actual HTTPS domain (e.g. <code className="text-[10px] bg-muted px-1 rounded">tasktracker.example.com</code>).
          </p>
          <div className="pl-6">
            <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <a href="/outlook-addin/manifest.xml" download="task-tracker-manifest.xml">
                <Download className="h-3 w-3" />
                Download manifest.xml
              </a>
            </Button>
          </div>
        </div>

        {/* Step 3 — Sideload */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <StepBadge n={3} />
            <span className="text-xs font-medium">Sideload in Outlook Desktop</span>
          </div>
          <div className="pl-6 space-y-1">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              In Outlook: <span className="text-foreground">File → Manage Add-ins → Add from file</span> → select the manifest XML.
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Alternatively, an IT admin can deploy it to all users via the Exchange Admin Center.
            </p>
          </div>
        </div>

        {/* Step 4 — Use it */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <StepBadge n={4} />
            <span className="text-xs font-medium">Push events from Outlook</span>
          </div>
          <div className="pl-6 space-y-1">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Open any calendar appointment (or drag an email to the calendar) → a <span className="text-foreground">Task Tracker</span> pane
              will appear → paste your token once → click <span className="text-foreground">Push to Task Tracker</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="h-5 w-5 rounded-full bg-muted text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
      {n}
    </span>
  );
}
