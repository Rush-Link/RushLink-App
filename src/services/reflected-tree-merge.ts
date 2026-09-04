export function equalDeviceValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => equalDeviceValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && equalDeviceValue(leftRecord[key], rightRecord[key]));
}

export function mergeReflectedTree<T extends Record<string, { value?: Record<string, unknown> }>>(
  current: T,
  updates: ReadonlyArray<readonly [string, Record<string, unknown>]>,
): { tree: T; changed: boolean } {
  let tree: Record<string, { value?: Record<string, unknown> }> = current;
  let changed = false;
  for (const [path, value] of updates) {
    const object = current[path];
    if (object && equalDeviceValue(object.value, value)) continue;
    if (!changed) tree = { ...current };
    tree[path] = { ...(object ?? {}), value } as T[string];
    changed = true;
  }
  return { tree: tree as T, changed };
}
