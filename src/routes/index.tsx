import { createFileRoute } from "@tanstack/react-router";
import { AegisUserApp } from "@/features/aegis/AegisUserApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AegisBid — Private Bidding Made Simple" },
      { name: "description", content: "Find tenders, submit private offers, and follow fair, verifiable results with AegisBid." },
      { property: "og:title", content: "AegisBid — Private Bidding Made Simple" },
      { property: "og:description", content: "Find tenders, submit private offers, and follow fair, verifiable results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AegisUserApp,
});
