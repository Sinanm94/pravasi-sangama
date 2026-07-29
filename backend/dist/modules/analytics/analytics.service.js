import { env } from '../../config/env.js';
import * as repo from './analytics.repository.js';
/** A gate with no scan in this window is treated as offline (§10.5). */
const ACTIVE_GATE_WINDOW_MINUTES = 5;
const RECENT_SCAN_LIMIT = 10;
export async function dashboard() {
    const tz = env.EVENT_TIMEZONE;
    /* Seven independent reads, issued together. Each is short and indexed, so
     * the wall time is roughly the slowest one rather than their sum. Kept as
     * separate statements instead of one CTE so a slow query shows up by name
     * in pg_stat_statements. */
    const [totalTickets, totalGuestsExpected, totalScannedToday, activeGates, typeRows, divisionRows, scanRows,] = await Promise.all([
        repo.countActiveTickets(),
        repo.countExpectedGuests(),
        repo.countAdmittedToday(tz),
        repo.countActiveGates(ACTIVE_GATE_WINDOW_MINUTES),
        repo.ticketTypeBreakdown(),
        repo.divisionPerformance(),
        repo.recentScans(RECENT_SCAN_LIMIT),
    ]);
    return {
        generatedAt: new Date().toISOString(),
        timezone: tz,
        totals: {
            totalTickets,
            totalGuestsExpected,
            totalScannedToday,
            activeGates,
        },
        ticketTypeBreakdown: typeRows.map((row) => ({
            ticketType: row.ticket_type,
            ticketCount: Number(row.ticket_count),
            seatCount: Number(row.seat_count),
        })),
        divisionPerformance: divisionRows.map((row) => ({
            divisionId: row.division_id,
            divisionName: row.division_name,
            divisionCode: row.division_code,
            ticketsSold: Number(row.tickets_sold),
            guestsExpected: Number(row.guests_expected),
        })),
        recentScans: scanRows.map((row) => ({
            id: row.id,
            scannedAt: row.created_at.toISOString(),
            result: row.result,
            agentName: row.agent_name,
            unitName: row.unit_name,
            unitSector: row.unit_sector,
            gateLabel: row.gate_label,
            ticketNumber: row.ticket_number,
            ticketType: row.ticket_type,
        })),
    };
}
//# sourceMappingURL=analytics.service.js.map