# Tablet UI and UX audit

Completed 12 September 2026. Reviewed all eleven app routes, their main secondary workspaces, navigation, connection setup and key dialogs. Findings below have been addressed in source. Builds and releases remain paused.

| Area | Finding | Change |
| --- | --- | --- |
| Shared controls | Many buttons, switches and filters used desktop-sized touch targets. | Common actions and the inspected custom controls now provide at least 44px targets; switch tracks stay visually compact. |
| Navigation | An expanded menu changes the usable width substantially. Large touch tablets also need compact defaults. | Workspace layouts respond to the content width. Optional panels default closed on coarse-pointer devices as well as smaller screens. |
| Rig Editor | Opening controls in portrait widened the grid and pushed Save beyond the viewport. | Removed intrinsic grid overflow. Narrow layouts put controls above the chain, with a bounded scroll area and an accessible close button. Selecting a block reveals its controls. |
| Rigs and setlists | Repeated summaries, tall artwork and stacked filters delayed access to the rig list. | Compacted summaries and artwork, grouped search controls, and enlarged card actions. List view also adapts to a narrow workspace. |
| StageHand | The toolbar could overflow with navigation expanded; gesture and MIDI captions competed inside pads. | Wrapped toolbar actions, improved subtitle readability and removed MIDI numbers from performance pads. MIDI details remain available while editing. |
| ToneMod | Repeated provider explanations and oversized result headers displaced the catalogue. | Shortened the visible headers, reduced artwork height, enlarged filters and favourites, and kept audition controls accessible in a bounded panel. |
| Test Rig Studio | Reference Run and the full editor included small selection controls and switches. | Enlarged selection/category controls and switches; retained the collapsible Reference Run and full-width chain when closed. |
| Hardware assignments | Scene on/off/preset controls and colour choices were too small for reliable touch input. | Enlarged controls and scene cards, kept the signal chain within its own horizontal scroller, and wrapped colour choices. |
| Performance Tools | Tuner and Global EQ required scrolling past the drummer. | Added tablet tool selectors. Switching views preserves tuner operation, drummer state and EQ choices, with active/playing indicators. |
| Settings | A second vertical sidebar consumed much of the portrait workspace. | Replaced it with a compact section grid and gave settings the full content width. |
| Library and backup | Device Index path controls could overflow; restore actions were cramped. | Reflowed file categories and path controls, retained room for the editable path, and enlarged restore actions. |
| Overview and diagnostics | Secondary actions used small targets; headings consumed unnecessary space. | Applied shared spacing, wrapping and touch improvements. |
| Dialogs and keyboard use | Long forms needed reliable access to dismissal and completion actions. | Kept dialog headers and footers visible while their bodies scroll. Verified focus return on panel collapse and Performance Tools viewport changes. |

Validation used isolated Chromium contexts with external requests blocked, demo content and synthetic populated device data. Tablet sizes included 768×1024, 820×1180, 1024×768, 1280×800 and 1440×900 with touch enabled, plus 1280×500 to stress short viewports. Expanded navigation, portrait and landscape, nested scrolling, open controls, filters, Reference Run, tuner, EQ and dialogs were inspected. Desktop 1440×900 and phone 390×844 received compatibility checks.

The workspace regression suite passed **191 tests**. The final Performance Tools focus adjustment passed its **10 focused tests**, and the no-emit TypeScript check passed. Browser interaction checks passed at five viewport sizes, including NAM and whole-rig save dialogs, visible footer actions, touch navigation and panel focus return. Save-dialog inspection made no device writes.

Screenshots, measurements and browser scripts are retained locally under `release-artifacts/tablet-ux-audit/`. Early passes record the original findings; `populated`, `final-details`, `final-tone`, `final-stage`, `final-assignments` and `interactions` contain verification evidence for the subsequent fixes.

This audit validates the source UI in browser tablet emulation. Native Android keyboard/insets, hardware touch ergonomics and device-connected end-to-end behaviour still need checking in an installed app after the next authorised build. No APK, native installer, production bundle, GitHub workflow or release was created during this audit.

StageHand lock and full screen follow-up, 12 September 2026: locking now exits layout editing, cancels moves and MIDI learn, disables empty slots and stage creation/duplication, and blocks layout mutations in the store. Context-menu removal also respects the lock. Performance pads, stage selection and incoming performance MIDI remain available. Unlocking allows editing again; the saved stage retains its lock when reopened.

Full screen now gives StageHand the app workspace, removes the shell navigation and bars, expands the performance board, and keeps Exit reachable. Desktop Tauri uses its native window command with the required capability. Browsers use the document fullscreen API, preserving portalled dialogs. If system fullscreen is unavailable or rejected, StageHand still fills the app and explains the limitation; OS bars may remain. Exit, Escape, external fullscreen changes, rapid taps, failed-exit retries and leaving the page have dedicated checks. Native desktop transitions and Android OS bar hiding still require an installed-app check after builds resume.

The follow-up passed 192 StageHand regression tests and 43 app-shell, context-menu and stylesheet checks; the final locked-slot adjustment passed its 36 affected page tests. The no-emit TypeScript check passed. Six isolated browser scenarios passed: tablet portrait 820×1180, landscape 1280×800, short viewport 1280×500, desktop 1440×900, phone 390×844 and tablet with system fullscreen unavailable. Checks cover touch lock/unlock, live pad dispatch, blocked empty slots, board sizing, dialogs, Exit, Escape and navigation cleanup. Browser performance actions were stubbed and external requests blocked; no HeadRush writes occurred. Evidence is retained under `release-artifacts/stagehand-screen-check/`. Builds and releases remain paused.

