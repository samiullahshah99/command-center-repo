import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { personByName } from '../fixtures';

/** Initials avatar. `person` has no image column, so initials ARE the avatar. */
export function OwnerAvatar({
  name,
  size = 'sm',
  className
}: {
  name: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims = { sm: 'size-5 text-[9px]', md: 'size-6 text-[10px]', lg: 'size-14 text-lg' }[size];

  if (!name) {
    return (
      <span
        className={cn(
          'border-muted-foreground/30 text-muted-foreground inline-flex items-center justify-center rounded-full border border-dashed',
          dims,
          className
        )}
        title='Unassigned'
      >
        ?
      </span>
    );
  }

  return (
    <Avatar className={cn(dims, className)}>
      <AvatarFallback className={cn('font-medium', dims)}>
        {personByName(name)?.initials ?? name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
