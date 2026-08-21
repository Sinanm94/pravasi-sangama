import { closePool, withTransaction } from '../index.js';

/**
 * Imports last event's VIP / VVIP purchaser list into `clients`, so the
 * same people can be worked again this year on /admin/clients.
 *
 *   npm run db:import-clients -w @pravasi/backend            # dry run
 *   npm run db:import-clients -w @pravasi/backend -- --yes   # apply
 *
 * ── Names are TRANSLITERATED, and that is a real decision ─────────────
 *
 * The source is Kannada script. Names are stored in Latin transliteration
 * because this field is SEARCHED and TYPED: the superuser types "Shakir"
 * into a search box on a phone with an English keyboard, and a Kannada-only
 * name would be unreachable to anyone without that keyboard installed.
 *
 * The transliterations are best-effort and WILL contain errors — Kannada
 * vowel length and retroflex consonants do not map cleanly, and several of
 * these are already inconsistent in the source itself. Treat them as
 * searchable labels, not authoritative spellings; correct them in the UI as
 * people are contacted. That is why `source` is stamped: these rows are
 * identifiable as imported, not hand-entered.
 *
 * ── What each source column became ────────────────────────────────────
 *
 *   sector heading   -> notes (the unit FK is NOT set; see below)
 *   VIP / VVIP       -> intended_tier
 *   "KCF ಸದಸ್ಯರು"    -> is_member = true;  "Non KCF" -> false
 *   "c/o X", "- X"   -> referred_by (the volunteer who owns the contact)
 *   green tick       -> notes ("ticket confirmed last event")
 *
 * `unit_id` is deliberately left NULL. The source names SECTORS (Ghurnatha,
 * Shifa, Olaya...) and a sector is not a unit — each contains several. There
 * is no honest mapping from one to the other, and guessing a unit would put
 * a client under a specific unit head who never spoke to them.
 *
 * The sector goes into `clients.sector` (020) so it is FILTERABLE. It was
 * originally only written into the first timeline entry, which meant the
 * sector filter returned nothing for every imported row — the information
 * was present and unusable. Assigning a unit later overrides it, since the
 * read is COALESCE(units.sector, clients.sector).
 *
 * Everyone lands as PROSPECT: last year's purchase is history, not a
 * commitment for this year, and the whole point is to ask them again.
 */

const SOURCE = 'LAST_EVENT_2025';

interface SeedClient {
  name: string;
  tier: 'VIP' | 'VVIP';
  member: boolean;
  sector: string;
  referredBy?: string;
  /** Green tick in the source = bought last time. */
  confirmed?: boolean;
  note?: string;
}

