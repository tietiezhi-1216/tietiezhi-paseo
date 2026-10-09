import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGrokBilling } from "../server/grok-billing.ts";
import { fetchProviderQuota } from "../server/quota-providers.ts";

function varint(value: number | bigint): Buffer {
  let remaining = BigInt(value); const bytes: number[] = [];
  do { const byte = Number(remaining & 127n); remaining >>= 7n; bytes.push(byte | (remaining ? 128 : 0)); } while (remaining);
  return Buffer.from(bytes);
}
const integer = (number: number, value: number) => Buffer.concat([varint(number * 8), varint(value)]);
const message = (number: number, bytes: Buffer) => Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
const float = (number: number, value: number) => {
  const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); return Buffer.concat([varint(number * 8 + 5), bytes]);
};
const timestamp = (seconds: number) => integer(1, seconds);
const period = (start: number, end: number, type = 2) => Buffer.concat([integer(1, type), message(2, timestamp(start)), message(3, timestamp(end))]);
function frame(payload: Buffer, flags = 0) {
  const header = Buffer.alloc(5); header[0] = flags; header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}
function response(config: Buffer, status = 0) {
  return Buffer.concat([frame(message(1, config)), frame(Buffer.from(`grpc-status:${status}\r\n`), 128)]);
}
const now = 1_790_000_000_000, seconds = now / 1000;
const active = message(8, period(seconds - 60, seconds + 604800));

test("完整成功的活动周/月账单可按proto3标量默认值解析0，并保留来源", () => {
  for (const type of [1, 2]) {
    const result = parseGrokBilling(response(message(8, period(seconds - 60, seconds + 3600, type))), now);
    assert.equal(result?.usedPercent, 0); assert.equal(result?.implicitZero, true);
    assert.equal(result?.resetAt, now + 3600000);
  }
});
test("已发布的credit percent读取正确，不把产品或任意浮点字段当额度", () => {
  const result = parseGrokBilling(response(Buffer.concat([float(1, 52.5), active])), now);
  assert.equal(result?.usedPercent, 52.5); assert.equal(result?.implicitZero, false);
  assert.equal(parseGrokBilling(response(Buffer.concat([float(14, 70), active])), now), null);
  assert.equal(parseGrokBilling(response(Buffer.concat([message(7, Buffer.concat([integer(1, 2), float(2, 70)])), active])), now), null);
});
test("非活动/未知周期或只有旧时间不能推断为100%", () => {
  for (const p of [period(seconds - 100, seconds - 1), period(seconds + 1, seconds + 3600), period(seconds - 1, seconds + 3600, 0)]) {
    assert.equal(parseGrokBilling(response(message(8, p)), now), null);
  }
  assert.equal(parseGrokBilling(response(message(5, timestamp(seconds + 3600))), now), null);
});
test("错误状态、截断、压缩、非法字段、重复百分比和非有限数均拒绝", () => {
  const good = response(active);
  for (const bytes of [response(active, 16), good.subarray(0, good.length - 1), frame(message(1, active), 1),
    response(Buffer.concat([active, Buffer.from([0])])), response(Buffer.concat([active, float(1, 20), float(1, 40)])),
    response(Buffer.concat([active, float(1, NaN)])), response(Buffer.concat([active, float(1, 101)])),
    response(Buffer.concat([active, message(2, Buffer.from([0]))]))]) {
    assert.equal(parseGrokBilling(bytes, now), null);
  }
});
test("未知bytes保持不透明，不从里面伪造百分比；溢出的varint拒绝", () => {
  assert.equal(parseGrokBilling(response(Buffer.concat([active, message(14, float(1, 99))])), now)?.usedPercent, 0);
  const overflow = Buffer.concat([active, varint(14 * 8), Buffer.alloc(10, 255)]);
  assert.equal(parseGrokBilling(response(overflow), now), null);
});
test("REST缺比例时使用同账号补充接口，只有两个接口周期一致才采用默认零", async () => {
  const liveSeconds = Math.floor(Date.now() / 1000), start = liveSeconds - 60, end = liveSeconds + 604800;
  const binary = response(message(8, period(start, end)));
  const urls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    urls.push(String(url)); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-access");
    if (String(url).includes("GetGrokCreditsConfig")) return new Response(binary, { headers: { "Content-Type": "application/grpc-web+proto" } });
    return new Response(JSON.stringify({ config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() } } }));
  };
  const q = await fetchProviderQuota("xai", { access: "fake-access" }, fetcher, new AbortController().signal);
  assert.equal(q.windows[0].usedPercent, 0); assert.equal(q.windows[0].usageSource, "protobuf-default");
  assert.equal(urls.length, 2);
  await assert.rejects(fetchProviderQuota("xai", { access: "fake-access" }, async (url, init) => {
    if (String(url).includes("GetGrokCreditsConfig")) return fetcher(url, init);
    return new Response(JSON.stringify({ config: { currentPeriod: { start: new Date((start - 3600) * 1000).toISOString(), end: new Date(end * 1000).toISOString() } } }));
  }, new AbortController().signal), /未提供/);
});
