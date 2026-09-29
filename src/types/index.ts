// ──────────────────────────────────────────────
// Organization Activity Tracker — TypeScript Types
// ──────────────────────────────────────────────

import type { Role, TaskStatus, TaskPriority, ReminderChannel, AuthType } from '@/constants';

// ─── NextAuth Extensions ───────────────────────

declare module 'next-auth' {
  interface Session {
    user: SessionUser;
  }

  interface User {
    id?: string;
    username: string;
    role: Role;
    companyId: number | null;
    deptId: number | null;
    onboardingComplete: boolean;
    insightsAccess?: boolean;
    companyHeadAccess?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: number;
    username: string;
    role: Role;
    companyId: number | null;
    deptId: number | null;
    onboardingComplete: boolean;
    insightsAccess?: boolean;
    companyHeadAccess?: boolean;
  }
}

// ─── Session User ──────────────────────────────

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  companyId: number | null;
  deptId: number | null;
  onboardingComplete: boolean;
  insightsAccess?: boolean;
  companyHeadAccess?: boolean;
  displayName?: string;
  email?: string;
}

// ─── Database Entities ─────────────────────────

export interface Company {
  id: number;
  name: string;
  code: string;
  active: boolean;
  created_at: string;
}

export interface Department {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Designation {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
}

export interface DeptCompanyMap {
  id: number;
  dept_id: number;
  company_id: number;
}

export interface DesigDeptMap {
  id: number;
  desig_id: number;
  dept_id: number;
}

export interface DesigCompanyHeadMap {
  id: number;
  desig_id: number;
  company_id: number;
}

export interface UserScopeAssignment {
  id: number;
  user_id: number;
  company_id: number;
  dept_id: number | null;
  desig_id: number | null;
  responsibility_type: string | null;
  is_primary: boolean;
  is_active: boolean;
  active_from: string | null;
  active_to: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  company_name?: string;
  dept_name?: string;
  desig_name?: string;
}

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  mobile_number: string | null;
  company_id: number | null;
  dept_id: number | null;
  desig_id: number | null;
  role: Role;
  auth_type: AuthType;
  is_active: boolean;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  // Joined fields
  company_name?: string;
  dept_name?: string;
  desig_name?: string;
  scope_assignments?: UserScopeAssignment[];
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  activity_start_date: string | null;
  activity_start_time?: string | null;
  assigned_to: number | null;
  assigned_to_ids?: number[];
  information_ids?: number[];
  assigned_by: number | null;
  company_id: number | null;
  dept_id: number | null;
  status: TaskStatus;
  display_status?: TaskStatus | 'upcoming' | 'overdue';
  priority: TaskPriority;
  last_follow_up_date: string | null;
  due_date: string | null;
  due_time?: string | null;
  follow_up_date: string | null;
  follow_up_time?: string | null;
  last_status_update_at?: string | null;
  next_reminder_at?: string | null;
  remarks_action_taken: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  assigned_to_name?: string;
  information_to_name?: string;
  assigned_by_name?: string;
  company_name?: string;
  dept_name?: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  body: string;
  created_at: string;
  // Joined
  user_name?: string;
  user_display_name?: string;
}

export interface TaskActivity {
  id: number;
  task_id: number;
  user_id: number;
  action: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  // Joined
  user_name?: string;
  user_display_name?: string;
}

