import { createFileRoute } from "@tanstack/react-router";
import {
  resolveIndexerUpstream,
  type IndexerNetwork,
  type IndexerTokens,
} from "../features/aegis/chain";

const MAX_QUERY_BYTES = 64 * 1024;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function serverTokens(): IndexerTokens {
  const read = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  };
  return {
    preprod: read("BLOCKFROST_PREPROD_PROJECT_ID"),
    mainnet: read("BLOCKFROST_MAINNET_PROJECT_ID"),
  };
}

/**
 * Same-origin, read-only proxy for Midnight public GraphQL indexers.
 * Preview is still Midnight-hosted; preprod/mainnet moved to Blockfrost
 * when Midnight decommissioned its endpoints (HTTP 410 since 2026-10-09),
 * so those need server-side project tokens that never reach the browser.
 */
export const Route = createFileRoute("/api/midnight/indexer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const networkParam = new URL(request.url).searchParams.get("network");
        if (networkParam !== "preview" && networkParam !== "preprod" && networkParam !== "mainnet") {
          return jsonError(400, "Unsupported Midnight network.");
        }
        const network: IndexerNetwork = networkParam;

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_QUERY_BYTES) {
          return jsonError(413, "Indexer query is too large.");
        }

        const body = await request.text();
        if (!body || new TextEncoder().encode(body).byteLength > MAX_QUERY_BYTES) {
          return jsonError(400, "A GraphQL query is required.");
        }

        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return jsonError(400, "Invalid GraphQL request.");
        }
        const query =
          typeof payload === "object" && payload !== null
            ? (payload as { query?: unknown }).query
            : undefined;
        if (typeof query !== "string" || /\b(?:mutation|subscription)\b/i.test(query)) {
          return jsonError(400, "Only read-only GraphQL queries are allowed.");
        }

        const upstream = resolveIndexerUpstream(network, serverTokens());
        if ("error" in upstream) {
          return jsonError(502, upstream.error);
        }

        try {
          const response = await fetch(upstream.url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body,
            signal: AbortSignal.timeout(20_000),
          });
          const responseHeaders = new Headers();
          const contentType = response.headers.get("content-type");
          if (contentType) responseHeaders.set("content-type", contentType);
          return new Response(await response.arrayBuffer(), {
            status: response.status,
            headers: responseHeaders,
          });
        } catch {
          return jsonError(502, "The Midnight indexer could not be reached. Try again shortly.");
        }
      },
    },
  },
});
