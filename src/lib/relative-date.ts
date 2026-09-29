export type DateUrgency = 'overdue' | 'today' | 'soon' | 'normal';

export interface RelativeDate {
  label: string;
  urgency: DateUrgency;
}

export function relativeDate(date: Date | string | null | undefined): RelativeDate {
  if (!date) return { label: '—', urgency: 'normal' };

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return { label: '—', urgency: 'normal' };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = targetStart.getTime() - todayStart.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return { label: abs === 1 ? '1d late' : `${abs}d late`, urgency: 'overdue' };
  }
  if (diffDays === 0) return { label: 'Today', urgency: 'today' };
  if (diffDays === 1) return { label: 'Tomorrow', urgency: 'soon' };
  if (diffDays <= 7) return { label: `In ${diffDays}d`, urgency: 'soon' };

  return {
    label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    urgency: 'normal',
  };
}

export function urgencyClass(urgency: DateUrgency): string {
  switch (urgency) {
    case 'overdue': return 'text-destructive';
    case 'today': return 'text-warning';
    case 'soon': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}
