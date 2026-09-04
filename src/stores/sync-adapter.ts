import { assertRushLinkSyncDocument, createRushLinkSyncDocument, portablePatchFromSyncDocument, type RushLinkSyncDocument } from "../domain/rushlink-sync";
import { migratePersistedTestRigIrFiles, useAppStore } from "./app-store";

export function captureRushLinkSyncDocument(accountId: string, clientId: string, previous?: RushLinkSyncDocument | null, now?: string) {
  return createRushLinkSyncDocument(useAppStore.getState(), { accountId, clientId, previous, now });
}

export function applyRushLinkSyncDocument(value: unknown) {
  assertRushLinkSyncDocument(value);
  const state = useAppStore.getState();
  const patch = portablePatchFromSyncDocument(value, state.liveStages);
  const { sidebarCollapsed: _sidebarCollapsed, ...interfacePreferences } = patch.preferences;
  useAppStore.setState({
    liveStages: patch.liveStages, selectedLiveStageId: patch.selectedLiveStageId, liveLayout: patch.liveLayout,
    testRigs: migratePersistedTestRigIrFiles(patch.testRigs), selectedTestRigId: patch.selectedTestRigId,
    testRigSets: patch.testRigSets, selectedTestRigSetId: patch.selectedTestRigSetId,
    favoriteRigIds: patch.favoriteRigIds, favoriteToneIds: patch.favoriteToneIds, favoriteBlockNames: patch.favoriteBlockNames,
    favoriteLiveControlKeys: patch.favoriteLiveControlKeys, liveControlPresets: patch.liveControlPresets,
    preferences: { ...state.preferences, ...interfacePreferences }, sidebarCollapsed: patch.sidebarCollapsed,
    savedWorkflows: patch.savedWorkflows,
  });
  return value;
}
