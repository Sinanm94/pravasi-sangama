import { Router } from 'express';
import { requireSuperuser } from '../../middleware/auth.js';
import * as controller from './clients.controller.js';

/**
 * Premium client tracking (§ migration 015). Superuser-only, guarded at the
 * router level so a new endpoint added below is protected by default rather
 * than by remembering — same pattern as adminRoutes.
 *
 * Records are shared across all three superuser accounts by design; see the
 * repository header. Attribution lives on the rows, not in a scope filter.
 */
export const clientRoutes: Router = Router();

clientRoutes.use(requireSuperuser);

/* Before /:id, or "filter-options" is parsed as a client id. */
clientRoutes.get('/filter-options', controller.listClientFilterOptions);
clientRoutes.get('/analytics', controller.clientAnalytics);
clientRoutes.get('/export', controller.exportClients);

clientRoutes.get('/', controller.listClients);
clientRoutes.post('/', controller.createClient);

clientRoutes.get('/:id', controller.getClient);
clientRoutes.patch('/:id', controller.updateClient);
clientRoutes.delete('/:id', controller.deleteClient);

/* The timeline — what we asked, what came back. */
clientRoutes.post('/:id/interactions', controller.addInteraction);
