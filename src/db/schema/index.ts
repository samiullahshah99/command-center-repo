// Barrel for the Drizzle schema. drizzle.config.ts points at this directory, and
// src/db/index.ts passes the whole namespace to drizzle() so relational queries
// can resolve table references by name.
//
// Naming: snake_case table and column names, singular table names.

export * from './role-profile';
export * from './ai-summary';
export * from './external-system';
export * from './person';
export * from './project';
export * from './person-identity';
export * from './unified-event';
export * from './candidate-action-item';
export * from './tracked-item';
export * from './recurring-task';
export * from './completion-event';
export * from './raw-event';
export * from './transcript';
