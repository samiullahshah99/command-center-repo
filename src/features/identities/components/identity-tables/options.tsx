import { IDENTITY_SOURCE_OPTIONS } from '../../constants/identity-options';

/**
 * Filter option definitions, mirroring products/components/product-tables/options.tsx.
 *
 * The table injects the DYNAMIC source list instead (only sources with
 * unresolved identities). This static set is the fallback for contexts without
 * a query — keeping the file present preserves the canonical folder shape.
 */
export const SOURCE_OPTIONS = IDENTITY_SOURCE_OPTIONS;
