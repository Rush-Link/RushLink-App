export const loadDashboardPage = () => import("./pages/dashboard");
export const loadEditorPage = async () => {
  const [page] = await Promise.all([
    import("./pages/editor"),
    import("./styles/editor-upgrades.css"),
    import("./styles/editor-workflows.css"),
    import("./styles/signal-canvas.css"),
    import("./styles/history-preview.css"),
    import("./styles/routing-node-editor.css"),
    import("./styles/device-file-picker.css"),
    import("./styles/block-eq.css"),
    import("./styles/block-catalogue-readable.css"),
    // The editor embeds the same Footswitch, Scene and Expression workspaces
    // as the standalone assignment route, so their styles are route
    // dependencies here as well.
    import("./styles/assignments-upgrades.css"),
    import("./styles/assignment-studio.css"),
    import("./styles/expression-studio.css"),
  ]);
  return page;
};
export const loadRigsPages = async () => {
  const [page] = await Promise.all([import("./pages/rigs-setlists"), import("./styles/device-library.css"), import("./styles/setlist-device-data.css")]);
  return page;
};
export const loadStageHandPage = async () => {
  const [page] = await Promise.all([import("./pages/live-play"), import("./styles/live-tone.css"), import("./styles/stagehand-v2.css")]);
  return page;
};
export const loadTonePilotPage = async () => {
  const [page] = await Promise.all([import("./pages/tone-lab"), import("./styles/live-tone.css"), import("./styles/tonepilot-upgrades.css"), import("./styles/tonepilot-lab.css")]);
  return page;
};
export const loadPerformancePage = async () => {
  const [page] = await Promise.all([import("./pages/performance-studio"), import("./styles/performance-tools.css"), import("./styles/performance-modern.css"), import("./styles/drum-preset-dialog.css"), import("./styles/device-tuner-controls.css")]);
  return page;
};
export const loadLibraryPage = async () => {
  const [page] = await Promise.all([import("./pages/library-backup"), import("./styles/backup-modern.css"), import("./styles/device-index-browser.css")]);
  return page;
};
export const loadSystemPages = async () => {
  const [page] = await Promise.all([import("./pages/system-pages"), import("./styles/shared-midi.css")]);
  return page;
};
export const loadAssignmentsPage = async () => {
  const [page] = await Promise.all([import("./pages/assignments"), import("./styles/assignments-upgrades.css"), import("./styles/assignment-studio.css"), import("./styles/expression-studio.css")]);
  return page;
};

const loaderFor = (page: string) => {
  if (page === "dashboard") return loadDashboardPage;
  if (page === "editor") return loadEditorPage;
  if (page === "rigs" || page === "setlists") return loadRigsPages;
  if (page === "live") return loadStageHandPage;
  if (page === "tone-cloud") return loadTonePilotPage;
  if (page === "tools") return loadPerformancePage;
  if (page === "library") return loadLibraryPage;
  if (page === "settings" || page === "diagnostics") return loadSystemPages;
  if (page === "assignments") return loadAssignmentsPage;
  return loadDashboardPage;
};

/** Begin fetching a workspace before it is selected. Browser module imports are
 * cached, so calling this on hover/focus makes the eventual navigation instant. */
export const preloadPage = (page: string) => loaderFor(page)();
