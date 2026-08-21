import postgres from 'postgres';
import { loadRootEnv, requireEnv } from './env';

/**
 * Creates the database `DATABASE_URL_TEST` points at, if it is not there yet.
 * The test suite drops and rebuilds its schema freely, so it needs a database
 * of its own rather than the development one.
 */
loadRootEnv();

const url = new URL(requireEnv('DATABASE_URL_TEST'));
const name = decodeURIComponent(url.pathname.slice(1));
if (!name) {
  console.error('DATABASE_URL_TEST has no database name.');
  process.exit(1);
}

// CREATE DATABASE cannot run inside the database being created, so this
// connects to the server's default one.
const maintenance = new URL(url.toString());
maintenance.pathname = '/postgres';

const sql = postgres(maintenance.toString(), { max: 1, prepare: false, onnotice: () => {} });
try {
  const existing = await sql`select 1 from pg_database where datname = ${name}`;
  if (existing.length > 0) {
    console.log(`Test database "${name}" already exists.`);
  } else {
    // The name comes from a URL the developer wrote, and CREATE DATABASE takes
    // no parameters, so it is quoted as an identifier rather than interpolated.
    await sql.unsafe(`create database "${name.replace(/"/g, '""')}"`);
    console.log(`Created test database "${name}".`);
  }
} finally {
  await sql.end();
}
