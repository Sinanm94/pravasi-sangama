# Graph Report - pravasi-sangama  (2026-08-27)

## Corpus Check
- 168 files · ~184,470 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1656 nodes · 2951 edges · 124 communities (110 shown, 14 thin omitted)
- Extraction: 93% EXTRACTED · 6% INFERRED · 1% AMBIGUOUS · INFERRED: 183 edges (avg confidence: 0.84)
- Token cost: 942,711 input · 141,400 output

## Community Hubs (Navigation)
- Shared Zod Schemas
- Shared Enum Types
- Shared Constants Module
- Gate Scanner UI
- Client Screen Design Tokens
- Login Flow UI
- Bulk Password Rotation
- Activities List UI
- Migration 003 - Gates & Sessions
- Auth Repository & Gates
- Scanning Controller & Bulk-Sync
- Crypto & Token Helpers
- Admin Nav & Directory Pages
- Role-Guard Middleware
- Express App Bootstrap
- Admin Filter Options Query
- Frontend TS Config
- Shared Package Manifest
- Backend Dependencies
- Add-Activity Sheet UI
- Superuser & Agent Dashboards
- AppError Hierarchy
- Backend NPM Scripts
- Admin Ticket CSV Export
- Shared Package TS Config
- Backend Dev Dependencies
- Backend TS Config
- Ticket Receipt Component
- Unit Admin Provisioning
- JWT Session Cookies
- Ticket Ledger WHERE Builder
- CLAUDE.md - Auth & Access Control
- Admin Repository - Gates & Directory
- CLAUDE.md - Offline Gate Scanning
- Client Screen Filters & Search
- Root Package Manifest
- CLAUDE.md - UI Design System
- Scan Admission & Approval Logic
- Ticket Repository & Audit Writes
- Client Analytics Controller
- PWA Manifest
- Unit Admin Dashboard UI
- Agent Dashboard Component
- PostCSS/Autoprefixer Config
- Frontend Motion/Storage Deps
- Agent Dashboard Page & Reprint
- Admin Scan Log Page
- Share Ticket Modal
- Test Agent Purge Script
- Superuser Provisioning
- Ticket Number Reset Script
- Unit Admin Controller
- Activities Repository
- User Manual - Agent Approvals
- Apple Touch Icon Asset
- Shared Ticket/Scan Enums
- SMTP Mailer
- Analytics Dashboard Repository
- Ticket Email Template
- 512px PWA Icon Asset
- Service Worker
- Root Layout & Fonts
- Ticket Sharing (PNG Capture)
- Photoroom Logo Asset
- Activities Controller
- CLAUDE.md - Ticketing Business Rules
- User Manual - Roles
- User Manual - Ticket Types
- Frontend Package Manifest
- Client Import Script
- CLAUDE.md - QR & Numbering Integrity
- Logo Mark Asset
- Managed-By Banner Asset
- Brand Mark Asset (Full)
- Next.js App Icon Convention
- Shared QR/Scan Enums
- Activities Seed Script
- Dev Seed Script
- Password Reset Email Template
- CLAUDE.md - Clients & Activities Features
- CLAUDE.md - Role Hierarchy
- Deployment & Build Notes
- CLAUDE.md - Architecture Overview
- Password Reset UI Flow
- Admin Controller Misc Endpoints
- User Manual - Security Model
- User Manual - Assets & Palette
- User Manual - Offline Scanning
- Icons README - Platform Split
- Backend Package Identity
- Express Type Augmentation
- Frontend PostCSS Config File
- Vercel Config
- Socket.IO Dependency
- Next.js Config File
- Next.js Env Types
- html2canvas Dependency
- html5-qrcode Dependency
- Next.js Dependency
- Shared Package Link
- qrcode.react Dependency
- Recharts Dependency
- Zustand Dependency
- Tailwind Config File

## God Nodes (most connected - your core abstractions)
1. `errorMessage()` - 41 edges
2. `withTransaction()` - 37 edges
3. `query()` - 34 edges
4. `apiPost()` - 27 edges
5. `hashSecret()` - 26 edges
6. `unauthorized()` - 24 edges
7. `scripts` - 22 edges
8. `notFound()` - 22 edges
9. `useAuthStore` - 22 edges
10. `closePool()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `COOKIE_SAMESITE=none for Local Dev` --semantically_similar_to--> `Cookie Domain Decision (§0)`  [INFERRED] [semantically similar]
  TESTING.md → DEPLOYMENT.md
- `Legacy Navy/Gold Styling in the Offline Page` --semantically_similar_to--> `Manual's Navy and Gold Print Palette`  [INFERRED] [semantically similar]
  frontend/public/offline.html → docs/USER-MANUAL.html
- `updateClient()` --semantically_similar_to--> `decideAgent()`  [AMBIGUOUS] [semantically similar]
  backend/src/modules/clients/clients.repository.ts → backend/src/modules/admin/admin.repository.ts
- `TESTING.md Manual E2E Checklist` --conceptually_related_to--> `Deleted UNIT_PENDING / unit-login Flow`  [AMBIGUOUS]
  TESTING.md → CLAUDE.md
- `LibreOffice HTML Import Limitations` --semantically_similar_to--> `Print/PDF Pipeline (window.print, not rasteriser)`  [INFERRED] [semantically similar]
  docs/README.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The Unit Gateway Removal-and-Restoration Arc** — claude_deleted_unit_login_flow, claude_unit_gateway, claude_sticky_unit_gateway, claude_simplified_onboarding, claude_invite_pin_sole_barrier [EXTRACTED 1.00]
