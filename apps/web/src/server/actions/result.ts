import { z } from 'zod';

/**
 * What a server action answers with.
 *
 * A rejected form is not an exception. Typing an amount wrong is the most
 * ordinary thing a user does, and throwing would send them to an error page
 * having lost what they typed. So validation failure is a value: the action
 * returns which fields were wrong, and the form that called it puts the
 * messages next to the inputs.
 *
 * Anything genuinely exceptional - the database being unreachable - still
 * throws, and Next's error boundary is the right place for it.
 */

/** Field name to the messages against it, as a form wants to render them. */
export type FieldErrors = Record<string, string[]>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function failed<T>(error: string, fieldErrors?: FieldErrors): ActionResult<T> {
  return { ok: false, error, fieldErrors };
}

/**
 * The action equivalent of a 401. An action reached without a session is not
 * a form the user can fix, so it carries no field errors.
 */
export function unauthorized<T>(): ActionResult<T> {
  return { ok: false, error: 'Unauthorized' };
}

/** A zod failure, flattened into something a form can render. */
export function invalid<T>(error: z.ZodError): ActionResult<T> {
  const flat = z.flattenError(error);
  const fieldErrors = flat.fieldErrors as FieldErrors;
  const first =
    Object.values(fieldErrors).flat()[0] ?? flat.formErrors[0] ?? 'That is not valid.';
  return { ok: false, error: first, fieldErrors };
}
