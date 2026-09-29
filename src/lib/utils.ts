// ──────────────────────────────────────────────
// Shared Utility Functions
// ──────────────────────────────────────────────

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateInput(date: string | Date): Date | null {
  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = date.trim();
  if (!normalized) {
    return null;
  }

  const match = DATE_ONLY_RE.exec(normalized);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const localDate = new Date(year, month - 1, day);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Merge Tailwind classes safely (shadcn/ui pattern) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format date for display using Intl */
export function formatDate(date: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return '—';
  const d = parseDateInput(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(d);
}

/** Format date with time */
export function formatDateTime(date: string | Date | null | undefined): string {
  return formatDate(date, { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Truncate text to max length */
export function truncate(text: string, maxLength: number = 80): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.substring(0, maxLength).trimEnd() + '…';
}

/** Split a comma-joined name string (e.g. `assigned_to_name`) into a clean list */
export function parseNameList(value?: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((n) => n.trim()).filter(Boolean);
}

/** Convert bytes to human-readable file size */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Build URL search params, omitting empty values */
export function buildSearchParams(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      sp.set(key, String(value));
    }
  }
  return sp.toString();
}

/** Check if the current user can perform an admin action */
export function isAdmin(role: string | undefined): boolean {
  return role === 'admin';
}

/** Convert internal role values to user-friendly labels. */
export function formatSystemRole(role: string | undefined): string {
  if (role === 'manager') return 'Supervisor';
  if (role === 'admin') return 'Admin';
  if (role === 'user') return 'User';
  return role || 'User';
}

/** Insights access is controlled by system role or computed session permission. */
export function canViewInsights(role: string | undefined, insightsAccess?: boolean): boolean {
  return role === 'admin' || role === 'manager' || insightsAccess === true;
}

/** Check if the user can manage tasks (admin or manager) */
export function canManageTasks(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'user';
}

/** Delay helper for async operations */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared categorical tint rotation — for UI elements that need more than the 4
 * semantic status colors (success/warning/info/destructive) to visually distinguish
 * many categories (department tags, activity-type icons, notification types, chart
 * series). Reuses the theme's semantic tokens instead of introducing new hardcoded
 * hues, so the whole app still draws from one token palette.
 */
export const CATEGORY_TINTS = [
  { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/25' },
  { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25' },
  { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/25' },
  { bg: 'bg-info/10', text: 'text-info', border: 'border-info/25' },
  { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/25' },
  { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' },
] as const;

/** Deterministic hash of a string into a CATEGORY_TINTS index (or any modulus). */
export function categoryHash(key: string, modulus: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % modulus;
}

/** Look up a deterministic categorical tint for a given key (e.g. department name, action type). */
export function categoryTint(key: string): (typeof CATEGORY_TINTS)[number] {
  return CATEGORY_TINTS[categoryHash(key, CATEGORY_TINTS.length)];
}
