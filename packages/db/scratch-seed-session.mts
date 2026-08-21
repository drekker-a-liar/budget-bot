// Creates a user + a real Auth.js session row, so the smoke test can sign in
// without an OAuth app, then seeds that owner with the demo fixtures.
import { createDb, seedOwner } from '@budget-bot/db';
import { sessions, users } from '@budget-bot/db/schema';
import { eq } from 'drizzle-orm';

const db = createDb(process.env.DATABASE_URL!, { max: 1 });
const EMAIL = 'verify@example.com';
const TOKEN = 'smoke-test-session-token';

await db.delete(users).where(eq(users.email, EMAIL));
const [user] = await db
  .insert(users)
  .values({ email: EMAIL, name: 'Verify' })
  .returning({ id: users.id });

await db.insert(sessions).values({
  sessionToken: TOKEN,
  userId: user.id,
  expires: new Date(Date.now() + 86_400_000),
});

const result = await seedOwner(db, user.id, { reset: true });
console.log(JSON.stringify({ userId: user.id, token: TOKEN, ...result }));
await db.$client.end();