- **Offline-First Gate Admission Flow** — claude_scanner_pwa_queue, claude_scan_verify_endpoint, claude_conditional_update_race_safety, claude_bulk_sync, claude_post_sync_duplicate, claude_service_worker_scope [EXTRACTED 1.00]
- **Session Cookie Correctness Across Deploy, Test and Route Layers** — deployment_cookie_domain_decision, testing_local_cookie_samesite_none, claude_httponly_cookie_jwt, claude_route_protection_layers, deployment_smoke_test [INFERRED 0.85]
- **Manual's End-to-End Ticket Lifecycle (Issue → Deliver → Scan → Watch)** — docs_user_manual_agent_role, docs_user_manual_pass_delivery_channels, docs_user_manual_gate_staff_role, docs_user_manual_traffic_light_scan_feedback, docs_user_manual_system_overview [EXTRACTED 1.00]
- **Plain-Language Security Model Presented to Administrators** — docs_user_manual_approval_is_the_gate, docs_user_manual_qr_fingerprint_only, docs_user_manual_a_code_admits_once, docs_user_manual_every_attempt_recorded, docs_user_manual_session_lifetimes, docs_user_manual_operator_responsibilities [EXTRACTED 1.00]
- **Offline-First Gate Assurance Across Docs and Shell** — docs_user_manual_offline_scanning, docs_user_manual_offline_double_admit_limitation, frontend_public_offline_offline_shell_page, frontend_public_offline_scans_are_safe_reassurance [INFERRED 0.85]
- **Scoped access control as a SQL predicate, never an app-level check** — backend_src_modules_admin_admin_repository_decideagent, backend_src_modules_unit_admin_unit_admin_repository_unitadminticketwhere, backend_src_modules_unit_admin_unit_admin_repository_listagentsforadmin, backend_src_modules_unit_admin_unit_admin_repository_resetagentpassword, backend_src_modules_unit_admin_unit_admin_repository_listinvitepinsforadmin, backend_src_modules_tickets_tickets_repository_findticketforagent, backend_src_modules_tickets_tickets_repository_findticketforshare [INFERRED 0.95]
- **Gate admission flow — replay check, conditional-UPDATE lock, diagnosis, log** — backend_src_modules_scanning_scanning_repository_findbyclientscanid, backend_src_modules_scanning_scanning_repository_admitguestcode, backend_src_modules_scanning_scanning_repository_findbyhash, backend_src_modules_scanning_scanning_repository_ticketsummary, backend_src_modules_scanning_scanning_repository_lastadmissiongate, backend_src_modules_scanning_scanning_repository_insertscanlog [INFERRED 0.95]
- **One WHERE builder feeds rows, totals, charts and CSV so they cannot disagree** — backend_src_modules_clients_clients_repository_clientwhere, backend_src_modules_clients_clients_repository_listclients, backend_src_modules_clients_clients_repository_summariseclients, backend_src_modules_clients_clients_repository_analyseclients, backend_src_modules_clients_clients_controller_exportclients, backend_src_modules_admin_admin_repository_ticketledgerwhere, backend_src_modules_admin_admin_repository_scanlogwhere [INFERRED 0.95]
- **The family of superuser screens sharing one filter/list/export/analytics discipline** — frontend_src_app_admin_clients_page_clientsscreen, frontend_src_app_admin_tickets_page_ledgerscreen, frontend_src_app_admin_activities_page_activitiesscreen, frontend_src_app_admin_tickets_page_buildquerystring, frontend_src_components_admin_clientinsights_clientinsights, frontend_src_lib_apiclient_apidownload, frontend_src_app_admin_clients_page_filters_in_lockstep_contract, frontend_src_app_admin_clients_page_debounced_search_commit, frontend_src_app_admin_clients_page_server_derived_filter_options [INFERRED 0.85]
- **Offline-first gate scan flow — admit on pending, distinguish offline from server fault, drain queue** — frontend_src_components_scanner_gatescanner_gatescanner, frontend_src_components_scanner_gatescanner_networkstate, frontend_src_components_scanner_gatescanner_networkbadge, frontend_src_components_scanner_gatescanner_offline_first_admit, frontend_src_components_scanner_gatescanner_pending_sync_state, frontend_src_components_charts_charttheme_scan_result_styles [INFERRED 0.85]
- **Sticky Unit Gateway — device preference in localStorage, PIN in memory, server re-verifies, route guard is only UX** — frontend_src_app_login_page_loginflow, frontend_src_app_login_page_unitgatewayscreen, frontend_src_app_login_page_signupform, frontend_src_app_login_page_activeunit, frontend_src_app_login_page_sticky_gateway_pin_never_persisted, frontend_src_middleware_middleware, frontend_src_middleware_not_an_authorization_boundary [INFERRED 0.85]

## Communities (124 total, 14 thin omitted)

### Community 0 - "Shared Zod Schemas"
Cohesion: 0.03
Nodes (62): ActivityQuery, ActivityQuerySchema, AdminScanQuery, AdminScanQuerySchema, AdminTicketExportQuery, AdminTicketExportQuerySchema, AdminTicketQuery, AdminTicketQuerySchema (+54 more)

### Community 1 - "Shared Enum Types"
Cohesion: 0.05
Nodes (49): ActivityPriority, ApprovalStatus, AuthRole, ClientInteractionKind, ClientStatus, ActivityListResponse, ActivityRecord, AdminFilterOptions (+41 more)

