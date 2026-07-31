import { IDENTITY_SOURCES } from '@/db/schema';

/**
 * Static fallback for the source filter.
 *
 * The table prefers the DYNAMIC list from getIdentitySourceOptions() — only
 * sources that actually have unresolved identities — so the dropdown does not
 * offer five options when four are empty. This is the full set, used where the
 * dynamic one is not available.
 */
export const IDENTITY_SOURCE_OPTIONS = IDENTITY_SOURCES.map((s) => ({ value: s, label: s }));

/** How a link was established, for the badge on the People detail page. */
export const CONFIDENCE_LABELS: Record<string, { label: string; hint: string }> = {
  exact: { label: 'Exact', hint: 'The source itself identified this account' },
  email: { label: 'Email', hint: 'Matched automatically on email address' },
  manual: { label: 'Manual', hint: 'Confirmed by a person' }
};
