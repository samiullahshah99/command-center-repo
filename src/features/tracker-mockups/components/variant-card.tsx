import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';

export function VariantCard({
  href,
  title,
  description,
  icon
}: {
  href: string;
  title: string;
  description: string;
  icon: keyof typeof Icons;
}) {
  const Icon = Icons[icon];

  return (
    <Link href={href} className='group' aria-label={`Open the ${title} mockup`}>
      <Card className='hover:border-primary/40 h-full transition-colors'>
        <CardContent className='flex flex-col gap-3 pt-6'>
          <span className='bg-muted flex size-9 items-center justify-center rounded-lg'>
            <Icon className='size-4.5' />
          </span>
          <h2 className='font-medium group-hover:underline'>{title}</h2>
          <p className='text-muted-foreground text-sm'>{description}</p>
          <span className='text-muted-foreground mt-1 flex items-center gap-1 text-xs'>
            View mockup
            <Icons.chevronRight className='size-3.5' />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
