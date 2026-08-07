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

/* --- Agent approval queue (spec §3) ------------------------------ *
 *
 * NO SUPERUSER UI REACHES THESE ANY MORE. Agent approval is delegated to
 * the Unit Admin tier (§3.3), and the superuser's /admin/approvals page and
 * its nav tab were removed as obsolete.
 *
 * The endpoints stay on purpose. §2 makes the superuser the ultimate
 * authority over every unit, and `decideAgent` called from here passes no
 * `restrictToAdminId` — so this is the only unrestricted approval path in
 * the system, and the only way to clear a queue when a unit admin's account
 * is lost, or when an agent is posted to a unit whose admin does not exist
 * yet. Deleting them would remove that override entirely, which is a
 * different and larger decision than removing a tab.
 *
 * Break-glass, reachable by an authenticated superuser over HTTP:
 *   GET  /api/admin/agents?status=PENDING
 *   POST /api/admin/agents/:id/decision  { "decision": "APPROVED" }
 */
adminRoutes.get('/agents', controller.listAgents);
adminRoutes.post('/agents/:id/decision', controller.decideAgent);

/* --- Agent directory + issuance totals ---------------------------- */
adminRoutes.get('/agent-directory', controller.listAgentDirectory);

/* --- Agent account control (§3.4) --------------------------------- *
 * The superuser fallback. With the Unit Admin tier disabled, the reset
 * below is the only password recovery an agent has, and `active` is the
 * only way to switch off an account that auto-approval let in. */
adminRoutes.post('/agents/:id/reset-password', controller.resetAgentPassword);
adminRoutes.post('/agents/:id/active', controller.setAgentActive);

/* --- Master ticket ledger ---------------------------------------- */
adminRoutes.get('/tickets', controller.listTicketLedger);
adminRoutes.get('/tickets/export', controller.exportTicketLedger);
adminRoutes.get('/filter-options', controller.listFilterOptions);

/* --- Gate channels (spec §2, Option A) --------------------------- */
adminRoutes.get('/gates', controller.listGates);
adminRoutes.post('/gates', controller.createGate);
adminRoutes.post('/gates/:id/rotate-pin', controller.rotateGatePin);
adminRoutes.post('/gates/:id/active', controller.setGateActive);
