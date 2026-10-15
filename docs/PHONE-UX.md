# Phone workspace

The phone interface uses the same app and Wi-Fi connection flow as tablets. Narrow screens have a full-width workspace, compact logo/menu header and a dropdown navigation that starts closed. Selecting a destination closes it; Escape closes it with a keyboard. Focus stays inside the open menu and returns to its button when closed.

Wider landscape screens use the tablet's compact labelled navigation rail. The interface follows available CSS width, so editors and dialogs adapt during rotation without discarding local edits. Pending changes and the audition session remain reachable from the phone header.

## Workspace behavior

- Overview uses horizontally snapping sections with tappable dots. ToneMod shows one result card at a time, with a page count and up to five dot targets.
- Sections can scroll vertically. Native scrolling has a settling fallback, and reduced-motion preferences are respected.
- Rig Editor, StageHand, ToneMod controls and Reference Run can collapse. Opening block/audition controls gives them the phone workspace; closing them returns to the chain/catalogue.
- Setlists support touch ordering. Performance Tools are individually selected, Settings forms stack, and save dialogs keep actions visible around an independently scrolling body.
- ToneMod filters collapse behind **Filters**, and secondary provider/status copy is hidden on narrow screens.
- StageHand fullscreen retains the performance buttons and lock/exit strip.

Tablet and desktop layouts remain available at their existing breakpoints.

## Check the interface

```sh
npm run test:phone
```

The phone browser suite covers portrait/landscape layouts, rotation with open editors, StageHand lock/fullscreen, save forms, reduced-height keyboard space, navigation/focus, touch swipes, dot navigation, scrolling and catalogue pagination. Its viewport definitions and assertions live in `e2e/phone-*.spec.ts`; use those files as the maintained test matrix.

These checks use Chromium emulation and start the local development server. They do not build an installer or contact a HeadRush. Browser emulation does not verify native Android system bars, keyboard behavior, WebView differences or physical-device networking.

Use `npm run phone` for the native Android phone emulator workflow; see [WORKFLOW.md](WORKFLOW.md). Real Wi-Fi discovery, saving, audio and MIDI behavior still need physical-device tests. See [TESTING.md](TESTING.md) for reporting hardware evidence and choosing other relevant checks.
