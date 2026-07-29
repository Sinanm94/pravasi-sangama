import { query } from '../../db/index.js';
/**
 * Every query here runs on a 5s dashboard poll, so each one is either an
 * index-only count or bounded by LIMIT. Nothing joins the scan hot path.
 *
 * `pg` returns COUNT() as a string (bigint safety), hence the `Number()`
 * coercion in the service rather than trusting the driver.
 */
/* ------------------------------------------------------------------ */
export async function countActiveTickets() {
    const { rows } = await query(`SELECT COUNT(*)::TEXT AS count FROM tickets WHERE status = 'ACTIVE'`);
    return Number(rows[0]?.count ?? 0);
}
/**
 * Guest codes only — the LOCATION code is not an admission credential and
 * must never inflate an expected headcount (§4.3).
 *
 * Scoped to ACTIVE tickets: a revoked ticket's codes still exist as rows, but
 * nobody is expected to walk through the gate on them.
 */
export async function countExpectedGuests() {
    const { rows } = await query(`SELECT COUNT(*)::TEXT AS count
       FROM qr_codes q
       JOIN tickets t ON t.id = q.ticket_id
      WHERE q.code_kind = 'GUEST'
        AND t.status = 'ACTIVE'`);
    return Number(rows[0]?.count ?? 0);
}
/**
 * "Today" in the EVENT's timezone, not the server's. A container running UTC
 * would roll the counter over at 3am Riyadh time, mid-event.
 */
export async function countAdmittedToday(timezone) {
    const { rows } = await query(`SELECT COUNT(*)::TEXT AS count
       FROM scan_logs
      WHERE result = 'ADMITTED'
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1`, [timezone]);
    return Number(rows[0]?.count ?? 0);
}
/** A gate is "active" if it has recorded any scan inside the window. */
export async function countActiveGates(withinMinutes) {
    const { rows } = await query(`SELECT COUNT(DISTINCT unit_id)::TEXT AS count
       FROM scan_logs
      WHERE created_at >= NOW() - ($1 || ' minutes')::INTERVAL
        AND unit_id IS NOT NULL`, [String(withinMinutes)]);
    return Number(rows[0]?.count ?? 0);
}
export async function ticketTypeBreakdown() {
    const { rows } = await query(`SELECT ticket_type,
            COUNT(*)::TEXT              AS ticket_count,
            SUM(counted_persons)::TEXT  AS seat_count
       FROM tickets
      WHERE status = 'ACTIVE'
      GROUP BY ticket_type
      ORDER BY COUNT(*) DESC`);
    return rows;
}
export async function divisionPerformance() {
    const { rows } = await query(`SELECT d.id                              AS division_id,
            d.name                            AS division_name,
            d.code                            AS division_code,
            COUNT(t.id)::TEXT                 AS tickets_sold,
            COALESCE(SUM(t.counted_persons), 0)::TEXT AS guests_expected
       FROM divisions d
       LEFT JOIN tickets t
              ON t.division_id = d.id
             AND t.status = 'ACTIVE'
      WHERE d.is_active
      GROUP BY d.id, d.name, d.code
      ORDER BY COUNT(t.id) DESC, d.name ASC`);
    return rows;
}
/** Backed by idx_scan_logs_created — an index scan, never a sort. */
export async function recentScans(limit) {
    const { rows } = await query(`SELECT s.id::TEXT AS id,
            s.created_at,
            s.result,
            s.gate_label,
            a.name          AS agent_name,
            u.name          AS unit_name,
            u.sector        AS unit_sector,
            t.ticket_number,
            t.ticket_type
       FROM scan_logs s
       LEFT JOIN agents  a ON a.id = s.scanned_by
       LEFT JOIN units   u ON u.id = s.unit_id
       LEFT JOIN tickets t ON t.id = s.ticket_id
      ORDER BY s.created_at DESC
      LIMIT $1`, [limit]);
    return rows;
}
//# sourceMappingURL=analytics.repository.js.map