### Community 2 - "Shared Constants Module"
Cohesion: 0.04
Nodes (46): ACTIVITY_PRIORITIES, ACTIVITY_PRIORITY_LABELS, AGENT_INVITE_PIN_LENGTH, AGENT_PASSWORD_MIN_LENGTH, APPROVAL_STATUSES, AUTH_ROLES, CLIENT_INTERACTION_KINDS, CLIENT_INTERACTION_LABELS (+38 more)

### Community 3 - "Gate Scanner UI"
Cohesion: 0.08
Nodes (39): CORNER_CLASSES, CORNERS, formatScanMoment(), GateScanner(), GateScannerProps, NetworkBadge(), NetworkState, Admit-on-pending offline-first gate flow (+31 more)

### Community 4 - "Client Screen Design Tokens"
Cohesion: 0.07
Nodes (30): PRIORITY_TONE, Semantic colour is exempt from the brand palette, STATUS_TONE, ClientInsights(), GROUP_LABELS, Props, StageTooltip(), Table + legend relieve the gold contrast WARN (+22 more)

### Community 5 - "Login Flow UI"
Cohesion: 0.09
Nodes (29): LabelledInput(), ActiveUnit, AgentLoginForm(), LoginFlow(), Sticky unit persisted, invite PIN never persisted, Tab, TABS, AdminForm() (+21 more)

### Community 6 - "Bulk Password Rotation"
Cohesion: 0.08
Nodes (29): bulkRotate(), generateMemorablePassword(), RotatedAccount, unitPrefix(), closePool(), pool, withTransaction(), apply() (+21 more)

### Community 7 - "Activities List UI"
Cohesion: 0.09
Nodes (33): ActivityRow(), formatDateOnly(), formatEventDate(), Instant-apply patching (mutate-then-reload), isOverdue(), AddClientSheet(), Arrow controls instead of HTML5 drag-and-drop, BoardCard() (+25 more)

### Community 8 - "Migration 003 - Gates & Sessions"
Cohesion: 0.11
Nodes (26): gate_sessions, gates, password_reset_tokens, trg_gates_updated_at, trg_unit_admins_updated_at, unit_admins, supervisor_unit_assignments, client_interactions (+18 more)

### Community 9 - "Auth Repository & Gates"
Cohesion: 0.08
Nodes (17): query(), setGateActive(), AgentRow, createAgentSession(), createGateSession(), createPasswordResetToken(), GateRow, revokeGateSession() (+9 more)

### Community 10 - "Scanning Controller & Bulk-Sync"
Cohesion: 0.12
Nodes (26): scanActor, bulkSync, verifyScan, ActorNames, alertTypeFor(), nameCache, publishScan(), publishScanSafely() (+18 more)

### Community 11 - "Crypto & Token Helpers"
Cohesion: 0.19
Nodes (24): hashToken(), newId, newResetToken(), verifyAgainstDummy(), verifySecret(), forbidden(), unauthorized(), signSession() (+16 more)

### Community 12 - "Admin Nav & Directory Pages"
Cohesion: 0.12
Nodes (19): Assignee, AgentRow(), formatNumber(), formatWhen(), SortKey, StatCard(), CreateGateCard(), formatWhen() (+11 more)

### Community 13 - "Role-Guard Middleware"
Cohesion: 0.13
Nodes (18): loadSession(), requireSuperuser(), requireUnitAdmin(), activityRoutes, adminRoutes, analyticsRoutes, authRoutes, loginLimiter (+10 more)

### Community 14 - "Express App Bootstrap"
Cohesion: 0.13
Nodes (18): createApp(), env, isProduction, parsed, schema, healthcheck(), errorHandler(), notFoundHandler() (+10 more)

### Community 15 - "Admin Filter Options Query"
Cohesion: 0.11
Nodes (23): Filter options derived from data, never a hardcoded list, LATERAL aggregate instead of JOIN + GROUP BY (with ::INT on COUNT), listAgentDirectory(), listFilterOptions(), listClientFilterOptions, addInteraction(), analyseClients(), Author name captured at write time (denormalised, survives account deactivation) (+15 more)

### Community 16 - "Frontend TS Config"
Cohesion: 0.07
Nodes (26): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+18 more)

### Community 17 - "Shared Package Manifest"
Cohesion: 0.07
Nodes (26): import, types, dependencies, zod, devDependencies, typescript, exports, ./constants (+18 more)

### Community 18 - "Backend Dependencies"
Cohesion: 0.08
Nodes (25): dependencies, bcrypt, cookie-parser, cors, dotenv, express, express-rate-limit, helmet (+17 more)

### Community 19 - "Add-Activity Sheet UI"
Cohesion: 0.11
Nodes (21): AddActivitySheet(), Field(), inputCls (activities), StatCard(), inputCls (clients), Local UI primitives duplicated until a second consumer earns promotion, Rounded-radius ladder (xl inputs, 2xl panels, 3xl cards, full pills), Sheet() (+13 more)

### Community 20 - "Superuser & Agent Dashboards"
Cohesion: 0.13
Nodes (13): LedgerScreen(), ScannerScreen(), TicketingScreen(), ManagementFlow(), RootPage(), UnitAdminScreen(), ProtectedRoute(), AuthState (+5 more)

### Community 21 - "AppError Hierarchy"
Cohesion: 0.17
Nodes (17): AppError, conflict(), generateQrPayload(), hashQrPayload(), agentScope(), reissueTicketCodes(), The unique index decides, not a pre-check, issueTicket (+9 more)

### Community 22 - "Backend NPM Scripts"
Cohesion: 0.09
Nodes (22): scripts, build, build:sql, db:add-missing-units, db:bulk-rotate-passwords, db:demo-agent, db:import-clients, db:inspect-scans (+14 more)

