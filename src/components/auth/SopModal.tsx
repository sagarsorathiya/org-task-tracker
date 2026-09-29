'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  LogIn, ClipboardList, UserCheck, ChevronRight, ChevronLeft,
  Monitor, Tag, Calendar, Pencil, CheckSquare,
  Building2, Users, Bell, CheckCircle2, AlertTriangle, FileText, Clock,
} from 'lucide-react';

const STEPS = [
  { id: 'login',          label: 'Login',          icon: LogIn },
  { id: 'create-task',    label: 'Create Task',     icon: ClipboardList },
  { id: 'assign-task',    label: 'Assign Task',     icon: UserCheck },
  { id: 'update-detail',  label: 'Update Details',  icon: Pencil },
  { id: 'complete-task',  label: 'Complete Task',   icon: CheckSquare },
] as const;

type StepId = (typeof STEPS)[number]['id'];

/* ── shared sub-components ─────────────────────────────────────── */

function StepNum({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shrink-0">
      {n}
    </span>
  );
}

function Field({ icon: Icon, label, value, note }: { icon: React.ElementType; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5 flex items-start gap-3">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5">{value}</p>
        {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
      </div>
    </div>
  );
}

function Callout({ icon: Icon, text, variant = 'info' }: { icon: React.ElementType; text: React.ReactNode; variant?: 'info' | 'warn' | 'danger' }) {
  const cls =
    variant === 'danger'
      ? 'border-destructive/25 bg-destructive/10 text-destructive'
      : variant === 'warn'
        ? 'border-warning/25 bg-warning/10 text-warning'
        : 'border-info/25 bg-info/10 text-info';
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${cls}`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
}

/* ── step content ──────────────────────────────────────────────── */

function LoginStep() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">Steps</p>
        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <StepNum n={1} />
            <div>
              <p className="text-sm font-semibold text-foreground">Open TaskTracker and select the <span className="text-primary">Domain</span> tab</p>
              <p className="text-xs text-muted-foreground mt-0.5">The Domain tab uses your Active Directory (AD) credentials — the same ones you use to log in to your computer.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={2} />
            <div className="w-full space-y-2">
              <p className="text-sm font-semibold text-foreground">Enter your <span className="text-primary">username</span> — not your full email</p>
              <div className="rounded-xl border border-border bg-muted px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Your email address</span>
                  <span className="text-muted-foreground">What to type</span>
                </div>
                <div className="flex items-center gap-3">
                  <code className="flex-1 rounded-lg bg-background border border-border px-2.5 py-1.5 text-sm font-mono text-muted-foreground">
                    abc.x@company.com
                  </code>
                  <ChevronRight className="h-4 w-4 text-primary shrink-0" />
                  <code className="flex-1 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-sm font-mono text-primary font-semibold">
                    abc.x
                  </code>
                </div>
                <p className="text-[11px] text-muted-foreground">Type only the part <strong>before</strong> the @ symbol.</p>
              </div>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={3} />
            <div>
              <p className="text-sm font-semibold text-foreground">Enter your <span className="text-primary">email / AD password</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">Use the same password you use to log in to your Windows PC or webmail.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={4} />
            <div>
              <p className="text-sm font-semibold text-foreground">Click <span className="text-primary">Sign in with AD</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">On first login you will be asked to select your Company, Designation, and Department before proceeding.</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}

function CreateTaskStep() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">Steps</p>
        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <StepNum n={1} />
            <div>
              <p className="text-sm font-semibold text-foreground">Go to <span className="text-primary">Tasks</span> in the sidebar, or click <span className="text-primary">+ New Task</span> on the Dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">Both open the same task creation form.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={2} />
            <div className="w-full space-y-2">
              <p className="text-sm font-semibold text-foreground">Fill in the task details</p>
              <div className="grid grid-cols-1 gap-2">
                <Field icon={ClipboardList} label="Title (required)" value="Short, clear task name" />
                <Field icon={Tag} label="Priority" value="Low / Medium / High / Critical" note="Default is Medium." />
                <Field icon={Calendar} label="Due Date & Time" value="Deadline for the task" note="Automatic email reminder fires 24 hours before due." />
                <Field icon={Calendar} label="Task Date & Time (optional)" value="When work actually starts" note="Task shows as 'In Progress' once this time is reached." />
                <Field icon={Building2} label="Company & Department" value="Scope the task to the right team" />
              </div>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={3} />
            <div>
              <p className="text-sm font-semibold text-foreground">Click <span className="text-primary">Create Task</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">The task is saved and all assignees receive an email notification.</p>
            </div>
          </li>
        </ol>
      </div>

      <Callout
        icon={Monitor}
        text="You can also push Outlook calendar appointments directly as tasks using the Outlook Add-in. Find the setup link in the top-right user menu."
      />
    </div>
  );
}

function AssignTaskStep() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">Assigning while creating a task</p>
        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <StepNum n={1} />
            <div className="w-full space-y-2">
              <p className="text-sm font-semibold text-foreground">In the task form, find the <span className="text-primary">Assign To</span> field</p>
              <Field icon={Users} label="Assign To" value="Search by name and select one or more people" note="You can assign to multiple team members at once." />
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={2} />
            <div>
              <p className="text-sm font-semibold text-foreground">Select Company & Department first to filter the list</p>
              <p className="text-xs text-muted-foreground mt-0.5">Assignees shown are members of the selected department. Select the correct department before searching for a person.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={3} />
            <div>
              <p className="text-sm font-semibold text-foreground">Click <span className="text-primary">Create Task</span> — assignees are notified automatically</p>
              <p className="text-xs text-muted-foreground mt-0.5">Each assignee receives an email with the task title, due date, and a direct link to the portal.</p>
            </div>
          </li>
        </ol>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">Reassigning an existing task</p>
        <ol className="space-y-3">
          <li className="flex items-start gap-3">
            <StepNum n={1} />
            <p className="text-sm text-foreground">Open the task → click the <span className="text-primary">Edit</span> (pencil) icon</p>
          </li>
          <li className="flex items-start gap-3">
            <StepNum n={2} />
            <p className="text-sm text-foreground">Update the <span className="text-primary">Assign To</span> field — add or remove people</p>
          </li>
          <li className="flex items-start gap-3">
            <StepNum n={3} />
            <p className="text-sm text-foreground">Save — newly added assignees receive an email notification</p>
          </li>
        </ol>
      </div>

      <Callout
        icon={Bell}
        text="All assignees and the task creator receive email notifications whenever the task status changes."
      />
    </div>
  );
}

function UpdateDetailStep() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">How to update a task</p>
        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <StepNum n={1} />
            <div>
              <p className="text-sm font-semibold text-foreground">Open the task from the <span className="text-primary">Tasks</span> page or Dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">Click the task title or row to open the detail panel.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={2} />
            <div>
              <p className="text-sm font-semibold text-foreground">Click the <span className="text-primary">Edit</span> (pencil) icon in the task header</p>
              <p className="text-xs text-muted-foreground mt-0.5">This opens the edit form pre-filled with the current task details.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={3} />
            <div className="w-full space-y-2">
              <p className="text-sm font-semibold text-foreground">Make your changes — any field can be updated</p>
              <div className="grid grid-cols-1 gap-2">
                <Field icon={ClipboardList} label="Title & Description" value="Clarify or expand task details" />
                <Field icon={Tag} label="Priority" value="Escalate to High or Critical if urgency increases" />
                <Field icon={Calendar} label="Due Date & Time" value="Extend or move the deadline" note="Assignees are notified only if the status changes, not just the date." />
                <Field icon={Users} label="Assign To" value="Add or remove team members" note="Newly added members receive an email." />
                <Field icon={FileText} label="Comments" value="Add a comment to log progress or leave a note" note="All assignees are notified of new comments." />
              </div>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={4} />
            <div>
              <p className="text-sm font-semibold text-foreground">Click <span className="text-primary">Save</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">Changes are saved immediately and activity is logged on the task timeline.</p>
            </div>
          </li>
        </ol>
      </div>

      <Callout
        icon={Clock}
        text="Use the Comments section to post progress updates. This keeps the task timeline accurate and informs your manager without a separate email."
      />
    </div>
  );
}

function CompleteTaskStep() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">How to mark a task complete</p>
        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <StepNum n={1} />
            <div>
              <p className="text-sm font-semibold text-foreground">Open the task from the <span className="text-primary">Tasks</span> page or Dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">Click the task title or row to open the detail view.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={2} />
            <div>
              <p className="text-sm font-semibold text-foreground">Click <span className="text-primary">Mark as Complete</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">You can also change the status to <strong>Completed</strong> using the status dropdown in the task header or by posting a comment with the Complete action.</p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepNum n={3} />
            <div>
              <p className="text-sm font-semibold text-foreground">Confirm — all assignees and the task creator are notified</p>
              <p className="text-xs text-muted-foreground mt-0.5">The task moves to the Completed tab and the completion date is recorded.</p>
            </div>
          </li>
        </ol>
      </div>

      {/* Overdue warning — the key point the user asked for */}
      <div className="rounded-xl border-2 border-destructive bg-destructive/10 px-4 py-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm font-bold text-destructive">Mandatory: Complete tasks before the due date</p>
        </div>
        <p className="text-xs text-destructive leading-relaxed">
          If a task is <strong>not marked as Completed or Cancelled</strong> by its due date and time, it is automatically flagged as <strong>Overdue</strong>. The system will:
        </p>
        <ul className="space-y-1 pl-1">
          {[
            'Highlight the task in red on the Dashboard and Tasks page',
            'Send an immediate overdue email to you and the task creator',
            'Continue sending a daily digest email every night until the task is completed',
            'Show the task in the Overdue Tasks card on the Dashboard',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-destructive">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="text-xs font-semibold text-destructive pt-1">
          Always update the task status as soon as the work is done. If a task cannot be completed on time, inform your manager and update the due date.
        </p>
      </div>
    </div>
  );
}

const STEP_CONTENT: Record<StepId, React.ReactNode> = {
  'login':          <LoginStep />,
  'create-task':    <CreateTaskStep />,
  'assign-task':    <AssignTaskStep />,
  'update-detail':  <UpdateDetailStep />,
  'complete-task':  <CompleteTaskStep />,
};

/* ── main modal ────────────────────────────────────────────────── */

interface SopModalProps {
  open: boolean;
  onClose: () => void;
}

export function SopModal({ open, onClose }: SopModalProps) {
  const [activeStep, setActiveStep] = useState<StepId>('login');
  const currentIndex = STEPS.findIndex((s) => s.id === activeStep);

  const goNext = () => { if (currentIndex < STEPS.length - 1) setActiveStep(STEPS[currentIndex + 1].id); };
  const goPrev = () => { if (currentIndex > 0) setActiveStep(STEPS[currentIndex - 1].id); };

  const handleClose = () => {
    setActiveStep('login');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-xl flex flex-col max-h-[90vh] overflow-hidden p-0">

        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">TaskTracker User Guide</h2>
              <p className="text-xs text-muted-foreground">Step-by-step instructions for new users</p>
            </div>
          </div>

          {/* Tab nav */}
          <div className="flex gap-1">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = step.id === activeStep;
              const isDone = idx < currentIndex;
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors
                    ${isActive
                      ? 'bg-primary text-primary-foreground'
                      : isDone
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {isDone
                    ? <CheckCircle2 className="h-3 w-3 shrink-0" />
                    : <Icon className="h-3 w-3 shrink-0" />
                  }
                  <span className="hidden sm:inline truncate">{step.label}</span>
                  <span className="sm:hidden">{idx + 1}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {STEP_CONTENT[activeStep]}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={goPrev} disabled={currentIndex === 0}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1} / {STEPS.length}
          </span>
          {currentIndex < STEPS.length - 1 ? (
            <Button size="sm" onClick={goNext}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleClose}>
              Done <CheckCircle2 className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
