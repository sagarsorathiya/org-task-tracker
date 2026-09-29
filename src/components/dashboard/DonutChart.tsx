'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface Segment {
  label: string;
  value: number;
  color: string;
  textColor: string;
}

interface DonutChartProps {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  className?: string;
}

export function DonutChart({ total, completed, inProgress, overdue, className }: DonutChartProps) {
  const other = Math.max(0, total - completed - inProgress - overdue);

  const segments: Segment[] = [
    { label: 'Completed',   value: completed,  color: 'hsl(var(--success))',          textColor: 'text-success' },
    { label: 'In Progress', value: inProgress, color: 'hsl(var(--warning))',          textColor: 'text-warning' },
    { label: 'Overdue',     value: overdue,    color: 'hsl(var(--destructive))',      textColor: 'text-destructive' },
    { label: 'Other',       value: other,      color: 'hsl(var(--muted-foreground))', textColor: 'text-muted-foreground' },
  ].filter((s) => s.value > 0);

  const cx = 60;
  const cy = 60;
  const r  = 46;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * r;
  const gap = total > 0 ? Math.min(2, circumference / (segments.length * 20)) : 0;

  let offset = -Math.PI / 2; // start at top

  const arcs = segments.map((seg) => {
    const fraction = total > 0 ? seg.value / total : 0;
    const arcLen   = fraction * circumference - gap;
    const dashArray  = `${Math.max(0, arcLen)} ${circumference}`;
    // strokeDashoffset: how far along the circumference to start (negative = clockwise)
    const dashOffset = -(offset / (2 * Math.PI)) * circumference;

    offset += fraction * 2 * Math.PI;

    return { ...seg, dashArray, dashOffset };
  });

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <div className="relative flex items-center justify-center">
        <svg width={120} height={120} viewBox="0 0 120 120">
          {total === 0 ? (
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={strokeWidth}
            />
          ) : (
            arcs.map((arc) => (
              <circle
                key={arc.label}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={strokeWidth}
                strokeDasharray={arc.dashArray}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease' }}
              />
            ))
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold tabular-nums text-foreground leading-none">{total}</span>
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground mt-0.5">Total</span>
        </div>
      </div>

      <div className="w-full grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[11px] text-muted-foreground truncate">{seg.label}</span>
            <span className={cn('ml-auto text-[11px] font-semibold tabular-nums shrink-0', seg.textColor)}>
              {seg.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
