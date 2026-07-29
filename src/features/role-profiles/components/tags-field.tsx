'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { useState } from 'react';

/**
 * Add/remove tag editor for a `string[]` value.
 *
 * The shared form kit (src/components/ui/tanstack-form.tsx) has no array field,
 * so this is a controlled component driven through the `form.AppField`
 * render-prop escape hatch rather than a new shared primitive.
 */
export function TagsField({
  label,
  description,
  value,
  onChange,
  placeholder
}: {
  label: string;
  description?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const next = draft.trim();
    if (next === '') return;
    if (value.includes(next)) {
      setDraft('');
      return;
    }
    onChange([...value, next]);
    setDraft('');
  }

  return (
    <div className='space-y-2'>
      <label className='text-sm leading-none font-medium'>{label}</label>

      <div className='flex gap-2'>
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter must not submit the surrounding form.
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button type='button' variant='outline' onClick={commit}>
          <Icons.add className='h-4 w-4' />
          <span className='sr-only'>Add</span>
        </Button>
      </div>

      {value.length > 0 ? (
        <div className='flex flex-wrap gap-2 pt-1'>
          {value.map((tag) => (
            <Badge key={tag} variant='secondary' className='gap-1'>
              {tag}
              <button
                type='button'
                aria-label={`Remove ${tag}`}
                className='hover:text-destructive ml-1 cursor-pointer'
                onClick={() => onChange(value.filter((t) => t !== tag))}
              >
                <Icons.close className='h-3 w-3' />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>None yet.</p>
      )}

      {description ? <p className='text-muted-foreground text-sm'>{description}</p> : null}
    </div>
  );
}
