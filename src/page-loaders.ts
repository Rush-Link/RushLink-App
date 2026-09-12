export const loadDashboardPage = () => import("./pages/dashboard");
export const loadEditorPage = () => import("./pages/editor");
export const loadRigsPages = () => import("./pages/rigs-setlists");
export const loadStageHandPage = () => import("./pages/live-play");
export const loadToneModPage = () => import("./pages/tone-lab");
export const loadPerformancePage = () => import("./pages/performance-studio");
export const loadLibraryPage = () => import("./pages/library-backup");
export const loadSystemPages = () => import("./pages/system-pages");
export const loadAssignmentsPage = () => import("./pages/assignments");

const loaderFor = (page: string) => {
  if (page === "dashboard") return loadDashboardPage;
  if (page === "editor") return loadEditorPage;
  if (page === "rigs" || page === "setlists") return loadRigsPages;
  if (page === "live") return loadStageHandPage;
  if (page === "tone-cloud") return loadToneModPage;
  if (page === "tools") return loadPerformancePage;
  if (page === "library") return loadLibraryPage;
  if (page === "settings" || page === "diagnostics") return loadSystemPages;
  if (page === "assignments") return loadAssignmentsPage;
  return loadDashboardPage;
};

/** Begin fetching a workspace before it is selected. Browser module imports are
 * cached, so calling this on hover/focus makes the eventual navigation instant. */
export const preloadPage = (page: string) => loaderFor(page)();
