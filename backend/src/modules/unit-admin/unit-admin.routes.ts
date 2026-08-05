import { Router } from 'express';
import { requireUnitAdmin } from '../../middleware/auth.js';
import * as controller from './unit-admin.controller.js';

/**
 * A unit admin's own approvals queue. Guarded at the router level, same
 * pattern as adminRoutes — a new endpoint added here is protected by
 * default, not by remembering to add the check.
 */
export const unitAdminRoutes: Router = Router();

unitAdminRoutes.use(requireUnitAdmin);

unitAdminRoutes.get('/agents', controller.listAgents);
unitAdminRoutes.post('/agents/:id/decision', controller.decideAgent);
unitAdminRoutes.get('/tickets', controller.listTickets);
unitAdminRoutes.get('/invite-pin', controller.listInvitePins);
