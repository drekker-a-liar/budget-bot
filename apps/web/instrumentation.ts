/**
 * Next calls `register()` once, before the first request is served. That makes
 * it the only place a misconfigured production deployment can be stopped
 * *before* it starts answering (ADR 0003, spec §7): a throw here fails the
 * boot, so the deployment serves a 500 rather than data.
 */
export async function register(): Promise<void> {
  // Also runs on the Edge runtime, where the assertion's checks (and Buffer)
  // do not belong; the Node instance is the one that reaches the database.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertProductionSecurity } = await import('./src/env');
  assertProductionSecurity();
}