### Community 23 - "Admin Ticket CSV Export"
Cohesion: 0.17
Nodes (20): notFound(), CSV_COLUMNS, csvEscape(), decideAgent, exportTicketLedger, getTicket, listAgentDirectory, listFilterOptions (+12 more)

### Community 24 - "Shared Package TS Config"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+13 more)

### Community 25 - "Backend Dev Dependencies"
Cohesion: 0.10
Nodes (21): devDependencies, tsx, @types/bcrypt, @types/cookie-parser, @types/cors, @types/express, @types/jsonwebtoken, @types/node (+13 more)

### Community 26 - "Backend TS Config"
Cohesion: 0.10
Nodes (20): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noUncheckedIndexedAccess, outDir (+12 more)

### Community 27 - "Ticket Receipt Component"
Cohesion: 0.11
Nodes (6): CodeSpec, GlyphShape, MOCK_TICKET, TicketReceiptProps, TICKET_ASSETS, TicketAssets

### Community 28 - "Unit Admin Provisioning"
Cohesion: 0.16
Nodes (18): DIVISION, provision(), report(), UNIT_ADMIN_INITIAL_PASSWORDS, UnitEntry, UNITS, ZONE_SUPERVISORS, audit() (+10 more)

### Community 29 - "JWT Session Cookies"
Cohesion: 0.20
Nodes (17): clearSessionCookie(), cookieOptions, setSessionCookie(), verifySession(), agentLogin, agentSignup, contextOf(), currentSession (+9 more)

### Community 30 - "Ticket Ledger WHERE Builder"
Cohesion: 0.16
Nodes (19): AdminTicketLedgerRow, ILIKE wildcard escaping on free-text search, scanLogWhere(), Shared WHERE-builder discipline: summary and rows can never describe different sets, summariseScanLog(), summariseTicketsForAdmin(), ticketLedgerWhere(), Totals aggregate over the whole filtered set, never a sum of capped rows (+11 more)

### Community 31 - "CLAUDE.md - Auth & Access Control"
Cohesion: 0.18
Nodes (19): What the Single-Step Login Gave Up, Agent Login (single-step), Bottom-Up Authorization Rule, db:bulk-rotate-passwords, decideAgent restrictToAdminId Predicate, Deleted UNIT_PENDING / unit-login Flow, Invite PIN as Sole Barrier to Minting an Issuer, Two Login Surfaces (/login vs /management) (+11 more)

### Community 32 - "Admin Repository - Gates & Directory"
Cohesion: 0.12
Nodes (11): AgentDirectoryRow, FilterOptionRows, GateSummaryRow, PendingAgentRow, ReissueFailure, ReissueOutcome, rotateGatePin(), ScanLogFilters (+3 more)

### Community 33 - "CLAUDE.md - Offline Gate Scanning"
Cohesion: 0.15
Nodes (18): POST /api/scan/bulk-sync, No Lint, No Automated Tests, Offline-First Gate Scanning Architecture, POST_SYNC_DUPLICATE (the honest limitation), db:provision-scanners (SCAN01-SCAN20), socket.io /live Namespace, Postmortem — Every Gate Scan Failed, Scan Log (/admin/scans) (+10 more)

### Community 34 - "Client Screen Filters & Search"
Cohesion: 0.22
Nodes (17): ActivitiesScreen(), ClientsScreen(), 300ms debounced search commit before hitting the API, Event-timezone date rendering, not the device's clock, Filter-panel + stat-card + list admin screen shell, List / analytics / export share one filter expression, Non-fatal option-load failure degrades silently, no toast on page load, Filter options derived server-side over the whole table (+9 more)

### Community 35 - "Root Package Manifest"
Cohesion: 0.11
Nodes (17): engines, node, name, private, scripts, build:shared, db:migrate, db:seed (+9 more)

### Community 36 - "CLAUDE.md - UI Design System"
Cohesion: 0.13
Nodes (17): Back Navigation (useDismissOnBack), Official Brand Palette, chartTheme.ts Chart Palette, Client Pipeline Board (statuses as columns), Apple-like Minimalist Design Language, Montserrat via next/font, Motion Vocabulary (springs, reducedMotion), Overlays Are display:none While Printing (+9 more)

### Community 37 - "Scan Admission & Approval Logic"
Cohesion: 0.17
Nodes (15): decideAgent(), listScanLog(), admitGuestCode(), AdmittedRow, DiagnosticRow, ExistingScanRow, findByClientScanId(), findByHash() (+7 more)

### Community 38 - "Ticket Repository & Audit Writes"
Cohesion: 0.15
Nodes (14): listTicketsForAdmin(), resetAnyAgentPassword(), writeAudit(), AgentTicketRow, findTicketForAgent(), findTicketForShare(), listTicketsByAgent(), QrCodeRow (+6 more)

### Community 39 - "Client Analytics Controller"
Cohesion: 0.23
Nodes (14): addInteraction, CLIENT_CSV_COLUMNS, clientAnalytics, createClient, csvEscape(), deleteClient, exportClients, getClient (+6 more)

### Community 40 - "PWA Manifest"
Cohesion: 0.12
Nodes (15): background_color, categories, description, display, icons, id, name, orientation (+7 more)

### Community 41 - "Unit Admin Dashboard UI"
Cohesion: 0.15
Nodes (6): Decision, formatWhen(), PendingCard(), TicketRow(), Logo(), SOURCES

