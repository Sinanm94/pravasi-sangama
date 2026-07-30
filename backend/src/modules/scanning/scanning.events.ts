import type {
  LiveScanEvent,
  ScanAlertType,
  ScanReason,
  VerifyScanResponse,
} from '@pravasi/shared';
import type { ScanActor } from '../../middleware/auth.js';
import { query } from '../../db/index.js';
import { broadcastScanAlert } from '../../socket.js';

/**
 * Builds the dashboard payload for a settled scan and broadcasts it.
 *
 * Called AFTER the transaction commits, fire-and-forget. Nothing here may
 * block the gate response — a scanner waiting on a dashboard update would
 * invert the whole priority order of this system.
 */

/* ------------------------------------------------------------------ */
/* Name cache                                                          */
/*                                                                     */
/* The scan path deliberately never joins agents or units — it is one   */
/* indexed point lookup. But the dashboard needs human names, so they   */
/* are resolved here, off the hot path, and cached. Agents and units    */
/* are effectively static during an event.                             */
/* ------------------------------------------------------------------ */

interface ActorNames {
  agentName: string | null;
  unitName: string | null;
  unitSector: string | null;
}

const nameCache = new Map<string, { value: ActorNames; expires: number }>();
const NAME_TTL_MS = 10 * 60_000;

async function resolveNames(
  agentId: string,
  unitId: string,
): Promise<ActorNames> {
  const key = `${agentId}:${unitId}`;
  const hit = nameCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const { rows } = await query<{
    agent_name: string | null;
    unit_name: string | null;
    unit_sector: string | null;
  }>(
    `SELECT a.name AS agent_name, u.name AS unit_name, u.sector AS unit_sector
       FROM agents a
       LEFT JOIN units u ON u.id = $2
      WHERE a.id = $1`,
    [agentId, unitId],
  );

  const value: ActorNames = {
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
function alertTypeFor(
  reason: ScanReason,
  source: 'LIVE' | 'SYNC',
): ScanAlertType {
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

export async function publishScan(params: {
  outcome: VerifyScanResponse;
  actor: ScanActor;
  gateLabel: string | null;
  source: 'LIVE' | 'SYNC';
  /** Client capture time for replays; falls back to the commit time. */
  capturedAt: Date | null;
}): Promise<void> {
  const { outcome, actor, source } = params;

  // A replayed response is a retry of an event already broadcast. Emitting
  // again would duplicate rows in the dashboard feed.
  if (outcome.replay) return;

  /* A gate has no person behind it — the shared PIN is the trade (spec §2).
   * The feed shows the gate name where an agent name would go, which is what
   * an operator actually needs to read at a glance. */
  const names =
    actor.kind === 'AGENT'
      ? await resolveNames(actor.agentId, actor.unitId)
      : { agentName: actor.gateName, unitName: null, unitSector: null };

  const actorKey = actor.kind === 'AGENT' ? actor.agentId : actor.gateId;

  const event: LiveScanEvent = {
    // scan_logs.id is not returned by the scan path; the dashboard only needs
    // a stable React key, and this is unique per emitted event.
    id: `${actorKey}:${params.capturedAt?.getTime() ?? Date.now()}:${
      outcome.guestIndex ?? 'x'
    }`,
    scannedAt: (params.capturedAt ?? new Date()).toISOString(),
    result:
      outcome.reason === 'ALREADY_SCANNED'
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
    gateLabel:
      params.gateLabel ?? (actor.kind === 'GATE' ? actor.gateName : null),
    ticketNumber: outcome.ticket?.ticketNumber ?? null,
    ticketType: outcome.ticket?.ticketType ?? null,
    alertType: alertTypeFor(outcome.reason, source),
    source,
  };

  broadcastScanAlert(event);
}

/** Fire-and-forget wrapper. A failed broadcast must never fail a scan. */
export function publishScanSafely(
  params: Parameters<typeof publishScan>[0],
): void {
  void publishScan(params).catch((err) => {
    console.error('[scan] broadcast failed', err);
  });
}
