/**
 * Turning a constraint violation into something the application can act on.
 *
 * The composite `(project_id, owner_id)` foreign keys are what stop a row
 * being attached to another owner's project. When one fires, the caller passed
 * a project id that is not theirs - which from their side is indistinguishable
 * from a project that does not exist, and should read as "no such project"
 * rather than as a database error escaping to a 500.
 */

/** Postgres `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';

const PROJECT_OWNER_CONSTRAINTS = new Set([
  'invoices_project_id_owner_id_fk',
  'labor_entries_project_id_owner_id_fk',
  'transactions_project_id_owner_id_fk',
]);

export class UnknownProjectError extends Error {
  readonly projectId?: string;

  constructor(projectId?: string) {
    super(
      projectId
        ? `No project '${projectId}' belongs to this owner`
        : 'This write references a project that does not belong to this owner'
    );
    this.name = 'UnknownProjectError';
    this.projectId = projectId;
  }
}

interface DriverError {
  code?: string;
  constraint_name?: string;
}

/** drizzle wraps the driver's error, so the useful fields are on the cause. */
function driverError(error: unknown): DriverError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as DriverError & { cause?: unknown };
  if (candidate.code !== undefined) return candidate;
  return driverError(candidate.cause);
}

function isForeignProject(error: unknown): boolean {
  const driver = driverError(error);
  return (
    driver?.code === FOREIGN_KEY_VIOLATION &&
    driver.constraint_name !== undefined &&
    PROJECT_OWNER_CONSTRAINTS.has(driver.constraint_name)
  );
}

/**
 * Runs a write, translating a cross-owner project reference into
 * `UnknownProjectError` and leaving every other failure alone.
 *
 * `projectId` is only for the message; a bulk write can trip the constraint on
 * any row in the batch, so it is omitted there rather than guessed at.
 */
export async function rejectingForeignProject<T>(
  projectId: string | undefined,
  write: () => Promise<T>
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isForeignProject(error)) throw new UnknownProjectError(projectId);
    throw error;
  }
}

/**
 * No connection with that id belongs to this owner.
 *
 * Deliberately says nothing else. A connection id that is not yours and one
 * that does not exist have to be the same answer, or the difference between
 * the two messages tells a caller which ids are real - and the id itself is
 * left out for the same reason, since echoing it back confirms it.
 */
export class ConnectionNotFoundError extends Error {
  constructor() {
    super('Bank connection not found');
    this.name = 'ConnectionNotFoundError';
  }
}
