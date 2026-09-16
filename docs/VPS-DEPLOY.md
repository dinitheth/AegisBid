# AegisBid VPS deploy runbook (Ubuntu, native Linux)

> Status: contract **NOT DEPLOYED** yet. This is the exact sequence that gets
> it deployed. Run the commands on the VPS over SSH unless marked otherwise.
> Target: local `undeployed` network first, preprod after.

Assumes Ubuntu 22.04/24.04 with at least 2 vCPU, 4 GB RAM, 40 GB disk.
Keep ports `9944`, `8088`, `6300` on localhost only — reach them from your
own machines via the SSH tunnels below, never expose them publicly.

## 0. From your PC: open tunnels (keep this terminal open)

```bash
ssh -L 9944:localhost:9944 -L 8088:localhost:8088 -L 6300:localhost:6300 <user>@<vps-ip>
```

With the tunnels up, `http://localhost:6300` on your PC is the VPS proof
server — that is what the Lace wallet needs (`Settings » Midnight »
Local (http://localhost:6300)`).

## 1. On the VPS: Docker + Node 22 + Bun

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER   # log out + back in after this
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
curl -fsSL https://bun.sh/install | bash   # then restart shell
docker --version && node --version   # want Node v22+
```

## 2. On the VPS: Compact compiler

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
source ~/.bashrc
compact update 0.31.1
compact --version && which compact
```

## 3. On the VPS: local network + repo

```bash
git clone https://github.com/midnightntwrk/midnight-local-dev.git ~/midnight-local-dev
npm --prefix ~/midnight-local-dev install
git clone https://github.com/dinitheth/AegisBid.git ~/AegisBid
bun install --cwd ~/AegisBid
npm --prefix ~/midnight-local-dev start   # funding menu: option 1, fund your test wallets
```

## 4. On the VPS: compile the AegisBid contract

```bash
export MIDNIGHT_COMPACT_BIN=$(which compact)
bun --cwd ~/AegisBid run compact:check
ls ~/AegisBid/managed/aegis-bid   # expect: contract/ zkir/ keys/
```

If compile errors appear, paste the **full output** back here — the contract
gets fixed against the real compiler messages, not guesses.

## 5. Reconcile + deploy (together)

```bash
cat ~/AegisBid/managed/aegis-bid/contract/index.d.ts   # paste this back here
```

With the generated types in hand, the `deployContract` call in
`~/AegisBid/scripts/midnight-deploy.mjs` gets finalized to the exact SDK
shape, then:

```bash
node ~/AegisBid/scripts/midnight-deploy.mjs --network undeployed
node ~/AegisBid/scripts/midnight-status.mjs
```

Record the printed contract address as `VITE_AEGISBID_CONTRACT`.

## 6. Verify on the indexer (from your PC, tunnels up)

```bash
curl -s http://localhost:8088/api/v4/graphql -H 'content-type: application/json' \
  -d '{"query":"{ block { height } }"}'
```

Then set `VITE_AEGISBID_CONTRACT=<address>`, rebuild the app, and confirm the
Tender explorer reads the on-chain tender.

## 7. Preprod (only after local is green)

1. Lace wallet → preprod network → faucet tNIGHT → **Generate tDUST**.
2. On the VPS: `export MIDNIGHT_SEED=<64-hex>` (never commit it).
3. `node ~/AegisBid/scripts/midnight-deploy.mjs --network preprod`.
4. Confirm the address on a preprod explorer, log it in `managed/DEPLOYMENTS.md`.
