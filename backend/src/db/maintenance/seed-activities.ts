import { closePool, withTransaction } from '../index.js';

/**
 * Seeds the organiser's real activity list from "List of activities.pdf"
 * (supplied 2026-08-17) into `activities` (migration 018).
 *
 *   npm run db:seed-activities -w @pravasi/backend             # dry run
 *   npm run db:seed-activities -w @pravasi/backend -- --yes    # apply
 *
 * ── Why a script rather than typing 41 tasks into the UI ──────────────
 *
 * It is idempotent on `title`: re-running updates the notes of a row that
 * already exists instead of creating a second copy. That matters because
 * this list will be re-imported as the source document is revised, and
 * hand-entry would silently duplicate every unchanged line.
 *
 * ⚠ ON FIDELITY TO THE SOURCE, because a future reader will compare them:
 *
 * The PDF is a SPREADSHEET flattened to text. Its "Description" and
 * "Status" columns (pages 3-5) lost their row alignment in that conversion:
 * there are ~40 description lines against 41 numbered activities, with
 * blank spacer rows in the original that did not survive. Attaching them
 * positionally would confidently label the wrong task - putting the food
 * menu against Sports, say - which is worse than no note at all, because a
 * wrong note is acted on and a missing one is asked about.
 *
 * So notes are attached ONLY where the pairing is unambiguous: either the
 * description names its own subject ("Kushka, Mutton Kurma..." can only be
 * Food; "Tug of war, Push Ups" can only be Sports) or the source put them
 * on one visible line. Everything else carries no note, and the volunteer
 * names on pages 3-4 that could not be tied to a specific activity are
 * listed once under a single task at the end so they are not lost.
 *
 * The SL# numbers are the source's own and skip 9, 23, 25, 26 and 33; the
 * gaps are reproduced rather than renumbered, so a person holding the paper
 * can still find a row by its number.
 */

interface SeedActivity {
  sl: number;
  title: string;
  notes?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
  /** Source's own Status column, where it was legible. */
  done?: boolean;
}

