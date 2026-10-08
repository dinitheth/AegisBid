/** Structural gate for the deployable AegisBid V2 Compact contract. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "contracts", "aegis_bid_v2.compact"), "utf8");
const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures.push(name);
};

check("pins the public-preprod Compact language", /pragma\s+language_version\s+0\.23/.test(source));
check(
  "uses ledger block time for bidding and evaluation",
  /blockTimeLt\(tender\.deadline\)/.test(source) && /blockTimeGte\(tender\.deadline\)/.test(source),
);
check(
  "requires the private evaluator capability",
  /evaluatorSecret/.test(source) && /UNAUTHORIZED_EVALUATOR/.test(source),
);
check(
  "binds a stable wallet key to one tender nullifier",
  /kernel\.self\(\)\.bytes/.test(source) && /IDENTITY_ALREADY_USED/.test(source),
);
check(
  "enforces highest reserve and lowest ceiling",
  /RESERVE_NOT_MET/.test(source) && /CEILING_EXCEEDED/.test(source),
);
check(
  "uses a fixed eight-bid settlement bound",
  /bidCount\s*<=\s*8/.test(source) && /0\s*\.\.\s*8/.test(source),
);
check(
  "does not accept app-supplied time arguments",
  !/submitBid\([^)]*now/.test(source) && !/beginEvaluation\([^)]*now/.test(source),
);

if (failures.length) {
  console.error(`\ncompact-v2-check failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\ncompact-v2-check: all structural gates passed.");