Size and orientation coverage follow-up, 12 September 2026: the repeatable browser suite now covers nine tablet profiles in both portrait and landscape. These are CSS viewport dimensions with touch enabled, rather than physical screen resolutions.

| Portrait | Landscape |
| --- | --- |
| 600 × 960 | 960 × 600 |
| 640 × 1024 | 1024 × 640 |
| 768 × 1024 | 1024 × 768 |
| 800 × 1280 | 1280 × 800 |
| 820 × 1180 | 1180 × 820 |
| 834 × 1194 | 1194 × 834 |
| 900 × 1440 | 1440 × 900 |
| 1024 × 1366 | 1366 × 1024 |
| 1200 × 1600 | 1600 × 1200 |

All eleven routes are checked at all eighteen sizes with navigation collapsed and expanded: 396 workspace configurations. Checks cover tablet shell defaults, horizontal overflow and enabled touch targets. Rotation journeys preserve open inspectors, StageHand edits and lock/fullscreen state, unsaved NAM and whole-rig names, Reference Run, the Test Rig Studio editor, selected Performance Tools and navigation state. NAM dialogs also receive 400px-height checks to simulate reduced space while a keyboard is open. Phone and mouse breakpoints have separate compatibility checks. The tests use synthetic content and block external requests; they do not save to HeadRush.

The expanded matrix exposed and fixed small touch tablets incorrectly receiving phone navigation, the collapsed rail disappearing below 761px, and backup tabs overflowing with navigation expanded. Tablet mode now includes coarse-pointer widths from 600px while preserving phone and mouse behaviour. Final visual inspection also led to separating Global EQ status, plot summary, frequency labels and empty-state text, and wrapping its controls according to the remaining workspace width.

The website's index, about and privacy pages are checked at the same eighteen sizes. Its menu previously left scrolling locked after rotating into desktop navigation; the breakpoint transition now closes the menu and handles focus. This website fix was pushed and deployed successfully in commit `cef2d24`.

Run `npm run test:tablet`, or the VS Code task **RushLink: Check tablet layouts and rotation**, to repeat the checks without an installer build. The full suite passed 39 tests; the public website checkout separately passed its nine matrix tests and existing validator. The no-emit TypeScript check and 54 relevant app regression tests passed. After the final EQ adjustment, all 12 rotation/boundary tests and 18 stylesheet checks passed again. The published website also passed direct small-tablet rotation checks on index/about and portrait/landscape checks on privacy, which uses direct navigation links. Rotation screenshots and measurements are written to `test-results/`, with the browser report in `playwright-report/`.

This extends browser emulation coverage; it does not claim native Android keyboard, system-bar or physical-device verification. App builds and releases remain paused.

Touch workflow improvements, 12 September 2026: a further review focused on tasks that fit on screen but still depended on desktop interaction habits.

| Finding | Applied improvement |
| --- | --- |
| Collapsed navigation required recognising icons or hovering for their names. | The 72px tablet rail now shows short labels below each icon, with 56px actions. Full accessible names and the expanded menu remain available. The navigation scrolls independently on short screens. |
| Setlist ordering relied on HTML drag and drop, with no reliable touch alternative. | Tablets now offer up/down actions for each rig, with disabled controls at the list boundaries and layouts that follow available workspace width. Reordering preserves the complete entries and only changes local state until Save is chosen. Desktop dragging remains available. |
| EQ text, nodes and invisible hit areas shrank with a fixed-width SVG canvas; frequency captions did not follow the logarithmic grid. | Full EQ charts now measure their rendered size and keep text and drag targets at consistent CSS-pixel sizes. The graph responds to rotation, panel width and hidden-tool restoration. Band targets are 48px across and cutoff targets are 44px wide. Frequency captions align with the grid, with fewer ticks on narrow charts. Blank chart space allows vertical scrolling; dragging a handle retains pointer capture. Compact previews retain their small canvas. |

`e2e/tablet-touch.spec.ts` exercises these workflows at all nine tablet profiles in both orientations, including genuine browser touch events on the EQ. It checks that dragging from an off-centre touch point still produces the expected frequency and gain after resizing. Synthetic reflected device data and intercepted writes keep these checks independent of a connected HeadRush. The VS Code tablet task includes these journeys automatically.

Validation passed all 48 tablet browser tests, the no-emit TypeScript check and 57 affected UI/style regression tests. After the final navigation indicator and frequency-caption adjustments, all nine touch journeys passed again, along with 22 EQ/style checks and the no-emit TypeScript check. Final touch screenshots are retained under `release-artifacts/tablet-touch-final/`. No app build, installer, release, device write or website change was made during this follow-up.

Minimal StageHand fullscreen, 12 September 2026: fullscreen now displays only the performance grid and a 44px top strip for lock/unlock and exit. Stage headings, rig information, stage tabs, MIDI/editor actions, helper text and button metadata are hidden. Slot numbers sit in the upper-right corner; button names, icons and functional widgets remain available. The grid fills the remaining viewport, including short landscape layouts, while retaining system safe-area insets. Entering fullscreen cancels layout editing and pending moves. Unlocking does not expose editors or enable empty-slot editing inside fullscreen; Exit restores the normal workspace. Performance actions continue to work. Status announcements remain available to assistive technology without taking up screen space.

Validation passed 12 rotation/boundary browser checks covering all nine tablet profiles, 50 affected StageHand/style regression tests and the no-emit TypeScript check. Screenshots are retained under `release-artifacts/stagehand-minimal-fullscreen/`. Builds and releases remain paused.
