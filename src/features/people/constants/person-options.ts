/**
 * The template keeps static filter options here (see
 * this file is now the pattern; role-profiles and identities mirror it).
 *
 * People have no static option lists: role profiles are rows in the database,
 * so they are fetched via `getRoleProfileOptions()` and injected into the column
 * definitions by `buildColumns()`. This file holds only display constants.
 */

export const UNASSIGNED_LABEL = 'Unassigned';
export const NOT_LINKED_LABEL = 'Not linked';