export interface TaskAttachment {
  id: number;
  task_id: number;
  uploaded_by: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  // Joined
  uploaded_by_name?: string;
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  is_done: boolean;
  sort_order: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderRule {
  id: number;
  task_id: number;
  offset_days: number;
  remind_at?: string | null;
  channel: ReminderChannel;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
}

export interface ReminderLog {
  id: number;
  task_id: number;
  rule_id: number;
  channel: string;
  recipient: string | null;
  status: 'sent' | 'failed' | 'skipped';
  error_msg: string | null;
  sent_at: string;
  // Joined
  task_title?: string;
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  message: string;
  is_read: boolean;
  ref_task_id: number | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  diff: Record<string, unknown> | null;
  created_at: string;
  // Joined
  actor_name?: string;
}

// ─── Transaction Reminders ──────────────────────

export type TransactionReminderType = 'subscription' | 'payment';
export type TransactionReminderRecurrence = 'none' | 'weekly' | 'monthly' | 'yearly';

export interface TransactionReminder {
  id: number;
  type: TransactionReminderType;
  party_name: string;
  vendor_code: string | null;
  place: string | null;
  agreement: string | null;
  execution_date: string | null;
  bill_date: string | null;
  reminder_date: string;
  reminder_time: string;
  recurrence: TransactionReminderRecurrence;
  reminder_emails: string[];
  company_id: number | null;
  dept_id: number | null;
  created_by: number | null;
  is_deleted: boolean;
  deleted_at: string | null;
  is_reminder_sent: boolean;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  company_name?: string;
  dept_name?: string;
  attachment_count?: number;
}

export interface TransactionReminderAttachment {
  id: number;
  transaction_id: number;
  uploaded_by: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  // Joined
  uploaded_by_name?: string;
}

// ─── Dashboard ─────────────────────────────────

export interface DashboardStats {
  total: number;
  inProgress: number;
  completed: number;
  overdue: number;
  highPriority: number;
  dueToday: number;
  upcoming7Days: number;
}

// ─── API Responses ─────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Form / Request Types ──────────────────────

export interface TaskCreateInput {
  title: string;
  description?: string;
  activityStartDate?: string;
  assignedTo?: number;
  assignedToIds?: number[];
  companyId?: number;
  deptId?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  lastFollowUpDate?: string;
  nextFollowUpDate?: string;
  targetCompletionDate?: string;
  remarksActionTaken?: string;
  dueDate?: string;
  followUpDate?: string;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  activityStartDate?: string | null;
  assignedTo?: number | null;
  assignedToIds?: number[] | null;
  companyId?: number | null;
  deptId?: number | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  lastFollowUpDate?: string | null;
  nextFollowUpDate?: string | null;
  targetCompletionDate?: string | null;
  remarksActionTaken?: string | null;
  dueDate?: string | null;
  followUpDate?: string | null;
}

export interface OnboardInput {
  companyId: number;
  deptId: number;
  desigId: number;
}

export interface MappingInput {
  type: 'dept-company' | 'desig-dept';
  sourceId: number;
  targetIds: number[];
}

// ─── Personal Tasks ────────────────────────────

export type PersonalPriority = 'low' | 'medium' | 'high';
export type PersonalStatus = 'pending' | 'done';
export type PersonalChannel = 'email' | 'whatsapp' | 'both' | 'in_app';
export type PersonalRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface PersonalSubtask {
  id: number;
  task_id: number;
  user_id: number;
  title: string;
  is_done: boolean;
  sort_order: number;
  created_at: string;
}

export interface PersonalReminder {
  id: number;
  task_id: number;
  remind_at: string;
  channel: PersonalChannel;
  is_fired: boolean;
  created_at: string;
}

export interface PersonalActivity {
  id: number;
  task_id: number;
  user_id: number;
  action: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  display_name: string;
}

export interface PersonalComment {
  id: number;
  task_id: number;
  user_id: number;
  body: string;
  created_at: string;
  display_name: string;
}

export interface PersonalTask {
  id: number;
  user_id: number;
  title: string;
  notes: string | null;
  priority: PersonalPriority;
  due_date: string | null;
  due_time: string | null;
  status: PersonalStatus;
  remind_at: string | null;
  remind_channel: PersonalChannel | null;
  recurrence_rule: PersonalRecurrence;
  created_at: string;
  updated_at: string;
  subtasks: PersonalSubtask[];
  reminders: PersonalReminder[];
}

// ─── Component Props ───────────────────────────

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render?: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  total?: number;
  page?: number;
  totalPages?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  density?: 'compact' | 'comfortable' | 'spacious';
}