### Community 42 - "Agent Dashboard Component"
Cohesion: 0.19
Nodes (11): AgentDashboard(), AgentDashboardProps, Phase, toTicketData(), AgentContext, FieldErrors, inputClass(), NewRegistrationForm() (+3 more)

### Community 43 - "PostCSS/Autoprefixer Config"
Cohesion: 0.13
Nodes (15): autoprefixer, devDependencies, autoprefixer, postcss, tailwindcss, @types/node, @types/react, @types/react-dom (+7 more)

### Community 44 - "Frontend Motion/Storage Deps"
Cohesion: 0.13
Nodes (15): framer-motion, dependencies, framer-motion, idb-keyval, lucide-react, react, react-dom, socket.io-client (+7 more)

### Community 45 - "Agent Dashboard Page & Reprint"
Cohesion: 0.18
Nodes (8): AgentReprintSheet(), formatWhen(), Row(), TicketData, TicketReceipt(), printTicket(), PrintTicketMeta, printTitleFor()

### Community 46 - "Admin Scan Log Page"
Cohesion: 0.16
Nodes (8): Filters, formatEventDate(), formatEventTime(), NO_FILTERS, RESULT_LABELS, RESULT_TONE, Row(), ScanLogScreen()

### Community 47 - "Share Ticket Modal"
Cohesion: 0.22
Nodes (9): Action, EmailState, ShareTicketMeta, ShareTicketModalProps, backdropVariants, fade, fieldErrorVariants, sheetVariants (+1 more)

### Community 48 - "Test Agent Purge Script"
Cohesion: 0.20
Nodes (11): AgentSummary, Applied, apply(), argv, confirmed, KEEP_MOBILES, LINE, main() (+3 more)

### Community 49 - "Superuser Provisioning"
Cohesion: 0.21
Nodes (9): provision(), ProvisionedSuperuser, retiredUsernames, generateSecurePassword(), PASSWORD_ALPHABET, PASSWORD_DIGITS, PASSWORD_LOWER, PASSWORD_UPPER (+1 more)

### Community 50 - "Ticket Number Reset Script"
Cohesion: 0.20
Nodes (11): Applied, apply(), argv, buildPlan(), confirmed, KEEP_MOBILES, LINE, main() (+3 more)

### Community 51 - "Unit Admin Controller"
Cohesion: 0.32
Nodes (10): generateAgentPassword(), unitAdminScope(), decideAgent, listAgents, listInvitePins, listTickets, requireAnyScope(), resetAgentPassword (+2 more)

### Community 52 - "Activities Repository"
Cohesion: 0.20
Nodes (7): ActivityFilters, ActivityRow, activityWhere(), deleteActivity(), listActivities(), summariseActivities(), updateActivity()

### Community 53 - "User Manual - Agent Approvals"
Cohesion: 0.20
Nodes (12): Agent Approvals, Agent Directory, Approval Is the Main Security Control, Common Questions (Troubleshooting), Event-Day Checklist, Every Scan Attempt Is Recorded, Summary Cards Count the Whole Filtered Set, The Five Admin Sections (+4 more)

### Community 54 - "Apple Touch Icon Asset"
Cohesion: 0.33
Nodes (12): apple-touch-icon.png — 180x180 iOS home-screen icon: violet swoosh mark on opaque white, iOS home-screen platform surface, wired via Next.js metadata.icons.apple, iOS/Safari does not composite transparency on home-screen install — it fills transparent regions solid black, so this surface must ship opaque, Opaque white canvas (alpha=255 across all 32,400 pixels), matching manifest background_color #f9fafb, Android/Chrome PWA manifest 'any' purpose — home screen, shortcuts, favicon; not cropped by a launcher mask, Measured trade-off: dark-violet swoosh on a dark browser tab (~#202124) reaches only 2.15:1 — legible but soft; the accepted fix is a light backing plate, never a hard white square, Generated artefact — rendered from ../Pravasi-sangama-mark.png with ImageMagick at 80% inner scale; do not hand-edit, icon-192.png — 192x192 PWA manifest 'any' icon: violet swoosh mark on a fully transparent canvas (+4 more)

### Community 55 - "Shared Ticket/Scan Enums"
Cohesion: 0.23
Nodes (12): ScanResult, TicketStatus, TicketType, AdminScanRow, AdminTicketRow, AgentTicketSummary, IssueTicketResponse, LiveScanEvent (+4 more)

### Community 56 - "SMTP Mailer"
Cohesion: 0.27
Nodes (9): getTransport(), isMailConfigured(), MailAttachment, sendMail(), SendMailParams, SendMailResult, SmtpError, smtpHint() (+1 more)

### Community 57 - "Analytics Dashboard Repository"
Cohesion: 0.18
Nodes (3): DivisionRow, RecentScanRow, TicketTypeRow

### Community 58 - "Ticket Email Template"
Cohesion: 0.35
Nodes (9): escapeHtml(), TICKET_IMAGE_CID, TicketEmailData, ticketEmailHtml(), ticketEmailSubject(), ticketEmailText(), decodeImage(), ShareEmailResult (+1 more)

### Community 59 - "512px PWA Icon Asset"
Cohesion: 0.38
Nodes (11): PWA App Icon 512 - violet ribbon crescent mark on transparent ground, Brand violet palette expressed as icon artwork - #5E17EB violet, #37098C violet-deep, #2E0775 violet-dark, pale lavender highlight, no amber, The plain icon is unsafe as a maskable source - its ink reaches 260px from centre, past the ~205px circle-crop radius, so the curl and outer sweep would be cut off if Android masked it, PWA installed-app identity - the home-screen and app-switcher face of the Pravasi Sangama 2026 gate scanner shell, referenced from the web app manifest, Ribbon crescent brand mark - layered flowing stroke forming an open sweep with an inward curl, reading as a stylised wave or migratory motif, Transparent background on the plain icon - alpha bbox 66,74-447,438, corners fully transparent, so the launcher supplies its own ground, Two-variant icon strategy - a transparent 'any' icon plus a white-bleed 'maskable' icon, because one asset cannot serve both an uncropped badge and an adaptive crop, PWA Maskable App Icon 512 - same crescent mark inset on opaque white square (+3 more)

