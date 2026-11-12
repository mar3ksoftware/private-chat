// ── Profile validation (C9) ──
// Client-side mirror of the server rules; error strings are exact per spec D.

import { CONSTANTS } from '../types';

const CONTROL_CHARS = /\p{Cc}/u;

export type ProfileValidation = {
  readonly displayName: string;
  readonly status: string;
  readonly nameError: string | null;
  readonly statusError: string | null;
};

export function validateProfile(rawDisplayName: string, rawStatus: string): ProfileValidation {
  const displayName = rawDisplayName.trim();
  const status = rawStatus.trim();

  const nameError =
    displayName.length < 1 ||
    displayName.length > CONSTANTS.MAX_DISPLAY_NAME_LENGTH ||
    CONTROL_CHARS.test(displayName)
      ? 'Display name is too long (max 32).'
      : null;

  const statusError =
    status.length > CONSTANTS.MAX_STATUS_LENGTH || CONTROL_CHARS.test(status)
      ? 'Status is too long (max 80).'
      : null;

  return { displayName, status, nameError, statusError };
}
