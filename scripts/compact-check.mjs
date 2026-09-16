/**
 * Structural gate for `contracts/aegis_bid.compact`.
 *
 * Usage: `node scripts/compact-check.mjs`
 *
 * 1. Always: asserts the contract keeps its pinned shape
 *    (pragma, stdlib import, ledger fields, witnesses, circuits, disclose).
 * 2. When `MIDNIGHT_COMPACT_BIN` points at a real Midnight compiler binary:
 *    runs `compact compile contracts/aegis_bid.compact managed/aegis-bid`.
 *    (The check never shells out to a bare `compact` on PATH because Windows
 *    ships an unrelated NTFS tool under the same name.)
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(root, "contracts", "aegis_bid.compact");

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures.push(name);
};

const source = await readFile(contractPath, "utf8");

check("pragma pins language_version >= 0.16", /pragma\s+language_version\s*>=?\s*0\.16/.test(source));
check("imports CompactStandardLibrary", /import\s+CompactStandardLibrary\s*;/.test(source));
for (const field of [
  "ledger tender",
  "ledger phase",
  "ledger commitmentCount",
  "ledger commitments",
  "ledger nullifiers",
  "ledger settlement",
]) {
  check(`declares public ${field}`, source.includes(field));
}
for (const witness of ["localBidAmount", "localBidSalt", "localIdentitySecret"]) {
  check(`declares witness ${witness}`, source.includes(`witness ${witness}`));
}
for (const circuit of ["submitBid", "beginEvaluation", "settle"]) {
  check(`declares circuit ${circuit}`, new RegExp(`circuit\\s+${circuit}\\s*\\(`).test(source));
}
check("raw bids never assigned to ledger (only commitments/nullifiers/receipt)", !/tender\s*=\s*localBidAmount/.test(source));
check("winning value leaves via disclose()", /disclose\s*\(\s*winningAmount\s*\)/.test(source));
check("commitments use persistentCommit (hiding, no disclose needed)", /persistentCommit\s*(<.*>)?\s*\(\s*\[/.test(source));
check("nullifier is a disclosed persistentHash (deterministic by design)", /disclose\s*\(\s*persistentHash\s*(<.*>)?\s*\(\s*\[/.test(source));
check("comparisonRoot uses single-tuple persistentHash", /persistentHash\s*(<.*>)?\s*\(\s*\[\s*winnerCommitment/.test(source));
check("settle loop is a constant 0..64 range with disclosed runtime guard", /for\s*\(\s*const\s+i\s+of\s+0\s*\.\.\s*64\s*\)/.test(source) && /if\s*\(\s*disclose\s*\(\s*i\s*<\s*bidCount\s*\)/.test(source));
check("oversized bid sets fail closed", /TOO_MANY_BIDS/.test(source));
check("commitment count compared via Counter.read()", /commitmentCount\.read\s*\(\s*\)/.test(source));
check("deadline + nullifier + commitment guards present", /DEADLINE_ELAPSED/.test(source) && /IDENTITY_ALREADY_USED/.test(source) && /DUPLICATE_COMMITMENT/.test(source));
check("ordering + reserve guards present", /NOT_MAXIMUM/.test(source) && /NOT_MINIMUM/.test(source) && /RESERVE_NOT_MET/.test(source));

const compilerBin = process.env.MIDNIGHT_COMPACT_BIN;
if (!compilerBin) {
  console.log("SKIP  full compile (set MIDNIGHT_COMPACT_BIN to a Midnight compiler binary; see contracts/COMPACT_TOOLCHAIN.md)");
} else {
  await new Promise((resolve) => {
    execFile(compilerBin, ["compile", contractPath, "managed/aegis-bid"], { cwd: root }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      check(`full compile via ${compilerBin}`, !error);
      resolve();
    });
  });
}

if (failures.length > 0) {
  console.error(`\ncompact-check failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\ncompact-check: all structural gates passed.");