### Community 60 - "Service Worker"
Cohesion: 0.29
Nodes (8): event_waitUntilSafe(), handleNavigation(), ICON_PATH_PATTERNS, isCacheable(), networkFirstAsset(), PRECACHE_URLS, staleWhileRevalidate(), withTimeout()

### Community 61 - "Root Layout & Fonts"
Cohesion: 0.24
Nodes (6): metadata, montserrat, viewport, ServiceWorkerRegistrar(), MotionProvider(), Toaster()

### Community 62 - "Ticket Sharing (PNG Capture)"
Cohesion: 0.29
Nodes (10): blobToBase64(), ShareTicketModal(), captureTicket(), downloadBlob(), ShareMethod, ShareResult, shareTicket(), shareTicketBlob() (+2 more)

### Community 63 - "Photoroom Logo Asset"
Cohesion: 0.36
Nodes (10): The logo as the sampled source of the official brand palette (violet primary, amber accent, no navy/gold), Dark-ink-on-light construction — the mark and wordmark are dark violet/navy with no light-surface variant, so the logo needs a white masthead, Pravasi Sangama 2026 event logo (PNG, background-removed), Abstract layered ribbon swirl mark — overlapping violet strokes forming a stylised 'D'/wave, reading as confluence of streams, Amber accent used only for the 'SANGAMA' overline — matches brand-amber #FFA51F, Violet ink family in the artwork (bright violet through deepest near-black violet) — matches brand-violet #5E17EB / #37098C / #2E0775, Photoroom background-removed PNG — transparent-ground asset intended for placement over app surfaces, tickets and print, Wordmark 'PRAVASI' — heavy geometric sans, dark navy-violet ink (+2 more)

### Community 64 - "Activities Controller"
Cohesion: 0.36
Nodes (7): createActivity, deleteActivity, listActivities, listAssignees, superuserId(), toActivity(), updateActivity

### Community 65 - "CLAUDE.md - Ticketing Business Rules"
Cohesion: 0.31
Nodes (9): Backend Is the Authority on Capacity, Children Below 12, Defensive UI Fallbacks, Derived State via useMemo, Known Debt Register, Printed Panels Differ From Database Rows, QR Fan-Out and Capacity, Before Event Day Checklist (+1 more)

### Community 66 - "User Manual - Roles"
Cohesion: 0.25
Nodes (9): Administrator (Superuser) Role, Agent (Field Staff) Role, Agents Cannot Cancel Tickets, Gate Staff (Scanner) Role, My Registrations (Agent Ledger), Pass Delivery Channels (WhatsApp, Email, PDF, Image), Session Lifetimes (Admin 2h, Agent 8h), Single-Step Agent Login (No Unit Code) (+1 more)

### Community 67 - "User Manual - Ticket Types"
Cohesion: 0.22
Nodes (9): Children Below 12 Are Free and Uncounted, Entry Code (Guest QR), Location QR (Venue Map, Never Admits), Ticket Types and Printed QR Panels, Ticket Design Asset Drop Directory, Ticket Asset Export Rules (SVG vs 3x PNG), Opt-In Assets with CSS Fallback, Tier Ribbon Plates (ribbonHasLabel) (+1 more)

### Community 68 - "Frontend Package Manifest"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, start, typecheck, version

### Community 69 - "Client Import Script"
Cohesion: 0.32
Nodes (7): apply(), CLIENTS, confirmed, importNote(), LINE, main(), SeedClient

### Community 70 - "CLAUDE.md - QR & Numbering Integrity"
Cohesion: 0.29
Nodes (8): Conditional UPDATE (the row is the lock), Postgres Sequence Allocation (nextTicketNumbers), QR Payload Secrecy (SHA-256, never stored), Ticket Reissue / Reprint, Sequential Request and Ticket Numbering (migration 016), Format With to_char, Never LPAD, QR Secrecy Assertion, Revoked Ticket Join Test

### Community 71 - "Logo Mark Asset"
Cohesion: 0.36
Nodes (8): Application surfaces: login card masthead, ticket pass, PWA app icon, printed passes, Source of the sampled brand violet tokens (brand-violet, violet-deep, violet-dark), Dark-ink artwork requiring a light surface to remain legible, Pravasi Sangama logo mark (PNG), Abstract swirling ribbon glyph resembling a stylised 'P' / spiral crescent, Transparent background, no wordmark or lockup text, Layered violet colour ramp (pale lavender through deep violet to near-black), White masthead rule — mark must not sit on a dark band

### Community 72 - "Managed-By Banner Asset"
Cohesion: 0.43
Nodes (8): Managed-By Attribution Banner (docs/assets/managed-by.png), Eyebrow / wordmark / subtitle typographic hierarchy with wide-tracked uppercase, Global Tech Solutions — implementing vendor, Karnataka Cultural Foundation — client organisation, Pre-logo-change navy/gold brand palette retired from the app UI, Navy-and-gold banner palette (deep navy field, gold eyebrow, white wordmark), Pravasi Sangama 2026 E-Ticketing & Gate Management System, Rounded-corner full-bleed card surface for documentation footer credit

