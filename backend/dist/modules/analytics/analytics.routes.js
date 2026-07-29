import { Router } from 'express';
import { requireSuperuser } from '../../middleware/auth.js';
import * as controller from './analytics.controller.js';
export const analyticsRoutes = Router();
// No rate limit beyond the global ceiling: a dashboard open on several
// screens at 5s intervals is expected, not abuse.
analyticsRoutes.get('/dashboard', requireSuperuser, controller.dashboard);
//# sourceMappingURL=analytics.routes.js.map