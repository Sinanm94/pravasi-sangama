import type { Request, RequestHandler, Response } from 'express';
import {
  ActivityQuerySchema,
  CreateActivitySchema,
  UpdateActivitySchema,
  type ActivityListResponse,
  type ActivityRecord,
} from '@pravasi/shared';
import { notFound, unauthorized } from '../../lib/errors.js';
import * as repo from './activities.repository.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** requireSuperuser has already run; this is the typed read of the claims. */
function superuserId(req: Request): string {
  if (!req.auth || req.auth.role !== 'SUPERUSER') throw unauthorized();
  return req.auth.superuserId;
}

const toActivity = (r: repo.ActivityRow): ActivityRecord => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  priority: r.priority,
  dueOn: r.due_on,
  doneAt: r.done_at?.toISOString() ?? null,
  createdByName: r.created_by_name,
  assignedTo: r.assigned_to,
  assignedToName: r.assigned_to_name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/* ------------------------------------------------------------------ */
/* GET /api/activities                                                 */
/* ------------------------------------------------------------------ */

export const listActivities = handle(async (req, res) => {
  const q = ActivityQuerySchema.parse(req.query);
  const filters = {
    state: q.state,
    assignedTo: q.assigned_to,
    search: q.search,
  };

  const [rows, totals] = await Promise.all([
    repo.listActivities(filters, q.limit),
    /* Totals are deliberately computed over the UNFILTERED set: the cards
     * say "how much is outstanding overall", and recomputing them per
     * filter would make "3 overdue" mean something different depending on
     * which tab happened to be selected. */
    repo.summariseActivities({}),
  ]);

  const body: ActivityListResponse = {
    activities: rows.map(toActivity),
    totals,
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* GET /api/activities/export — CSV report                             */
/* ------------------------------------------------------------------ */

/** A backstop against an unbounded response, not a page size. */
const EXPORT_ROW_LIMIT = 100_000;

/**
 * RFC 4180: a field containing a comma, quote or newline is quoted, and an
 * internal quote is doubled — not backslash-escaped, which is a CSV myth
 * that corrupts the file for every spreadsheet reader.
 *
 * A local copy, matching `clients.controller.ts` and `admin.controller.ts`
 * rather than a shared helper — the maintainers have kept these per-module
 * so far, and a third identical copy is easier to extract later than a
 * premature abstraction is to unpick.
 */
function csvEscape(value: string | number): string {
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const ACTIVITY_CSV_COLUMNS: Array<{
  header: string;
  value: (a: repo.ActivityRow) => string | number;
}> = [
  { header: 'Title', value: (a) => a.title },
  { header: 'Notes', value: (a) => a.notes ?? '' },
  { header: 'Priority', value: (a) => a.priority },
  // Derived from done_at — the only "done" signal there is (migration 018).
  { header: 'Status', value: (a) => (a.done_at ? 'Done' : 'Pending') },
  { header: 'Due On', value: (a) => a.due_on ?? '' },
  { header: 'Assigned To', value: (a) => a.assigned_to_name ?? '' },
  { header: 'Added By', value: (a) => a.created_by_name ?? '' },
  { header: 'Done At (UTC)', value: (a) => a.done_at?.toISOString() ?? '' },
  { header: 'Created At (UTC)', value: (a) => a.created_at.toISOString() },
];

/**
 * Exports the task list as CSV.
 *
 * Shares `ActivityQuerySchema` and the same repository call as the JSON
 * list, so the report contains exactly the rows the screen was showing.
 * `limit` is ignored in favour of the fixed cap — a report is not paginated,
 * and letting the client set it would make the file's completeness depend on
 * a query parameter nobody sees.
 */
export const exportActivities = handle(async (req, res) => {
  const q = ActivityQuerySchema.parse(req.query);

  const rows = await repo.listActivities(
    { state: q.state, assignedTo: q.assigned_to, search: q.search },
    EXPORT_ROW_LIMIT,
  );

  const header = ACTIVITY_CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
  const body = rows.map((r) =>
    ACTIVITY_CSV_COLUMNS.map((c) => csvEscape(c.value(r))).join(','),
  );

  /* A UTF-8 BOM so Excel opens transliterated names correctly instead of
   * guessing the system codepage; every other CSV reader treats it as a
   * no-op. CRLF is RFC 4180's line ending and what Excel expects. Written as
   * an escape, not a literal, so an editor can't silently strip it. */
  const csv = `\uFEFF${[header, ...body].join('\r\n')}`;

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition':
      'attachment; filename="pravasi-activities-report.csv"',
  });
  res.status(200).send(csv);
});

/* ------------------------------------------------------------------ */
/* GET /api/activities/assignees — the "assign to" picker              */
/* ------------------------------------------------------------------ */

export const listAssignees = handle(async (_req, res) => {
  res.status(200).json({ assignees: await repo.listSuperusers() });
});

/* ------------------------------------------------------------------ */
/* POST /api/activities                                                */
/* ------------------------------------------------------------------ */

export const createActivity = handle(async (req, res) => {
  const actor = superuserId(req);
  const input = CreateActivitySchema.parse(req.body);

  const createdByName = await repo.superuserDisplayName(actor);

  /* Assigning to nobody is a real state, so the name lookup only happens
   * when there is someone to look up. Defaulting the assignee to the
   * creator would silently claim work they may have been logging on
   * someone else's behalf. */
  const assignedTo = input.assigned_to ?? null;
  const assignedToName =
    assignedTo === null
      ? null
      : assignedTo === actor
        ? createdByName
        : await repo.superuserDisplayName(assignedTo);

  const created = await repo.createActivity({
    title: input.title,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    priority: input.priority,
    dueOn: input.due_on ?? null,
    assignedTo,
    assignedToName,
    createdBy: actor,
    createdByName,
  });

  res.status(201).json({ id: created.id });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/activities/:id                                           */
/* ------------------------------------------------------------------ */

export const updateActivity = handle(async (req, res) => {
  superuserId(req);
  const id = String(req.params.id);
  const input = UpdateActivitySchema.parse(req.body);

  /* Only keys the caller actually sent are forwarded — zod leaves absent
   * optionals undefined and the repository skips those, so one superuser
   * cannot blank a due date another just set. */
  const patch: Record<string, unknown> = {
    title: input.title,
    notes: input.notes,
    priority: input.priority,
    due_on: input.due_on,
    assigned_to: input.assigned_to,
    done: input.done,
  };

  /* Reassignment has to rewrite the denormalised name alongside the id, or
   * the row would show the previous owner's name against the new owner's
   * id — the drift Known debt 8 documents for the invite PIN. */
  if (input.assigned_to !== undefined) {
    patch.assigned_to_name =
      input.assigned_to === null
        ? null
        : await repo.superuserDisplayName(input.assigned_to);
  }

  const ok = await repo.updateActivity(id, patch);
  if (!ok) throw notFound('No such activity');

  const updated = await repo.findActivityById(id);
  if (!updated) throw notFound('No such activity');

  res.status(200).json({ activity: toActivity(updated) });
});

/* ------------------------------------------------------------------ */
/* DELETE /api/activities/:id                                          */
/* ------------------------------------------------------------------ */

export const deleteActivity = handle(async (req, res) => {
  superuserId(req);

  const ok = await repo.deleteActivity(String(req.params.id));
  if (!ok) throw notFound('No such activity');

  res.status(204).send();
});