const ACTIVITIES: readonly SeedActivity[] = [
  {
    sl: 1,
    title: 'Food',
    notes:
      'Kushka, Mutton Kurma, Chicken chilli, dal, Seer Kurma, Salad, Kinza.\nStatus: already met chef. Hana ordered.',
    priority: 'HIGH',
  },
  {
    sl: 2,
    title: 'Sports',
    notes:
      'Men Sports: 1. Tug of war  2. Push Ups  3. Volleyball  4. Super Goal.\nLead by Ashraf Killur.\nStatus: men sports decided, award list given to the Zone. Ladies sports decided and prize list given.\nPending: kids sports to be decided — awaiting sports team response and Ismail Kannangar.',
    priority: 'HIGH',
  },
  {
    sl: 3,
    title: 'Fruit',
    notes: 'Apple, Orange, Banana, water melon.',
  },
  {
    sl: 4,
    title: 'LCD & Sounds',
    notes: 'Men - 2.5 X 5.  Women - 2X3.',
  },
  { sl: 5, title: 'Marketing', notes: 'Lead by Ashraf Killur.' },
  { sl: 6, title: 'Volunteers', notes: 'Lead by Ashraf KMS, take team.' },
  {
    sl: 7,
    title: 'Media',
    notes: 'Salam Enmoor will take care. Habeeb Th, Hussain Saqafi.',
  },
  {
    sl: 8,
    title: 'Plastic items',
    notes: 'Plate, cup, spoon, supra, garbage items.',
  },
  {
    sl: 10,
    title: 'Live food',
    notes:
      'Charmuri and tea; tea or jilebi or nuggets or samosa.\nCharmuri and tea by Shifa team, charmuri 8 to 10. Samosa or nuggets by Badiya, samosa 1 to 3.\nCheck samosa and nuggets.',
  },
  {
    sl: 11,
    title: 'Store keeper',
    notes: 'Jamal Manipura and Altaf Soorinje.',
  },
  {
    sl: 12,
    title: 'Security',
    notes: 'Saudi security - Basheer Talappady.',
    priority: 'HIGH',
  },
  {
    sl: 13,
    title: 'Registration',
    notes: 'Khader Sadath, Ansar Kaikamba, Huzaifa Peraje, Asif PKM.',
    priority: 'HIGH',
  },
  {
    sl: 14,
    title: 'Stage set up',
    notes: 'Zahir Ullal, Shihab Saqafi, Salim Karaje and Ilyas Pandel.',
  },
  {
    sl: 15,
    title: 'Prize distribution',
    notes: 'Ismail Kalminje, Unais Patrakodi, Muhsin Haleyangadi.',
  },
  {
    sl: 16,
    title: 'Electricity',
    notes: 'Abdullah KP and Irshad KP.',
  },
  {
    sl: 17,
    title: 'Receptionist (Gate)',
    notes:
      'Hameed Mata (captain), Haris Parlya, Aziz Mudigere, Aziz Alekkadi.',
    priority: 'HIGH',
  },
  {
    sl: 18,
    title: 'Guest invitor (VIP / VVIP)',
    notes:
      'Muktar Haleyangadi, Irfan Kanyarakodi, Siddik Balehonnu (captain).\nNazer Haji and Kallarbe will host guest. Status: pending.',
    priority: 'HIGH',
  },
  {
    sl: 19,
    title: 'Kids cultural programme',
    notes:
      'Dawud Sadi, Haris Saqafi, Jalla Sadi and Hussain Saqafi.',
  },
  {
    sl: 20,
    title: 'Majlis',
    notes: 'Mustafa Sadi, Hamza Ustad, and Rasheed Madani.\n6 to 8 majlis.',
  },
  {
    sl: 21,
    title: 'Welcome Drink',
    notes: 'Alamrai juice and KD juice.',
  },
  {
    sl: 22,
    title: 'Cleaning staff',
    notes:
      'To bring 3 men and 2 women cleaning staff (outsiders) - Nizam, Haris Parlya.',
  },
  {
    sl: 24,
    title: 'Ice cream',
    notes: 'Rasheed Punjalkatte (optional).',
    priority: 'LOW',
  },
  {
    sl: 27,
    title: 'MC',
    notes: 'Basheer Talappady and Salam Enmoor.',
  },
  {
    sl: 28,
    title: 'Ticket follow up',
    notes:
      'Farooq Mangalore and Sameer Jeppu.\nAlso request for a membership option.',
    priority: 'HIGH',
  },
  {
    sl: 29,
    title: 'First aid kit and a nurse',
    notes: 'Bashir Talappady.',
    priority: 'HIGH',
  },
  { sl: 30, title: 'Cartoon', notes: 'Salam Haleyangadi.' },
  { sl: 31, title: 'Gahva', notes: 'Shamsu Uppinnangady.' },
  {
    sl: 32,
    title: 'Daff',
    notes: 'Malaz and Shifa daff team; Rameez Kulai will handle.',
  },
  {
    sl: 34,
    title: 'Schedule',
    notes:
      '6 to 8 majlis.\n8 to 11 cultural programs / games — registration closes at 10.\n11 to 11.30 daff khawali.\n12 to 1 stage.\nAlso noted: 8.30 to 11.',
    priority: 'HIGH',
  },
  { sl: 35, title: 'Gloves, Mask', notes: 'Basheer Talappady.' },
  { sl: 36, title: 'Invitation', notes: 'Salam Padpu.' },
  {
    sl: 37,
    title: 'Arrange food family / fruit cutting',
    notes: 'Salam, Shihab, Ismail, Yusuf.',
  },
  {
    sl: 38,
    title: 'Ishara umrah service',
    notes: 'Rasheed Madani.',
  },
  {
    sl: 39,
    title: 'Car parking',
    notes:
      'Abdulrahman Koppa, Farook Kadike, Farooq Panemangalore (captain), Venoor.\nAbdulrahman Koppa will be vice.',
    priority: 'HIGH',
  },
  {
    sl: 40,
    title: 'Ground staff',
    notes: 'Yusuf Kalanjibail, Mustafa Sadi, Basheer Talappady.',
  },
  {
    sl: 41,
    title: 'Kids sports',
    notes:
      'Habeeb and Ilyas Lateefi.\nStatus: to be decided — awaiting sports team response and Ismail Kannangar.',
  },
  { sl: 42, title: 'Dates', notes: 'Ahmed Bava.' },
  {
    sl: 43,
    title: 'Bus timing',
    notes: '8 and 10 - two shifts.  Return: 1 and fajr prayer.',
  },
  { sl: 44, title: 'Return', notes: 'Razak Barya.' },
  {
    sl: 45,
    title: 'Time schedule poster to publish',
    notes: 'Make cutout.',
  },
  {
    sl: 46,
    title: 'Raffle draw box',
    notes: 'Salam Hale.',
  },

  /* ── Session/segment planning, from page 2 ─────────────────────────
   * The source lists these under "Morning" / "After noon" headings with no
   * SL#, as a checklist of what each session needs. Kept as one task rather
   * than split into seven, because the source gives them no owners, no
   * dates and no detail - splitting would invent structure it does not
   * have. SL 100 is OURS, not the source's, to keep it out of the way of
   * the real numbering. */
  {
    sl: 100,
    title: 'Afternoon session setup',
    notes:
      'From the Morning / Afternoon section of the source list:\n' +
      '- Food\n- Rope\n- Ladies sports material\n- Prize\n' +
      '- Complementary prize\n- Registration\n- Podium',
  },

  /* ── Unassigned names from pages 3-4 ──────────────────────────────
   * These appeared in the Description column with no legible activity
   * against them once the spreadsheet was flattened. Recorded verbatim so
   * the information is not lost, and flagged so someone who has the
   * original can place them properly. */
  {
    sl: 101,
    title: 'Assign remaining volunteers to activities',
    notes:
      'These names appear in the source PDF without a clear activity ' +
      'against them (the spreadsheet columns lost their alignment when ' +
      'exported). Place each one against the right task:\n\n' +
      'Majed bhai, Yusuf bhai, Rasheed Kakkinje, Ashraf KMS, ' +
      'Ismail Kannaangar, Farooq Panemangalore, Dawud Sadi, Salim Kannur, ' +
      'Haris Saqafi.\n\n' +
      'Also unplaced: "will be decided", "25 extra", ' +
      '"Salam hale, 6 dozen".',
    priority: 'HIGH',
  },
] as const;

