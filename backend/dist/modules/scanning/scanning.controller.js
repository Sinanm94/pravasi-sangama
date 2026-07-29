import { BulkSyncSchema, VerifyScanSchema } from '@pravasi/shared';
import { agentScope } from '../../middleware/auth.js';
import * as service from './scanning.service.js';
const handle = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
};
/* ------------------------------------------------------------------ */
/* POST /api/scan/verify                                               */
/* ------------------------------------------------------------------ */
export const verifyScan = handle(async (req, res) => {
    const scope = agentScope(req);
    const input = VerifyScanSchema.parse(req.body);
    const result = await service.verifyScan(input, scope, { ip: req.ip ?? null });
    /**
     * 200 for every verdict, including DUPLICATE and INVALID.
     *
     * A rejected ticket is a valid, expected answer — not a client error. This
     * matters most offline: the queue's retry logic treats any non-2xx as
     * "network problem, try again later", so returning 409 for a duplicate
     * would make scanners retry a settled verdict forever. Non-2xx is reserved
     * for auth failures and malformed input.
     */
    res.status(200).json(result);
});
/* ------------------------------------------------------------------ */
/* POST /api/scan/bulk-sync                                            */
/* ------------------------------------------------------------------ */
export const bulkSync = handle(async (req, res) => {
    const scope = agentScope(req);
    const input = BulkSyncSchema.parse(req.body);
    const result = await service.bulkSync(input, scope, { ip: req.ip ?? null });
    /**
     * 200 even when individual items failed. The batch itself succeeded; the
     * per-item `error` field tells the client which rows to keep queued.
     * Failing the whole request would strand settled admissions in the client's
     * queue and get them re-sent forever.
     */
    res.status(200).json(result);
});
//# sourceMappingURL=scanning.controller.js.map