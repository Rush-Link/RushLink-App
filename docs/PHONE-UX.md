# Phone workspace

The phone interface uses the same app and Wi-Fi connection flow as tablets.
Narrow screens use a full-width workspace, compact logo/menu header and a closed
dropdown navigation below the header, closed by default. Selecting a destination closes the menu; Escape
closes it with a keyboard, focus stays inside while open and returns to the menu
button when closed. Support me remains the last navigation item.

Wider landscape screens use the tablet's compact labelled navigation rail. The
interface follows available CSS width, so editors and dialogs adapt during
rotation without discarding local edits. The normal status footer is hidden;
pending changes and the audition session remain reachable from the phone header.

Phones share collapsible Rig Editor, StageHand and ToneMod controls, collapsible
Reference Run, touch setlist ordering and individually selected Performance
Tools. Settings use two navigation columns and forms stack for narrow widths.
Save dialogs keep their actions visible with an independently scrolling body.
StageHand fullscreen retains only the performance buttons and lock/exit strip.

Run `npm run test:phone`, or use **Tasks: Run Task → RushLink: Check phone layouts
and rotation** in VS Code. This uses the development server and browser emulation;
it does not build an installer or contact a HeadRush.

The matrix covers 320×568, 360×640, 375×812, 390×844, 412×915 and 430×932 CSS pixels
in both orientations. Layout checks visit all eleven workspaces (132 screen
configurations), checking overflow and touch targets. Workflow checks cover
rotation with open inspectors, StageHand lock/fullscreen, unsaved NAM/rig forms,
reduced-height keyboard space, Reference Run, the full editor, Global EQ selection
and dropdown navigation/focus. Existing tablet tests provide regression coverage.

Browser emulation does not verify native Android system bars, keyboard behaviour
or a physical phone. Those checks require a future native build; builds and
releases remain paused at the user's request.

Validation on 12 September 2026 passed all 66 combined phone/tablet browser tests,
56 affected UI/style regression tests and no-emit TypeScript checking. Following
the final phone header and Settings adjustments, all 18 phone tests passed again.
Final screenshots are under `release-artifacts/phone-final/`; the combined run is
under `release-artifacts/phone-tablet-final/`.

Phone simplification follow-up: Overview uses three horizontally snapping sections with tappable dots; ToneMod shows one result card at a time. Dot navigation shows at most five targets with an active page count, and scrolls through all available results. Each section can scroll vertically. Native scrolling is retained, with a settling fallback to avoid stopping between pages; reduced-motion preferences are respected. Opening block/audition controls gives them the phone workspace and closing them returns to the chain/catalogue. Secondary provider/status copy is hidden on phones. Tablet and desktop grids remain available at their existing breakpoints.

`test:phone` also includes touch swipe, dot navigation, vertical scrolling, dropdown placement and catalogue pagination checks in `e2e/phone-paging.spec.ts`.

The follow-up passed all 21 phone browser checks and 18 tablet layout checks.
The initial affected UI suite passed 82 tests; after the final settling changes,
all 72 app/ToneMod/style checks passed again, as did no-emit TypeScript checking.
Final screenshots are in `release-artifacts/phone-smooth-final/`. Phone catalogue
filters are collapsed behind Filters, and the toolbar is compact enough to show
a complete result card at 320×740. Builds and releases remain paused.
