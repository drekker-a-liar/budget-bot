import { parseMoney } from '@budget-bot/core';
import { expect, it } from 'vitest';
import { projectsRepo } from '../../src/repos';
import { createOwner, describeDb, useTestDb } from '../helpers/db';
import { newProject } from '../helpers/fixtures';

const getDb = useTestDb();

describeDb('projectsRepo', () => {
  it('round-trips a project, cents and all', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    const created = await projectsRepo.createProject(
      db,
      ownerId,
      newProject({ quotedTotalCents: parseMoney('4500.00'), targetMarginPct: 42.5 })
    );
    const read = await projectsRepo.getProject(db, ownerId, created.id);

    expect(read).toEqual(created);
    expect(read?.quotedTotalCents).toBe(450000);
    expect(read?.targetMarginPct).toBe(42.5);
    expect(read?.quotedLaborHours).toBe(32);
  });

  it('omits an absent optional date rather than reporting null', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    const created = await projectsRepo.createProject(
      db,
      ownerId,
      newProject({ deadlineDate: undefined })
    );

    expect(created.deadlineDate).toBeUndefined();
    expect(created.completedDate).toBeUndefined();
  });

  it('lists the newest project first', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await projectsRepo.createProject(db, ownerId, newProject({ name: 'Older' }));
    await projectsRepo.createProject(db, ownerId, newProject({ name: 'Newer' }));

    const listed = await projectsRepo.listProjects(db, ownerId);

    expect(listed.map((project) => project.name)).toEqual(['Newer', 'Older']);
  });

  it('applies only the fields an update names', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const created = await projectsRepo.createProject(db, ownerId, newProject());

    const updated = await projectsRepo.updateProject(db, ownerId, created.id, {
      status: 'completed',
      completedDate: '2026-08-13',
    });

    expect(updated?.status).toBe('completed');
    expect(updated?.completedDate).toBe('2026-08-13');
    expect(updated?.name).toBe(created.name);
    expect(updated?.quotedTotalCents).toBe(created.quotedTotalCents);
  });

  it('treats an id that is not a uuid as no such project', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await projectsRepo.getProject(db, ownerId, 'proj-1')).toBeUndefined();
    expect(await projectsRepo.updateProject(db, ownerId, 'proj-1', {})).toBeNull();
    expect(await projectsRepo.deleteProject(db, ownerId, 'proj-1')).toBe(false);
  });

  it('never returns, updates or deletes another owner’s projects', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const hers = await projectsRepo.createProject(db, alice, newProject());

    expect(await projectsRepo.listProjects(db, bob)).toEqual([]);
    expect(await projectsRepo.getProject(db, bob, hers.id)).toBeUndefined();
    expect(await projectsRepo.updateProject(db, bob, hers.id, { name: 'Mine' })).toBeNull();
    expect(await projectsRepo.deleteProject(db, bob, hers.id)).toBe(false);
    expect(await projectsRepo.getProject(db, alice, hers.id)).toBeDefined();
  });

  it('deletes a project the owner does own', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const created = await projectsRepo.createProject(db, ownerId, newProject());

    expect(await projectsRepo.deleteProject(db, ownerId, created.id)).toBe(true);
    expect(await projectsRepo.listProjects(db, ownerId)).toEqual([]);
  });
});