const CLIENTS: readonly SeedClient[] = [
  /* ── Ghurnatha sector ─────────────────────────────────────────── */
  { name: 'Shakir Kabaka', tier: 'VIP', member: true, sector: 'Ghurnatha' },
  { name: 'Thwaha Saraleekatte', tier: 'VIP', member: true, sector: 'Ghurnatha' },
  { name: 'Sabir Uppala', tier: 'VIP', member: true, sector: 'Ghurnatha' },
  { name: 'Nazeer Kakkinje', tier: 'VIP', member: true, sector: 'Ghurnatha' },
  { name: 'Asif Kapu', tier: 'VIP', member: true, sector: 'Ghurnatha' },
  { name: 'Ziaur', tier: 'VIP', member: false, sector: 'Ghurnatha', referredBy: 'Sabir' },
  { name: 'Majeed', tier: 'VIP', member: false, sector: 'Ghurnatha', referredBy: 'Sabir' },
  { name: 'Nasir', tier: 'VIP', member: false, sector: 'Ghurnatha', referredBy: 'Kakkinje' },
  { name: 'Nawaz Chikkamagaluru', tier: 'VVIP', member: true, sector: 'Ghurnatha' },

  /* ── Shifa sector — Non KCF VIP ───────────────────────────────── */
  { name: 'Ilyas Moodutota', tier: 'VIP', member: false, sector: 'Shifa', referredBy: 'Shihab Hly' },
  { name: 'Jamal Padutota', tier: 'VIP', member: false, sector: 'Shifa', referredBy: 'Shihab Hly' },
  { name: 'Parvez Haleyangadi', tier: 'VIP', member: false, sector: 'Shifa', referredBy: 'Salam Hly' },
  { name: 'Muhyuddin Shivamogga', tier: 'VIP', member: false, sector: 'Shifa', referredBy: 'Salam Hly' },
  { name: 'Yasir Krishnapura', tier: 'VIP', member: false, sector: 'Shifa', referredBy: 'Shihab Hly', note: 'Source ref: 088' },
  { name: 'Abdul Azeez Bajpe', tier: 'VIP', member: false, sector: 'Shifa', referredBy: 'Huzaifa' },

  /* ── Shifa sector — KCF members who took VIP tickets ───────────── */
  { name: 'Huzaifa Peraje', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true },
  { name: 'Yusuf Haji Kalanjibail', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true },
  { name: 'Razak Palya', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true },
  { name: 'Shamnaz', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Umaricha', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Shihab HLY', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Siddique Sunnamoole', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Hasainar Ennehole / Majeed Haleyangadi', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Majeed Vittla', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Muhammad Kannangar', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Salam Hly' },
  { name: 'Doctor Iqbal', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true },
  { name: 'Umarul Farooq Azizia', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Ziyad Pattrukodi', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true },
  { name: 'Azeez Nekkila', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true },
  { name: 'Hameed Madantila', tier: 'VIP', member: true, sector: 'Shifa', referredBy: 'Hz', confirmed: true, note: 'Source ref: 100' },
  { name: 'Haris Saqafi', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Basheer Layila', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Shamsuddin Uppinangady', tier: 'VIP', member: true, sector: 'Shifa' },
  { name: 'Irfan Kanyarakodi', tier: 'VVIP', member: true, sector: 'Shifa', confirmed: true, note: 'Fruits' },

  /* ── Olaya sector — Non KCF VIP ───────────────────────────────── */
  { name: 'Genius Abdulla', tier: 'VIP', member: false, sector: 'Olaya', note: 'Source shows "5.." — quantity to confirm' },
  { name: 'Minhaj', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Nizam' },
  { name: 'Rahiz', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Nizam' },
  { name: 'Ibrahim', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Nizam' },
  { name: 'Nizar', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Nizam' },
  { name: 'Sadiq Kanchinadka', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Ismail Ustad' },
  { name: 'Habeeb Ghurnatha', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Ahmed Bava' },
  { name: 'Muhammad Ali Kapu', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Ahmed Bava' },
  { name: 'Asgar', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'Nizam' },
  { name: 'Arabco', tier: 'VIP', member: false, sector: 'Olaya', referredBy: 'NS' },

  /* ── Olaya sector — KCF members ───────────────────────────────── */
  { name: 'Haneef NS', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Ashraf Killur', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Ilyas Lateefi', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Mushtaq Uppinangady', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Razak Barya', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Abdul Rahman Venoor', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Shihab Saqafi', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Sharif KV', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Hakim Pandavarakallu', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Zainuddin Killur', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'KM Wahab', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Ajmal', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Razak Salethuru', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Fazal Bajpe', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Muneer Salethuru', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Fazal Bannur', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Tasleem & Friends Sulaimania', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Jabbar Nandavara', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Farooq Padubidri', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Lateef Turkalike', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Zubair Turkalike', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Parvez Jeppu', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Savan Abdulla', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Muaz', tier: 'VIP', member: true, sector: 'Olaya' },
  { name: 'Tasleem', tier: 'VVIP', member: false, sector: 'Olaya', referredBy: 'Mushtaq' },
  { name: 'Shameem', tier: 'VVIP', member: false, sector: 'Olaya', referredBy: 'Mushtaq' },
  { name: 'Habeeb T H', tier: 'VVIP', member: true, sector: 'Olaya', note: 'Source ref: 1111' },
  { name: 'Nizam Sagar', tier: 'VVIP', member: true, sector: 'Olaya', note: 'Source ref: 1313' },
  { name: 'Siddique Uppala', tier: 'VVIP', member: true, sector: 'Olaya' },
  { name: 'Khader Mandekolu', tier: 'VVIP', member: true, sector: 'Olaya' },

  /* ── Rabwa sector ─────────────────────────────────────────────── */
  { name: 'Akbar Sharif', tier: 'VIP', member: true, sector: 'Rabwa', referredBy: 'Saleemaka' },
  { name: 'Azeez Moodigere', tier: 'VIP', member: true, sector: 'Rabwa' },
  { name: 'Mustafa Madani', tier: 'VIP', member: true, sector: 'Rabwa' },
  { name: 'Javeed Bai', tier: 'VIP', member: true, sector: 'Rabwa', referredBy: 'Asif Handel' },
  { name: 'Sharif Kolpe', tier: 'VIP', member: true, sector: 'Rabwa', referredBy: 'Saleem Bai' },

  /* ── Batha sector ─────────────────────────────────────────────── */
  { name: 'Nazeer Haji Kashipatna', tier: 'VVIP', member: true, sector: 'Batha' },
  { name: 'Basheer Talapadi', tier: 'VVIP', member: true, sector: 'Batha' },
  { name: 'Dawood Khandak', tier: 'VVIP', member: true, sector: 'Batha' },
  { name: 'Aboobakkar Nitte', tier: 'VVIP', member: true, sector: 'Batha' },
  { name: 'Anees Zoom Plus', tier: 'VVIP', member: false, sector: 'Batha', referredBy: 'Hussain' },
  { name: 'Salman Kozhikode', tier: 'VVIP', member: false, sector: 'Batha', referredBy: 'Hussain' },
  { name: 'Naushad Podium', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Azeez Katipalla', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Kabeer Khandak', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Hussain Krishnapura', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Sajid Manjeshwara', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Irfan Melkar', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Haneef Kanyana', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Zaheer Moorje', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Haidar Mittur', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Yaseer Montepadavu', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Mohammed Haris', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Ansar Kaikamba', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Faris Kooluru', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Sameer Jeppu', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Altaf Soorinje', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Mustafa Sadi', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Mustafa Kattattila', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Irshad KP', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Ismail Manjanadi', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Suhail Talapadi', tier: 'VIP', member: true, sector: 'Batha' },
  { name: 'Asif Thodugoli', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Hussain' },
  { name: 'Asif Maduru', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Hussain' },
  { name: 'Ashraf Khandak', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Kannur', confirmed: true },
  { name: 'Kabeer Talapadi', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Basheer Talapadi' },
  { name: 'BM Cargo', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Rasheed Madani' },
  { name: 'Zakir Mulrapatna', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Mustafa Sadi' },
  { name: 'Aboobakkar Salethuru', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Kannur' },
  { name: 'Nizam Plymoon', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Kannur' },
  { name: 'Mohammed Ali', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Siddique Manjanadi' },
  { name: 'Niyaz Deera', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Siddique Manjanadi' },
  { name: 'Rafeeq Ullal', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Kaikamba' },
  { name: 'Dawood Afaq', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Kannur' },
  { name: 'Asif Krishnapura', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Mustafa Sadi' },
  { name: 'Shoukath Karkala', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Ibrahim Talapadi' },
  { name: 'Ashraf Deralakatte', tier: 'VIP', member: false, sector: 'Batha', referredBy: 'Ibrahim Talapadi' },

  /* ── Malaz sector ─────────────────────────────────────────────── */
  { name: 'Hotel 1', tier: 'VIP', member: false, sector: 'Malaz', referredBy: 'klrb', confirmed: true, note: 'Source shows "5.." — quantity to confirm' },
  { name: 'Hotel 2', tier: 'VIP', member: false, sector: 'Malaz', referredBy: 'klrb', confirmed: true, note: 'Source shows "5.." — quantity to confirm' },
  { name: 'Farooq Panemangaluru', tier: 'VIP', member: true, sector: 'Malaz' },
  { name: 'Rameez Kulai', tier: 'VIP', member: true, sector: 'Malaz' },
  { name: 'Zaheer Ullala', tier: 'VIP', member: true, sector: 'Malaz', referredBy: 'Klrb', confirmed: true },
  { name: 'Rafeeq Javagal', tier: 'VIP', member: true, sector: 'Malaz' },
  { name: 'Hamza Ustad Chokandali', tier: 'VIP', member: true, sector: 'Malaz' },
  { name: 'Bava Haji', tier: 'VIP', member: true, sector: 'Malaz' },
  { name: 'Nooraka Burkha', tier: 'VIP', member: true, sector: 'Malaz' },
  { name: 'Ibrahim', tier: 'VIP', member: true, sector: 'Malaz', referredBy: 'Farooq' },
  { name: 'Ismail Kannangar', tier: 'VVIP', member: true, sector: 'Malaz' },
  { name: 'Muhammad Kallarbe', tier: 'VVIP', member: true, sector: 'Malaz', referredBy: 'klrb', confirmed: true },
  { name: 'Cargo', tier: 'VVIP', member: true, sector: 'Malaz' },
  { name: 'Spare Parts', tier: 'VVIP', member: true, sector: 'Malaz', referredBy: 'klrb', confirmed: true },

  /* ── Badiya sector ────────────────────────────────────────────── */
  { name: 'Sammi Bai', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Muzaffar Bai', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Shaikh Sali Bai', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Mansoor Paramount', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Muttalib Jubail', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Qamar Kannangar', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Nauman Kanyana', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Haris' },
  { name: 'Siraj', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukka' },
  { name: 'Tanveer', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Mukhtar' },
  { name: 'Swadiq Mukka', tier: 'VIP', member: false, sector: 'Badiya' },
  { name: 'Suwaidi Hotel', tier: 'VIP', member: false, sector: 'Badiya', referredBy: 'Alekkadi' },
  { name: 'Sattar Mittur', tier: 'VIP', member: true, sector: 'Badiya' },
  { name: 'Ashraf Mukka', tier: 'VIP', member: true, sector: 'Badiya' },
  { name: 'Razak Katta', tier: 'VIP', member: true, sector: 'Badiya' },
  { name: 'Mukhtar Haleyangadi', tier: 'VIP', member: true, sector: 'Badiya' },
  { name: 'Hussain Manjeshwara', tier: 'VIP', member: true, sector: 'Badiya' },
  { name: 'Saleem Mittur', tier: 'VIP', member: true, sector: 'Badiya' },
  { name: 'Fahad Ibrahim', tier: 'VIP', member: true, sector: 'Badiya' },

  /* ── Sponsors ─────────────────────────────────────────────────── */
  { name: 'Aadu', tier: 'VVIP', member: true, sector: 'Sponsors', referredBy: 'Mukka', note: 'Listed under Sponsors in the source' },
] as const;

/* ------------------------------------------------------------------ */

/**
 * The imported context becomes a TIMELINE ENTRY, not a field.
 *
 * `clients` has no notes column by design (015): the question is "what was
 * said when, and by whom", which is rows with timestamps and authors. So
 * where this record came from is itself the first entry in its history —
 * which is exactly what it is.
 */
function importNote(c: SeedClient): string {
  const lines = [
    `Bought a ${c.tier} ticket at the previous event.`,
    `Sector: ${c.sector}. ${c.member ? 'KCF member.' : 'Not a KCF member.'}`,
  ];
  if (c.referredBy) lines.push(`Contact owned by: ${c.referredBy}.`);
  if (c.confirmed) lines.push('Ticket was confirmed (ticked on the source list).');
  if (c.note) lines.push(c.note);
  lines.push(
    'Imported from the previous event list. The name is a transliteration ' +
      'from Kannada and may need correcting.',
  );
  return lines.join('\n');
}

async function apply(): Promise<{ inserted: number; skipped: number }> {
  return withTransaction(async (client) => {
    let inserted = 0;
    let skipped = 0;

    for (const c of CLIENTS) {
      /* Skip rather than update on a name clash. Unlike the activities
       * import, a client may already carry THIS year's conversation, and
       * overwriting it with a canned import line would destroy exactly the
       * thing the record exists to hold. */
      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM clients WHERE lower(trim(name)) = lower(trim($1))`,
        [c.name],
      );

      if (existing.length > 0) {
        skipped += 1;
        continue;
      }

      /* PROSPECT for everyone: last year's purchase is history, not a
       * commitment for this year, and re-asking is the entire point.
       * unit_id stays NULL — the source names SECTORS, and a sector holds
       * several units, so there is no honest mapping. */
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO clients
           (name, intended_tier, status, is_member, referred_by, sector,
            source, created_by)
         VALUES ($1, $2::ticket_type, 'PROSPECT', $3::boolean, $4, $5, $6,
                 NULL)
         RETURNING id`,
        [
          c.name,
          c.tier,
          c.member,
          c.referredBy ?? null,
          /* Stored on the row, not only in the timeline text (020): the
           * sector filter has to be able to FIND these, and prose in a
           * note is not queryable. Uppercased to match units.sector. */
          c.sector.toUpperCase(),
          SOURCE,
        ],
      );

      await client.query(
        `INSERT INTO client_interactions
           (client_id, kind, body, author_id, author_name)
         VALUES ($1, 'NOTE', $2, NULL, $3)`,
        [rows[0]!.id, importNote(c), 'Imported from last event list'],
      );

      inserted += 1;
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'CLIENTS_IMPORTED', $1)`,
      [JSON.stringify({ inserted, skipped, source: SOURCE })],
    );

    return { inserted, skipped };
  });
}

/* ------------------------------------------------------------------ */

const confirmed = process.argv.slice(2).includes('--yes');
const LINE = '─'.repeat(70);

async function main(): Promise<void> {
  const bySector = new Map<string, number>();
  for (const c of CLIENTS) {
    bySector.set(c.sector, (bySector.get(c.sector) ?? 0) + 1);
  }

  if (!confirmed) {
    console.log(`\n${LINE}`);
    console.log('  DRY RUN — nothing has been changed');
    console.log(LINE);
    console.log(`\n  Would import ${CLIENTS.length} clients as PROSPECT:\n`);
    for (const [sector, n] of bySector) {
      console.log(`    ${sector.padEnd(14)} ${n}`);
    }

    const vvip = CLIENTS.filter((c) => c.tier === 'VVIP').length;
    const members = CLIENTS.filter((c) => c.member).length;
    const owned = CLIENTS.filter((c) => c.referredBy).length;
    console.log(`\n    VIP ${CLIENTS.length - vvip}  ·  VVIP ${vvip}`);
    console.log(`    KCF members ${members}  ·  Non-member ${CLIENTS.length - members}`);
    console.log(`    With a named contact owner: ${owned}`);

    console.log(
      `\n  A client whose NAME already exists is SKIPPED, never` +
        `\n  overwritten — an existing record may hold this year's` +
        `\n  conversation, which an import must not destroy.`,
    );
    console.log(`\n  To apply:`);
    console.log(`    npm run db:import-clients -w @pravasi/backend -- --yes`);
    console.log(`\n${LINE}\n`);
    return;
  }

  const r = await apply();
  console.log(`\n${LINE}`);
  console.log('  CLIENTS IMPORTED');
  console.log(LINE);
  console.log(`\n  inserted ......... ${r.inserted}`);
  console.log(`  skipped (exists) . ${r.skipped}`);
  console.log(
    `\n  All land as PROSPECT with no unit set — the source names` +
      `\n  SECTORS, and a sector contains several units. Assign units` +
      `\n  and follow-up dates on /admin/clients.`,
  );
  console.log(`\n${LINE}\n`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `[import-clients] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