/* ------------------------------------------------------------------ */

async function apply(): Promise<{ inserted: number; updated: number }> {
  return withTransaction(async (client) => {
    let inserted = 0;
    let updated = 0;

    for (const a of ACTIVITIES) {
      /* Idempotent on title: this list gets re-imported as the source
       * document is revised, and matching on title means an unchanged row
       * is updated in place rather than duplicated. Deliberately does NOT
       * touch done_at - if someone has already ticked a task off, a
       * re-import must not un-tick it. */
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM activities WHERE lower(trim(title)) = lower(trim($1))`,
        [a.title],
      );

      if (rows.length > 0) {
        await client.query(
          `UPDATE activities
              SET notes = $2, priority = $3::activity_priority
            WHERE id = $1`,
          [rows[0]!.id, a.notes ?? null, a.priority ?? 'NORMAL'],
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO activities (title, notes, priority, created_by_name)
                VALUES ($1, $2, $3::activity_priority, $4)`,
          [
            a.title,
            a.notes ?? null,
            a.priority ?? 'NORMAL',
            // No superuser is acting here, so no id is invented; the name
            // records where the row came from.
            'Imported from activity list',
          ],
        );
        inserted += 1;
      }
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'ACTIVITIES_IMPORTED', $1)`,
      [JSON.stringify({ inserted, updated, total: ACTIVITIES.length })],
    );

    return { inserted, updated };
  });
}

const confirmed = process.argv.slice(2).includes('--yes');
const LINE = '─'.repeat(66);

async function main(): Promise<void> {
  if (!confirmed) {
    console.log(`\n${LINE}`);
    console.log('  DRY RUN — nothing has been changed');
    console.log(LINE);
    console.log(`\n  Would import ${ACTIVITIES.length} activities:\n`);
    for (const a of ACTIVITIES) {
      const flag = a.priority === 'HIGH' ? ' [HIGH]' : '';
      const note = a.notes ? '' : '  (no notes — none in source)';
      console.log(
        `    ${String(a.sl).padStart(3)}  ${a.title}${flag}${note}`,
      );
    }
    console.log(
      `\n  Matching is on TITLE and is idempotent: an existing task is` +
        `\n  updated in place, never duplicated, and a task already ticked` +
        `\n  off stays ticked off.`,
    );
    console.log(`\n  To apply:`);
    console.log(
      `    npm run db:seed-activities -w @pravasi/backend -- --yes`,
    );
    console.log(`\n${LINE}\n`);
    return;
  }

  const r = await apply();
  console.log(`\n${LINE}`);
  console.log('  ACTIVITIES IMPORTED');
  console.log(LINE);
  console.log(`\n  inserted .... ${r.inserted}`);
  console.log(`  updated ..... ${r.updated}`);
  console.log(`\n  Open /admin/activities to assign owners and due dates.`);
  console.log(`\n${LINE}\n`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `[seed-activities] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
