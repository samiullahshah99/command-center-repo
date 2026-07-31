import type { IdentityConfidence, IdentitySource } from '@/db/schema';

/**
 * What a connector knows about the actor on an event.
 *
 * ⚠️ `externalId` is opaque and only meaningful together with `source`. Vision,
 * UGC and Command Centre run three separate Clerk instances, so ids are not
 * comparable between them.
 */
export type ResolveInput = {
  source: IdentitySource;
  externalId: string;
  /** As reported by THIS source. Routinely null — see the note on Resolution. */
  email?: string | null;
  /** Display only. Never used to match. */
  displayName?: string | null;
  /** Vision only. Display only. Never used to match. */
  editorName?: string | null;
};

/**
 * Why an identity could not be attached to a person.
 *
 * Both are ordinary operating states, not failures: Vision and UGC document
 * `actor.email` as nullable, and Slack events carry no email at all.
 */
export type UnresolvedReason =
  /** The source sent no email, so there was nothing to match on. */
  | 'no_email'
  /** An email arrived but no person in the roster has it. */
  | 'no_person_for_email';

export type Resolution =
  | {
      status: 'resolved';
      /** 'exact' when a link already existed; 'email' when this call created one. */
      confidence: Extract<IdentityConfidence, 'exact' | 'email'>;
      personId: string;
      identityId: string;
    }
  | {
      status: 'unresolved';
      /** The identity is STILL persisted — this id is its row. */
      identityId: string;
      reason: UnresolvedReason;
    };

export type { IdentityConfidence, IdentitySource };
