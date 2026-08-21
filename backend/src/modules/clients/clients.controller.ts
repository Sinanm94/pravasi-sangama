import type { Request, RequestHandler, Response } from 'express';
import {
  ClientQuerySchema,
  CreateClientInteractionSchema,
  CreateClientSchema,
  UpdateClientSchema,
  type ClientDetailResponse,
  type ClientInteraction,
  type ClientListResponse,
  type ClientRecord,
} from '@pravasi/shared';
import { notFound, unauthorized } from '../../lib/errors.js';
import * as repo from './clients.repository.js';

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

const toClient = (r: repo.ClientRow): ClientRecord => ({
  id: r.id,
  name: r.name,
  mobile: r.mobile,
  email: r.email,
  organisation: r.organisation,
  intendedTier: r.intended_tier,
  status: r.status,
  followUpOn: r.follow_up_on,
  ticketId: r.ticket_id,
  ticketNumber: r.ticket_number,
  unitId: r.unit_id,
  unitCode: r.unit_code,
  unitName: r.unit_name,
  sector: r.sector,
  referredBy: r.referred_by,
  isMember: r.is_member,
  source: r.source,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  interactionCount: r.interaction_count,
  lastInteractionAt: r.last_interaction_at?.toISOString() ?? null,
});

const toInteraction = (r: repo.ClientInteractionRow): ClientInteraction => ({
  id: r.id,
  kind: r.kind,
  body: r.body,
  authorName: r.author_name,
  occurredAt: r.occurred_at.toISOString(),
});

/* ------------------------------------------------------------------ */
/* GET /api/clients                                                    */
/* ------------------------------------------------------------------ */

export const listClients = handle(async (req, res) => {
  const q = ClientQuerySchema.parse(req.query);
  const filters = {
    status: q.status,
    search: q.search,
    unitId: q.unit_id,
    sector: q.sector,
    referredBy: q.referred_by,
    /* Absent means "either"; the wire carries strings because it is a query
     * string, so the tri-state is preserved rather than collapsed. */
    isMember: q.is_member === undefined ? undefined : q.is_member === 'true',
    source: q.source,
  };

  const [rows, totals] = await Promise.all([
    repo.listClients(filters, q.limit),
    repo.summariseClients(filters),
  ]);

  const body: ClientListResponse = {
    clients: rows.map(toClient),
    totals,
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* GET /api/clients/filter-options                                     */
/* ------------------------------------------------------------------ */

/**
 * Sectors and contact owners that actually appear in the data.
 *
 * Derived rather than hardcoded, same as the ticket ledger's sector list:
 * the imported roster carries groupings ('Sponsors') that are not event
 * sectors, and the owners are volunteer nicknames that exist nowhere else
 * in the system.
 */
export const listClientFilterOptions = handle(async (_req, res) => {
  const [sectors, owners] = await Promise.all([
    repo.listClientSectors(),
    repo.listClientOwners(),
  ]);

  res.status(200).json({ sectors, owners });
});

/* ------------------------------------------------------------------ */
/* GET /api/clients/:id — record plus full timeline                    */
/* ------------------------------------------------------------------ */

export const getClient = handle(async (req, res) => {
  const id = String(req.params.id);

  const client = await repo.findClientById(id);
  if (!client) throw notFound('No such client');

  const body: ClientDetailResponse = {
    client: toClient(client),
    interactions: (await repo.listInteractions(id)).map(toInteraction),
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* POST /api/clients                                                   */
/* ------------------------------------------------------------------ */

export const createClient = handle(async (req, res) => {
  const actor = superuserId(req);
  const input = CreateClientSchema.parse(req.body);

  /* Empty strings from an untouched form field are stored as NULL rather
   * than '' — "no mobile recorded" and "a mobile that is the empty string"
   * must not be two different states in the data. */
  const blankToNull = (v: string | undefined) =>
    v && v.trim() !== '' ? v.trim() : null;

  const created = await repo.createClient({
    name: input.name,
    mobile: blankToNull(input.mobile),
    email: blankToNull(input.email),
    organisation: blankToNull(input.organisation),
    intendedTier: input.intended_tier ?? null,
    status: input.status,
    followUpOn: input.follow_up_on ?? null,
    unitId: input.unit_id ?? null,
    referredBy: blankToNull(input.referred_by),
    isMember: input.is_member ?? null,
    sector: input.sector?.trim() ? input.sector.trim().toUpperCase() : null,
    source: input.source?.trim() || 'MANUAL',
    createdBy: actor,
  });

  res.status(201).json({ id: created.id });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/clients/:id                                              */
/* ------------------------------------------------------------------ */

export const updateClient = handle(async (req, res) => {
  superuserId(req);
  const id = String(req.params.id);
  const input = UpdateClientSchema.parse(req.body);

  /* Only keys the caller actually sent are forwarded. Zod leaves absent
   * optionals as `undefined`, which the repository skips — so a superuser
   * editing the status cannot silently blank a follow-up date another one
   * set a moment earlier. */
  const patch: Record<string, unknown> = {
    name: input.name,
    mobile: input.mobile,
    email: input.email,
    organisation: input.organisation,
    intended_tier: input.intended_tier,
    status: input.status,
    follow_up_on: input.follow_up_on,
    ticket_id: input.ticket_id,
    unit_id: input.unit_id,
    referred_by: input.referred_by,
    is_member: input.is_member,
    sector: input.sector,
  };

  const ok = await repo.updateClient(id, patch);
  if (!ok) throw notFound('No such client');

  const updated = await repo.findClientById(id);
  if (!updated) throw notFound('No such client');

  res.status(200).json({ client: toClient(updated) });
});

/* ------------------------------------------------------------------ */
/* DELETE /api/clients/:id                                             */
/* ------------------------------------------------------------------ */

export const deleteClient = handle(async (req, res) => {
  superuserId(req);

  const ok = await repo.deleteClient(String(req.params.id));
  if (!ok) throw notFound('No such client');

  res.status(204).send();
});

/* ------------------------------------------------------------------ */
/* POST /api/clients/:id/interactions — add a timeline entry           */
/* ------------------------------------------------------------------ */

export const addInteraction = handle(async (req, res) => {
  const actor = superuserId(req);
  const clientId = String(req.params.id);
  const input = CreateClientInteractionSchema.parse(req.body);

  // 404 before writing, so an entry cannot be orphaned against a bad id.
  const client = await repo.findClientById(clientId);
  if (!client) throw notFound('No such client');

  /* The author's NAME is captured here, at write time, not resolved at read
   * time from the id. This log is read months later to settle who agreed
   * what, and by then the account may be deactivated — a timeline that says
   * "someone" is worth much less than one that says "ADMIN02". */
  const authorName = await repo.superuserDisplayName(actor);

  await repo.addInteraction({
    clientId,
    kind: input.kind,
    body: input.body,
    authorId: actor,
    authorName,
    occurredAt: input.occurred_at ?? null,
  });

  // Return the fresh timeline so the client does not need a second round
  // trip to render what it just wrote.
  const [updated, interactions] = await Promise.all([
    repo.findClientById(clientId),
    repo.listInteractions(clientId),
  ]);

  const body: ClientDetailResponse = {
    client: toClient(updated!),
    interactions: interactions.map(toInteraction),
  };

  res.status(201).json(body);
});
