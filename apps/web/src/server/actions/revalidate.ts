import { revalidatePath } from 'next/cache';

/**
 * Every page draws from the same four tables.
 *
 * A receipt filed against a job changes that job's margin, the dashboard's
 * average, the inbox count in the header and the week's outflow on the cash
 * flow page. Revalidating the paths a write "belongs to" would mean keeping a
 * map of which mutation touches which page in step with the queries, and the
 * failure mode of that map going stale is a number that is quietly wrong.
 *
 * So every write invalidates the whole tree. At one user reading one page at a
 * time, the cost is one extra render; the alternative is a class of bug that
 * only shows up as a figure nobody can explain.
 */
export function revalidateApp(): void {
  revalidatePath('/', 'layout');
}
