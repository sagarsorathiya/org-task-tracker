import { AvatarInitials } from './avatar-initials';
import { cn } from '@/lib/utils';

interface AvatarStackProps {
  names: string[];
  max?: number;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const overflowSize = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
};

export function AvatarStack({ names, max = 3, size = 'sm', className }: AvatarStackProps) {
  if (names.length === 0) return null;
  const visible = names.slice(0, max);
  const overflow = names.length - visible.length;

  return (
    <div className={cn('avatar-stack flex items-center -space-x-2', className)}>
      {visible.map((name, i) => (
        <AvatarInitials key={`${name}-${i}`} name={name} size={size} />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            'rounded-full font-semibold flex items-center justify-center shrink-0 select-none bg-muted text-muted-foreground',
            overflowSize[size]
          )}
          title={names.slice(max).join(', ')}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