### Community 73 - "Brand Mark Asset (Full)"
Cohesion: 0.39
Nodes (8): Source of the brand violet tokens (#5E17EB / #37098C / #2E0775), Dark-ink legibility failure on dark surfaces — deepest violet/black strokes vanish, Abstract calligraphic swirl glyph — layered ribbon spiral on transparent ground, Pravasi Sangama brand mark (PNG), Application surfaces — login card, ticket pass, PWA icon, print/PDF chrome, Transparent-background PNG asset in frontend/public, served as a static file, Violet-only ink: lavender through near-black violet, no amber present, White masthead application — mark placed on light surfaces, never inverted or chipped

### Community 74 - "Next.js App Icon Convention"
Cohesion: 0.50
Nodes (8): iOS opaque-icon requirement — home-screen icons are composited without alpha, so the apple variant must carry its own solid ground rather than inheriting transparency, apple-icon.png — Apple touch icon variant of the same violet ribbon mark, smaller and set on an opaque white field, Pravasi Sangama brand mark — abstract flowing ribbon/spiral glyph rendered in stacked violet tones with black core strokes and lavender highlights, App favicon (icon.png) — layered violet ribbon spiral mark on transparent ground, Next.js App Router icon file convention — icon.png and apple-icon.png inside app/ are auto-emitted as <link rel="icon"> and apple-touch-icon with no manual head markup, Installed-app identity — the gate scanner runs as an installed PWA on shared phones, so these icons are how staff find the app on a home screen, Transparent-background favicon — the mark is cut out with no plate, so browser tab chrome shows through in light and dark themes, Violet-only icon palette — deep indigo, mid violet and pale lavender with no amber, navy or gold, matching the project's single brand action hue

### Community 75 - "Shared QR/Scan Enums"
Cohesion: 0.32
Nodes (8): QrCodeKind, QrCodeStatus, ScanReason, ScanStatus, BulkSyncItemResult, IssuedQrCodeWire, QrCode, VerifyScanResponse

### Community 76 - "Activities Seed Script"
Cohesion: 0.33
Nodes (6): ACTIVITIES, apply(), confirmed, LINE, main(), SeedActivity

### Community 77 - "Dev Seed Script"
Cohesion: 0.33
Nodes (6): AGENTS, DIVISION, report(), seed(), SUPERUSERS, UNITS

### Community 78 - "Password Reset Email Template"
Cohesion: 0.52
Nodes (6): escapeHtml(), minutesUntil(), PasswordResetEmailData, passwordResetHtml(), passwordResetText(), resetUrl()

### Community 79 - "CLAUDE.md - Clients & Activities Features"
Cohesion: 0.43
Nodes (7): Activities (migration 018), Master Ticket Ledger and CSV Export, clients.unit_id (migration 017), Last Event Purchaser Import (migration 019), Premium Client Tracking (migration 015), db:provision-demo-agent (DEMO01), Sector

### Community 80 - "CLAUDE.md - Role Hierarchy"
Cohesion: 0.38
Nodes (7): Agent, Division (District), Five-Role Nested Hierarchy, db:provision-superusers (ADMIN01-ADMIN03), Superuser, Unit, Never Run db:seed Against Production

### Community 81 - "Deployment & Build Notes"
Cohesion: 0.33
Nodes (7): build:shared Compiled-Output Gotcha, packages/shared as Single Source of Truth, First-Deploy Order, Forward-Only Migrations and Rollback, Render Backend Deployment, Supabase Connection String Selection, Vercel Frontend Deployment

### Community 82 - "CLAUDE.md - Architecture Overview"
Cohesion: 0.33
Nodes (7): Feature-Sliced Backend, JWTs in httpOnly Cookies, Pravasi Sangama 2026 E-Ticketing & Gate Management, Two-Layer Route Protection, Sticky Unit Gateway, Toasts vs Inline State, Cookie Domain Decision (§0)

### Community 83 - "Password Reset UI Flow"
Cohesion: 0.38
Nodes (7): DirectoryScreen(), Generic answer regardless of existence (no enumeration), ForgotForm(), submit(), ResetFlow(), submit(), apiPost()

### Community 84 - "Admin Controller Misc Endpoints"
Cohesion: 0.47
Nodes (6): badRequest(), createGate, listAgents, agentSignup(), The UX gate is not the boundary — server-side re-verification is, verifyUnitGateway()

### Community 85 - "User Manual - Security Model"
Cohesion: 0.33
Nodes (6): A Code Admits Once (Duplicate Detection), Agent Deactivation Without Invalidating Passes, QR Codes Stored Only as a Fingerprint, Security in Plain Terms, Green / Amber / Red Full-Screen Scan Verdict, Ticket Numbers Cannot Be Guessed (Random, Not Sequential)

### Community 86 - "User Manual - Assets & Palette"
Cohesion: 0.40
Nodes (6): LibreOffice HTML Filter Workarounds, Managed-By Footer Rendered as an Image, Manual's Navy and Gold Print Palette, USER-MANUAL.pdf — Rendered Print Edition, Pravasi Sangama 2026 System User Manual, Dark-Tab Contrast Trade-off (2.15:1)

### Community 87 - "User Manual - Offline Scanning"
Cohesion: 0.33
Nodes (6): Honest Limitation: Simultaneous Offline Double-Admit, Offline Scanning and PENDING SYNC, System Overview (Live Dashboard), Legacy Navy/Gold Styling in the Offline Page, Offline Fallback Page (offline.html), "Scans Already Taken Are Safe" Reassurance Note

### Community 88 - "Icons README - Platform Split"
Cohesion: 0.47
Nodes (6): Generated App Icon Set, Icon Background Split by Platform (Transparent vs Opaque), ImageMagick Icon Regeneration Recipe, Icons Rendered from the Mark, Never the Lockup, web.dev Maskable Icon Spec, Maskable Icon Safe Zone (Centre 80%)

### Community 89 - "Backend Package Identity"
Cohesion: 0.40
Nodes (4): name, private, type, version

## Ambiguous Edges - Review These
- `decideAgent()` → `updateClient()`  [AMBIGUOUS]
  backend/src/modules/clients/clients.repository.ts · relation: semantically_similar_to
- `STATUS_TONE` → `CLIENT_STAGE_COLORS`  [AMBIGUOUS]
  frontend/src/components/charts/chartTheme.ts · relation: conceptually_related_to
- `UnitGatewayScreen()` → `Two-layer focus ring (border tighten + wide soft ring)`  [AMBIGUOUS]
  frontend/src/app/login/page.tsx · relation: implements
- `Deleted UNIT_PENDING / unit-login Flow` → `TESTING.md Manual E2E Checklist`  [AMBIGUOUS]
  TESTING.md · relation: conceptually_related_to
- `Derived State via useMemo` → `Known Debt Register`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to
- `Manual's Navy and Gold Print Palette` → `Dark-Tab Contrast Trade-off (2.15:1)`  [AMBIGUOUS]
  frontend/public/icons/README.md · relation: conceptually_related_to
- `Abstract swirling ribbon glyph resembling a stylised 'P' / spiral crescent` → `Application surfaces: login card masthead, ticket pass, PWA app icon, printed passes`  [AMBIGUOUS]
  docs/assets/logo-mark.png · relation: conceptually_related_to
- `Pravasi Sangama 2026 E-Ticketing & Gate Management System` → `Pre-logo-change navy/gold brand palette retired from the app UI`  [AMBIGUOUS]
  docs/assets/managed-by.png · relation: conceptually_related_to
- `Abstract layered ribbon swirl mark — overlapping violet strokes forming a stylised 'D'/wave, reading as confluence of streams` → `Overline 'S A N G A M A' — amber/orange, widely letterspaced uppercase`  [AMBIGUOUS]
  frontend/public/Pravasi-sangama-Photoroom.png · relation: conceptually_related_to
- `Wordmark 'PRAVASI' — heavy geometric sans, dark navy-violet ink` → `Violet ink family in the artwork (bright violet through deepest near-black violet) — matches brand-violet #5E17EB / #37098C / #2E0775`  [AMBIGUOUS]
  frontend/public/Pravasi-sangama-Photoroom.png · relation: semantically_similar_to
- `Abstract calligraphic swirl glyph — layered ribbon spiral on transparent ground` → `Source of the brand violet tokens (#5E17EB / #37098C / #2E0775)`  [AMBIGUOUS]
  frontend/public/Pravasi-sangama-mark.png · relation: semantically_similar_to
- `Abstract calligraphic swirl glyph — layered ribbon spiral on transparent ground` → `Application surfaces — login card, ticket pass, PWA icon, print/PDF chrome`  [AMBIGUOUS]
  frontend/public/Pravasi-sangama-mark.png · relation: semantically_similar_to
- `iOS home-screen platform surface, wired via Next.js metadata.icons.apple` → `The Pravasi Sangama swoosh — an abstract looping ribbon in brand violet (#5E17EB) through violet-deep/near-black, cropped from the full logo lockup because the lockup is unreadable below ~64px`  [AMBIGUOUS]
  frontend/public/icons/apple-touch-icon.png · relation: conceptually_related_to
- `Ribbon crescent brand mark - layered flowing stroke forming an open sweep with an inward curl, reading as a stylised wave or migratory motif` → `PWA installed-app identity - the home-screen and app-switcher face of the Pravasi Sangama 2026 gate scanner shell, referenced from the web app manifest`  [AMBIGUOUS]
  frontend/public/icons/icon-512.png · relation: conceptually_related_to
- `Pravasi Sangama brand mark — abstract flowing ribbon/spiral glyph rendered in stacked violet tones with black core strokes and lavender highlights` → `Installed-app identity — the gate scanner runs as an installed PWA on shared phones, so these icons are how staff find the app on a home screen`  [AMBIGUOUS]
  frontend/src/app/icon.png · relation: conceptually_related_to
- `Next.js App Router icon file convention — icon.png and apple-icon.png inside app/ are auto-emitted as <link rel="icon"> and apple-touch-icon with no manual head markup` → `Installed-app identity — the gate scanner runs as an installed PWA on shared phones, so these icons are how staff find the app on a home screen`  [AMBIGUOUS]
  frontend/src/app/apple-icon.png · relation: conceptually_related_to

## Knowledge Gaps
- **521 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+516 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `decideAgent()` and `updateClient()`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `STATUS_TONE` and `CLIENT_STAGE_COLORS`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `UnitGatewayScreen()` and `Two-layer focus ring (border tighten + wide soft ring)`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **What is the exact relationship between `Deleted UNIT_PENDING / unit-login Flow` and `TESTING.md Manual E2E Checklist`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Derived State via useMemo` and `Known Debt Register`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Manual's Navy and Gold Print Palette` and `Dark-Tab Contrast Trade-off (2.15:1)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Abstract swirling ribbon glyph resembling a stylised 'P' / spiral crescent` and `Application surfaces: login card masthead, ticket pass, PWA app icon, printed passes`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._