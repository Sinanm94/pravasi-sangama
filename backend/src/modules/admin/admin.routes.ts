import { Router } from 'express';
import { requireSuperuser } from '../../middleware/auth.js';
import * as controller from './admin.controller.js';

/**
 * Superuser-only. Everything here creates or revokes the ability to issue
 * tickets and admit people, so the guard is applied to the whole router
 * rather than per-route — a new endpoint added below is protected by default,
 * not by remembering.
 */
export const adminRoutes: Router = Router();

adminRoutes.use(requireSuperuser);

/* --- Agent approval queue (spec §3) ------------------------------ */
adminRoutes.get('/agents', controller.listAgents);
adminRoutes.post('/agents/:id/decision', controller.decideAgent);

/* --- Agent directory + issuance totals ---------------------------- */
adminRoutes.get('/agent-directory', controller.listAgentDirectory);

/* --- Master ticket ledger ---------------------------------------- */
adminRoutes.get('/tickets', controller.listTicketLedger);
adminRoutes.get('/tickets/export', controller.exportTicketLedger);
adminRoutes.get('/filter-options', controller.listFilterOptions);

/* --- Gate channels (spec §2, Option A) --------------------------- */
adminRoutes.get('/gates', controller.listGates);
adminRoutes.post('/gates', controller.createGate);
adminRoutes.post('/gates/:id/rotate-pin', controller.rotateGatePin);
adminRoutes.post('/gates/:id/active', controller.setGateActive);
