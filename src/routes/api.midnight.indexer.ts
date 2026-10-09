import { createFileRoute } from "@tanstack/react-router";

const INDEXER_URLS = {
  preview: "https://indexer.preview.midnight.network/api/v4/graphql",
  preprod: "https://indexer.preprod.midnight.network/api/v4/graphql",
  mainnet: "https://indexer.mainnet.midnight.network/api/v4/graphql",
} as const;

const MAX_QUERY_BYTES = 64 * 1024;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Same-origin, read-only proxy for official Midnight public GraphQL indexers. */
export const Route = createFileRoute("/api/midnight/indexer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const network = new URL(request.url).searchParams.get("network");
        if (network !== "preview" && network !== "preprod" && network !== "mainnet") {
          return jsonError(400, "Unsupported Midnight network.");
        }

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

        try {
          const upstream = await fetch(INDEXER_URLS[network], {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body,
            signal: AbortSignal.timeout(20_000),
          });
          const responseHeaders = new Headers();
          const contentType = upstream.headers.get("content-type");
          if (contentType) responseHeaders.set("content-type", contentType);
          return new Response(await upstream.arrayBuffer(), {
            status: upstream.status,
            headers: responseHeaders,
          });
        } catch {
          return jsonError(502, "The Midnight indexer could not be reached. Try again shortly.");
        }
      },
    },
  },
});
