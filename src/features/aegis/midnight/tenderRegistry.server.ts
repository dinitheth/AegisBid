/**
 * Shared tender registry: the missing piece for global discovery.
 *
 * Published tenders live on-chain under addresses nobody else knows, and
 * device localStorage never leaves the browser — so without this, nobody
 * but the publisher ever sees a new opportunity. These server functions
 * keep one shared newest-first list (Upstash Redis REST; no vendor SDK, so
 * it runs on Vercel serverless and the VPS alike):
 *
 * - `registerTender` — called best-effort right after a successful
 *   on-chain deploy. Never throws to the UI.
 * - `listRegistryTenders` — merged into every directory load.
 *
 * Setup: `TENDER_REGISTRY_URL` (Upstash REST base, e.g.
 * `https://xxx.upstash.io`) + `TENDER_REGISTRY_TOKEN`. When unset, both
 * functions degrade gracefully (register is a no-op, list returns []) and
 * the app behaves exactly as before: flagship + device-local publishes.
 */
import { createServerFn } from "@tanstack/react-start";
import { isValidPublishedTender, type PublishedTender } from "../chain";

const REGISTRY_KEY = "aegis:published-tenders:v1";
const REGISTRY_CAP = 100;

function registryConfig(): { url: string; token: string } | null {
  const url = process.env["TENDER_REGISTRY_URL"];
  const token = process.env["TENDER_REGISTRY_TOKEN"];
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(path: string, init?: RequestInit): Promise<unknown> {
  const config = registryConfig();
  if (!config) throw new Error("Tender registry is not configured.");
  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.token}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Registry request failed [${response.status}].`);
  return (await response.json()) as unknown;
}

function toPublishedTender(raw: unknown): PublishedTender | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidPublishedTender(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const listRegistryTenders = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const payload = (await redis(`/lrange/${REGISTRY_KEY}/0/${REGISTRY_CAP - 1}`)) as {
      result?: unknown;
    };
    const items = Array.isArray(payload.result) ? payload.result : [];
    // Stored oldest-first (RPUSH); newest first for readers.
    const tenders: PublishedTender[] = [];
    for (const item of items) {
      const tender = toPublishedTender(item);
      if (tender) tenders.unshift(tender);
    }
    // Registry data predates V2. Keep historical V1 records out of the
    // product while retaining them untouched in the underlying registry.
    return tenders.filter((tender) => tender.contractVersion === 2);
  } catch {
    return [];
  }
});

export const registerTender = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as PublishedTender)
  .handler(async ({ data }) => {
    try {
      if (!isValidPublishedTender(data)) return { ok: false };
      await redis(`/rpush/${REGISTRY_KEY}/${encodeURIComponent(JSON.stringify(data))}`, {
        method: "POST",
      });
      await redis(`/ltrim/${REGISTRY_KEY}/0/${REGISTRY_CAP - 1}`, { method: "POST" });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
