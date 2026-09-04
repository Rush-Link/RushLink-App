export type DeviceErrorCode =
  | "offline"
  | "timeout"
  | "http"
  | "rejected"
  | "invalid-request"
  | "invalid-response"
  | "unavailable"
  | "unknown";

export interface DeviceErrorOptions {
  action?: string;
  status?: number;
  cause?: unknown;
  recoverable?: boolean;
  technicalMessage?: string;
}

export class DeviceError extends Error {
  readonly code: DeviceErrorCode;
  readonly action?: string;
  readonly status?: number;
  readonly recoverable: boolean;
  readonly technicalMessage?: string;

  constructor(code: DeviceErrorCode, message: string, options: DeviceErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "DeviceError";
    this.code = code;
    this.action = options.action;
    this.status = options.status;
    this.recoverable = options.recoverable ?? ["offline", "timeout", "http", "unavailable"].includes(code);
    this.technicalMessage = options.technicalMessage;
  }
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      if (typeof candidate[key] === "string" && candidate[key].trim()) return candidate[key].trim();
    }
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error || "Unknown device error");
}

function actionPrefix(action?: string) {
  return action ? `${action}: ` : "";
}

export function normalizeDeviceError(error: unknown, action?: string): DeviceError {
  if (error instanceof DeviceError) return error;
  const technicalMessage = rawErrorMessage(error).replace(/^Error:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 500);
  const lower = technicalMessage.toLocaleLowerCase();
  const options = { action, cause: error, technicalMessage };

  if (/timed? out|timeout|deadline elapsed/.test(lower)) {
    return new DeviceError("timeout", `${actionPrefix(action)}the HeadRush took too long to respond. Check its network connection and try again.`, options);
  }
  if (/no headrush device is connected|not connected/.test(lower)) {
    return new DeviceError("offline", `${actionPrefix(action)}connect to your HeadRush and try again.`, options);
  }
  if (/connection refused|failed to connect|network is unreachable|host is unreachable|dns|name or service not known|could not resolve|connection reset|broken pipe|offline/.test(lower)) {
    return new DeviceError("offline", `${actionPrefix(action)}the HeadRush is not reachable. Confirm that both devices are on the same network.`, options);
  }
  if (/unavailable|not supported|unsupported/.test(lower)) {
    return new DeviceError("unavailable", `${actionPrefix(action)}this feature is not available right now.`, options);
  }
  const statusMatch = /(?:http|status)\s*(\d{3})/i.exec(technicalMessage);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401 || status === 403) return new DeviceError("rejected", `${actionPrefix(action)}the HeadRush refused this operation. Check the device session and try again.`, { ...options, status, recoverable: false });
    if (status === 404) return new DeviceError("unavailable", `${actionPrefix(action)}this feature is not available on the connected firmware.`, { ...options, status });
    if (status === 409 || status === 423) return new DeviceError("rejected", `${actionPrefix(action)}the HeadRush is busy or the current state prevents this change.`, { ...options, status });
    if (status >= 500) return new DeviceError("http", `${actionPrefix(action)}the HeadRush reported an internal error. Wait a moment and try again.`, { ...options, status });
    return new DeviceError("http", `${actionPrefix(action)}the HeadRush could not complete the request.`, { ...options, status });
  }
  if (/invalid|must be|not allowed|restricted/.test(lower)) {
    return new DeviceError("invalid-request", `${actionPrefix(action)}the requested change is not valid for the current device state.`, { ...options, recoverable: false });
  }
  if (/rejected|refused|incompatible/.test(lower)) {
    return new DeviceError("rejected", technicalMessage || `${actionPrefix(action)}the HeadRush rejected this operation.`, { ...options, recoverable: false });
  }
  return new DeviceError("unknown", technicalMessage || `${actionPrefix(action)}the device operation failed.`, options);
}

export function invalidDeviceResponse(action: string, expected: string, value?: unknown): DeviceError {
  const received = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  return new DeviceError("invalid-response", `${action}: the HeadRush returned incomplete data. Refresh the device and try again.`, {
    action,
    recoverable: true,
    technicalMessage: `Expected ${expected}; received ${received}`,
  });
}

export function deviceErrorMessage(error: unknown, action?: string): string {
  return normalizeDeviceError(error, action).message;
}

export function deviceErrorDetail(error: unknown, action?: string): string {
  const normalized = normalizeDeviceError(error, action);
  return normalized.technicalMessage && normalized.technicalMessage !== normalized.message
    ? `${normalized.message} (${normalized.technicalMessage})`
    : normalized.message;
}
