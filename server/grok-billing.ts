import { fetchWithQuotaProxy, type Fetcher } from "./quota-http.ts";

// Field identities verified against Grok's public billing descriptor:
// https://cdn.grok.com/_next/static/chunks/32g78bk5hhe1q.js
// response.config=1; config.credit_usage_percent=1 (float), current_period=8.
// UsagePeriod: type=1, start=2, end=3; google.protobuf.Timestamp: seconds=1, nanos=2.
type Field = { number: number; wire: number; integer?: bigint; bytes?: Uint8Array; float?: number };
function fields(bytes: Uint8Array): Field[] {
  let offset = 0;
  const varint = (): bigint => {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= bytes.length) throw new Error("truncated protobuf");
      const byte = bytes[offset++]!;
      if (i === 9 && byte > 1) throw new Error("overflowing protobuf");
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    }
    throw new Error("overflowing protobuf");
  };
  const output: Field[] = [];
  while (offset < bytes.length) {
    const tag = varint(), number = Number(tag >> 3n), wire = Number(tag & 7n);
    if (number < 1 || number > 536870911) throw new Error("invalid protobuf tag");
    const field: Field = { number, wire };
    if (wire === 0) field.integer = varint();
    else if (wire === 2) {
      const size = varint();
      if (size > BigInt(bytes.length - offset)) throw new Error("truncated protobuf message");
      field.bytes = bytes.subarray(offset, offset + Number(size)); offset += Number(size);
    } else if (wire === 5 || wire === 1) {
      const size = wire === 5 ? 4 : 8;
      if (offset + size > bytes.length) throw new Error("truncated protobuf scalar");
      if (wire === 5) field.float = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
      offset += size;
    } else throw new Error("unsupported protobuf wire type");
    output.push(field);
  }
  return output;
}
function one(list: Field[], number: number, wire: number): Field | undefined {
  const matches = list.filter((f) => f.number === number);
  if (matches.length > 1 || (matches.length && matches[0]!.wire !== wire)) throw new Error("ambiguous protobuf field");
  return matches[0];
}
function timestamp(field: Field | undefined): number | null {
  if (!field?.bytes) return null;
  const list = fields(field.bytes), seconds = one(list, 1, 0)?.integer, nanos = one(list, 2, 0)?.integer ?? 0n;
  if (seconds == null || seconds > 253402300799n || nanos > 999999999n) return null;
  return Number(seconds) * 1000 + Number(nanos) / 1_000_000;
}
const knownMessages = new Set(["1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.12",
  "1.6.1", "1.6.2", "1.6.3", "1.8.2", "1.8.3", "1.6.3.2", "1.6.3.3"]);
function hasFloat(list: Field[], path = ""): boolean {
  let found = false;
  for (const field of list) {
    if (field.wire === 5) found = true;
    const next = path ? `${path}.${field.number}` : String(field.number);
    // Unknown bytes are opaque, not arbitrarily interpreted as nested billing data.
    if (field.bytes && knownMessages.has(next)) found = hasFloat(fields(field.bytes), next) || found;
  }
  return found;
}
export type GrokBillingReading = { usedPercent: number; resetAt: number | null; startAt: number | null; implicitZero: boolean };

/** A complete successful gRPC response, not a period-only REST answer, can carry proto3 zero. */
export function parseGrokBilling(bytes: Uint8Array, now = Date.now()): GrokBillingReading | null {
  try {
    if (!bytes.length || bytes.length > 2_000_000) return null;
    let offset = 0, payload: Uint8Array | undefined, successful = false;
    while (offset < bytes.length) {
      if (offset + 5 > bytes.length) return null;
      const flags = bytes[offset]!, size = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0);
      offset += 5;
      if (offset + size > bytes.length) return null;
      const frame = bytes.subarray(offset, offset + size); offset += size;
      if (flags === 0) { if (payload) return null; payload = frame; }
      else if (flags === 128) {
        if (offset !== bytes.length) return null;
        const statuses = [...new TextDecoder().decode(frame).matchAll(/(?:^|\r?\n)grpc-status:\s*(\d+)/gi)];
        if (statuses.length !== 1 || statuses[0]![1] !== "0" || successful) return null;
        successful = true;
      } else return null; // Compressed/unknown frames do not qualify.
    }
    if (!successful || !payload) return null;
    const root = fields(payload), configField = one(root, 1, 2);
    if (!configField?.bytes) return null;
    const config = fields(configField.bytes);
    const percent = one(config, 1, 5)?.float;
    const periodField = one(config, 8, 2);
    const period = periodField?.bytes ? fields(periodField.bytes) : [];
    const kind = one(period, 1, 0)?.integer;
    const start = timestamp(one(period, 2, 2)), end = timestamp(one(period, 3, 2));
    const anyFloat = hasFloat(root); // Also validates every schema-declared nested message.
    if (percent != null) {
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
      return { usedPercent: percent, resetAt: end, startAt: start, implicitZero: false };
    }
    if (!anyFloat && (kind === 1n || kind === 2n) && start != null && end != null && start <= now && now < end) {
      return { usedPercent: 0, resetAt: end, startAt: start, implicitZero: true };
    }
    return null;
  } catch { return null; }
}

export async function fetchGrokBillingFallback(token: string, fetcher: Fetcher, signal: AbortSignal): Promise<GrokBillingReading | null> {
  try {
    const response = await fetchWithQuotaProxy(fetcher, "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig", {
      method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/grpc-web+proto", "X-Grpc-Web": "1", "X-XAI-Token-Auth": "xai-grok-cli" },
      // exclude_legacy_monthly_usage=false; read-only, never redeem or reset credits.
      body: new Uint8Array([0, 0, 0, 0, 2, 8, 0]),
    });
    if (!response.ok || (response.headers.has("grpc-status") && response.headers.get("grpc-status") !== "0")) return null;
    return parseGrokBilling(new Uint8Array(await response.arrayBuffer()));
  } catch { return null; }
}
