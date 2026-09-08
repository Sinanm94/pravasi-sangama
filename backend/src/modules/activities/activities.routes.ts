import { Router } from 'express';
import { requireSuperuser } from '../../middleware/auth.js';
import * as controller from './activities.controller.js';

/**
 * The organiser's own task list (migration 018). Superuser-only, guarded at
 * the router level so an endpoint added below is protected by default
 * rather than by remembering — same pattern as adminRoutes and clientRoutes.
 *
 * Shared across all three superuser accounts by design; see the repository
 * header. Attribution lives on the rows, not in a scope filter.
 */
export const activityRoutes: Router = Router();

activityRoutes.use(requireSuperuser);

/* Before /:id, or "assignees" / "export" is parsed as an activity id. */
activityRoutes.get('/assignees', controller.listAssignees);
activityRoutes.get('/export', controller.exportActivities);

activityRoutes.get('/', controller.listActivities);
activityRoutes.post('/', controller.createActivity);

activityRoutes.patch('/:id', controller.updateActivity);
activityRoutes.delete('/:id', controller.deleteActivity);
