import type { DeviceModel } from "./types";

export const MODEL_LOCAL_ADDRESSES: Record<DeviceModel, string> = {
  "Prime Flex": "headrushflexprime.local",
  Prime: "headrushprime.local",
  Core: "headrushcore.local",
};

export function isIpAddress(address: string): boolean {
  if (/^[0-9a-f]*:[0-9a-f:]+(?:%[\w.-]+)?$/i.test(address.trim())) return true;
  try {
    const host = new URL(address.includes("://") ? address : `http://${address}`).hostname;
    return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[");
  } catch { return false; }
}

/** Saved IPs are an explicit fallback, never the next startup's first choice. */
export function primaryConnectionAddress(address: string, modelAddress?: string): string {
  if (!isIpAddress(address)) return address;
  return Object.values(MODEL_LOCAL_ADDRESSES).includes(modelAddress ?? "") ? modelAddress! : MODEL_LOCAL_ADDRESSES["Prime Flex"];
}
