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

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** `UNIQUE(provider, item_id)` on `bank_connections`. */
const CONNECTION_ITEM_CONSTRAINT = 'bank_connections_provider_item_key';

/**
 * This provider item already has a connection.
 *
 * Note what the constraint does *not* carry: an owner. That is deliberate and
 * it is why this error is not owner-scoped either. A Plaid Item id names one
 * login at one institution across the whole of Plaid, so the same id arriving
 * a second time is the same linked login however it arrives - re-running Link
 * against a bank that is already connected, which is the case a person can
 * actually reach.
 *
 * Like `ConnectionNotFoundError`, the message names nothing: whose connection
 * holds the item is not a thing to say to whoever asked.
 */
export class ConnectionAlreadyExistsError extends Error {
  constructor() {
    super('That bank is already connected');
    this.name = 'ConnectionAlreadyExistsError';
  }
}

function isDuplicateConnection(error: unknown): boolean {
  const driver = driverError(error);
  return (
    driver?.code === UNIQUE_VIOLATION &&
    driver.constraint_name === CONNECTION_ITEM_CONSTRAINT
  );
}

/**
 * Runs a write, translating a re-linked provider item into
 * `ConnectionAlreadyExistsError` and leaving every other failure alone.
 *
 * Keyed on the constraint name rather than on 23505 alone, for the same
 * reason `rejectingForeignProject` is: a second unique index added to these
 * tables later would otherwise start reporting itself as "already connected".
 */
export async function rejectingDuplicateConnection<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isDuplicateConnection(error)) throw new ConnectionAlreadyExistsError();
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
