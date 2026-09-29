// ──────────────────────────────────────────────
// Organization Activity Tracker — Constants & Enums
// ──────────────────────────────────────────────

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  USER: 'user',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Supervisor' },
  { value: 'user', label: 'User' },
];

export const STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type TaskStatus = (typeof STATUS)[keyof typeof STATUS];

// Display-status filter options — matches what users see on screen.
// 'upcoming' and 'overdue' are derived display statuses, not raw DB statuses.
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type TaskPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const CHANNELS = {
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  BOTH: 'both',
} as const;

export type ReminderChannel = (typeof CHANNELS)[keyof typeof CHANNELS];

export const CHANNEL_OPTIONS: { value: ReminderChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Both' },
];

export const AUTH_TYPES = {
  LDAP: 'ldap',
  LOCAL: 'local',
  DEMO: 'demo',
} as const;

export type AuthType = (typeof AUTH_TYPES)[keyof typeof AUTH_TYPES];

export const TRANSACTION_REMINDER_TYPE_OPTIONS: { value: 'subscription' | 'payment'; label: string }[] = [
  { value: 'payment', label: 'Payment' },
  { value: 'subscription', label: 'Subscription' },
];

export const TRANSACTION_REMINDER_RECURRENCE_OPTIONS: { value: 'none' | 'weekly' | 'monthly' | 'yearly'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const MIME_ALLOWLIST = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/jpg',
] as const;

export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'task_assigned',
  TASK_UPDATED: 'task_updated',
  TASK_COMMENTED: 'task_commented',
  REMINDER_SENT: 'reminder_sent',
  TASK_DUE_SOON: 'task_due_soon',
  TASK_OVERDUE: 'task_overdue',
} as const;

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const RATE_LIMIT = {
  AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AUTH_MAX_REQUESTS: 10,
} as const;
