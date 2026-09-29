export type DisplayTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled' | 'upcoming' | 'overdue';

function parseDateTime(datePart?: string | null, timePart?: string | null): Date | null {
  if (!datePart) return null;
  const normalizedDate = datePart.split('T')[0];
  const normalizedTime = (timePart || '00:00:00').slice(0, 8);
  const parsed = new Date(`${normalizedDate}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deriveDisplayTaskStatus(input: {
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  activityStartDate?: string | null;
  activityStartTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  now?: Date;
}): DisplayTaskStatus {
  const { status, activityStartDate, activityStartTime, dueDate, dueTime, now = new Date() } = input;

  if (status === 'completed' || status === 'cancelled') {
    return status;
  }

  const startAt = parseDateTime(activityStartDate, activityStartTime);

  if (!dueDate) {
    if (startAt && now.getTime() < startAt.getTime()) {
      return status === 'in_progress' ? 'in_progress' : 'upcoming';
    }
    if (startAt) {
      return 'in_progress';
    }
    return status === 'in_progress' ? 'in_progress' : status;
  }

  const targetAt = parseDateTime(dueDate, dueTime);
  if (!targetAt) {
    if (startAt && now.getTime() < startAt.getTime()) {
      return status === 'in_progress' ? 'in_progress' : 'upcoming';
    }
    if (startAt) {
      return 'in_progress';
    }
    return status === 'in_progress' ? 'in_progress' : status;
  }

  if (now.getTime() < targetAt.getTime()) {
    if (startAt && now.getTime() >= startAt.getTime()) {
      return 'in_progress';
    }
    return status === 'in_progress' ? 'in_progress' : 'upcoming';
  }

  const hasDueTime = !!dueTime;
  if (hasDueTime && now.getTime() > targetAt.getTime()) {
    return 'overdue';
  }

  const endOfTargetDay = parseDateTime(dueDate, '23:59:59');
  if (endOfTargetDay && now.getTime() > endOfTargetDay.getTime()) {
    return 'overdue';
  }

  return 'in_progress';
}
