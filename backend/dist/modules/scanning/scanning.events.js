import { query } from '../../db/index.js';
import { broadcastScanAlert } from '../../socket.js';
const nameCache = new Map();
const NAME_TTL_MS = 10 * 60_000;
async function resolveNames(agentId, unitId) {
    const key = `${agentId}:${unitId}`;
    const hit = nameCache.get(key);
    if (hit && hit.expires > Date.now())
        return hit.value;
    const { rows } = await query(`SELECT a.name AS agent_name, u.name AS unit_name, u.sector AS unit_sector
       FROM agents a
       LEFT JOIN units u ON u.id = $2
      WHERE a.id = $1`, [agentId, unitId]);
    const value = {
        agentName: rows[0]?.agent_name ?? null,
        unitName: rows[0]?.unit_name ?? null,
        unitSector: rows[0]?.unit_sector ?? null,
    };
    nameCache.set(key, { value, expires: Date.now() + NAME_TTL_MS });
    return value;
}
/* ------------------------------------------------------------------ */
/**
 * A duplicate discovered while draining an offline queue is not the same
 * event as one caught at the door. The live case stopped someone; the sync
 * case means two people are already inside on one code (§10.4). The dashboard
 * must be able to tell them apart, so the source decides the alert type.
 */
function alertTypeFor(reason, source) {
    switch (reason) {
        case 'ADMITTED':
            return 'ADMITTED';
        case 'LOCATION_INFO':
            return 'LOCATION_INFO';
        case 'ALREADY_SCANNED':
            return source === 'SYNC' ? 'POST_SYNC_DUPLICATE' : 'DUPLICATE';
        default:
            return 'INVALID';
    }
}
export async function publishScan(params) {
    const { outcome, scope, source } = params;
    // A replayed response is a retry of an event already broadcast. Emitting
    // again would duplicate rows in the dashboard feed.
    if (outcome.replay)
        return;
    const names = await resolveNames(scope.agentId, scope.unitId);
    const event = {
        // scan_logs.id is not returned by the scan path; the dashboard only needs
        // a stable React key, and this is unique per emitted event.
        id: `${scope.agentId}:${params.capturedAt?.getTime() ?? Date.now()}:${outcome.guestIndex ?? 'x'}`,
        scannedAt: (params.capturedAt ?? new Date()).toISOString(),
        result: outcome.reason === 'ALREADY_SCANNED'
            ? 'DUPLICATE'
            : outcome.reason === 'CODE_REVOKED' || outcome.reason === 'TICKET_REVOKED'
                ? 'REVOKED'
                : outcome.reason === 'LOCATION_INFO'
                    ? 'LOCATION_INFO'
                    : outcome.reason === 'ADMITTED'
                        ? 'ADMITTED'
                        : 'UNKNOWN_CODE',
        agentName: names.agentName,
        unitName: names.unitName,
        unitSector: names.unitSector,
        gateLabel: params.gateLabel,
        ticketNumber: outcome.ticket?.ticketNumber ?? null,
        ticketType: outcome.ticket?.ticketType ?? null,
        alertType: alertTypeFor(outcome.reason, source),
        source,
    };
    broadcastScanAlert(event);
}
/** Fire-and-forget wrapper. A failed broadcast must never fail a scan. */
export function publishScanSafely(params) {
    void publishScan(params).catch((err) => {
        console.error('[scan] broadcast failed', err);
    });
}
//# sourceMappingURL=scanning.events.js.map