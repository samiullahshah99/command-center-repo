'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  const router = useRouter();

  return (
    <div className='absolute top-1/2 left-1/2 mb-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center'>
      <span className='from-foreground bg-linear-to-b to-transparent bg-clip-text text-[10rem] leading-none font-extrabold text-transparent'>
        404
      </span>
      <h2 className='font-heading my-2 text-2xl font-bold'>Something&apos;s missing</h2>
      <p>Sorry, the page you are looking for doesn&apos;t exist or has been moved.</p>
      <div className='mt-8 flex justify-center gap-2'>
        {/*
          ⚠️ THIS ONE STAYS A BUTTON. `router.back()` is a history action, not a
          destination — there is no URL to put in an href, and a <Link> cannot
          express "wherever you came from". A native button is the correct
          semantics here.
        */}
        <Button onClick={() => router.back()} variant='default' size='lg'>
          Go back
        </Button>
        {/* Pure navigation to a known URL → <Link> + buttonVariants. */}
        <Link href='/dashboard' className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }))}>
          Back to Home
        </Link>
      </div>
    </div>
  );
}
