'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * ⚠️ THE TYPE SCALE HERE IS THE PORTAL'S, NOT shadcn's DEFAULT.
 *
 * Transcribed from the tabular sections of
 * `docs/design-reference/Command_Center_dc.html` (the auto-completion ledger and
 * the department backlog): 11px uppercase `.05em` headers, 12.5px rows.
 *
 * This is the one edit that reaches every table in the app — people, identities,
 * role profiles, meetings, users, products all render through these primitives.
 * Restyling them individually would have meant six copies of the same numbers,
 * drifting apart from the first time one of them was touched.
 *
 * See `@/components/ui/panel` for the rest of the scale and for why these
 * arbitrary values are deliberately not "canonicalised".
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot='table-container' className='relative w-full'>
      <table
        data-slot='table'
        className={cn('w-full caption-bottom text-[12.5px]', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot='table-header' className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot='table-body'
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot='table-footer'
      className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot='table-row'
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot='table-head'
      className={cn(
        // Mock: 11px, 600, .05em, uppercase, muted. The uppercase cascades to the
        // sort button inside `DataTableColumnHeader`, which is intended — the
        // whole header row reads as one label strip.
        'text-muted-foreground h-9 px-[10px] text-left align-middle text-[11px] font-semibold tracking-[0.05em] whitespace-nowrap uppercase [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot='table-cell'
      className={cn(
        'px-[10px] py-[9px] align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot='table-caption'
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
