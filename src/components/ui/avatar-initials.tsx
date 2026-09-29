import { cn } from '@/lib/utils';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = ((h * 31 + c.charCodeAt(0)) >>> 0);
  return h % 360;
}

interface AvatarInitialsProps {
  name: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export function AvatarInitials({ name, size = 'sm', className }: AvatarInitialsProps) {
  const sizeClasses = {
    xs: 'h-5 w-5 text-[9px]',
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
  };
  const hue = avatarHue(name || '?');

  return (
    <div
      className={cn(
        'rounded-full font-semibold flex items-center justify-center shrink-0 select-none',
        sizeClasses[size],
        className
      )}
      style={{
        background: `hsl(${hue} 60% 88%)`,
        color: `hsl(${hue} 50% 30%)`,
      }}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
}
