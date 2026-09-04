import type { Rig } from "./types";

/**
 * Resolve persisted RushLink favourite IDs against the library that is
 * currently visible. Favourite IDs may outlive demo data, deleted rigs, or a
 * previously connected pedal, so UI counts must not include unresolved IDs.
 */
export function availableFavoriteRigIds(rigs: Pick<Rig, "id">[], favoriteIds: string[]): string[] {
  const availableIds = new Set(rigs.map((rig) => rig.id));
  return [...new Set(favoriteIds)].filter((id) => availableIds.has(id));
}
