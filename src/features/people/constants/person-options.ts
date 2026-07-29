/**
 * The template keeps static filter options here (see
 * src/features/products/constants/product-options.ts).
 *
 * People have no static option lists: role profiles are rows in the database,
 * so they are fetched via `getRoleProfileOptions()` and injected into the column
 * definitions by `buildColumns()`. This file holds only display constants.
 */

export const UNASSIGNED_LABEL = 'Unassigned';
export const NOT_LINKED_LABEL = 'Not linked';
