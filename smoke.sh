#!/usr/bin/env bash
# smoke.sh — comprehensive live smoke test for @chio/openclaw against
# the real chio daemon, real @simplewebauthn/server verification, real
# @chio/bridge ed25519 receipt verify + capability issuance.
#
# Idempotent: tears down stale processes, reuses the harness clone in
# /tmp, recreates the bot DB. Allow ~5 min on a warm cache.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="/tmp/chio-smoke-openclaw"
RESULTS_DIR="${PLUGIN_DIR}/smoke-results"
LOG="${RESULTS_DIR}/smoke-$(date +%Y%m%d-%H%M%S).log"
LATEST_LOG="${RESULTS_DIR}/latest.log"
BOT_DB="${HARNESS_DIR}/openclaw.sqlite"
BOT_PORT=3001
# Wave 5.0.1: chio-policy re-landed velocity/human_in_loop first-class,
# so the `chio` binary again accepts the canonical policy. Prefer `chio`.
ARC_BIN="/Users/connor/Medica/backbay/standalone/arc/target/release/chio"
SOURCE_HARNESS="/Users/connor/Medica/backbay/standalone/chio-test-harness"

mkdir -p "${RESULTS_DIR}"
: > "${LOG}"
ln -sf "${LOG}" "${LATEST_LOG}"
exec > >(tee -a "${LOG}") 2>&1

start_t=$(date +%s)
echo "=== chio-open-claw-plugin live smoke ==="
echo "log: ${LOG}"
echo "plugin: ${PLUGIN_DIR}"
echo "harness clone: ${HARNESS_DIR}"
echo

# ─── prereq checks ─────────────────────────────────────────────────────
if [[ ! -x "${ARC_BIN}" ]]; then
  echo "FATAL: chio binary not found at ${ARC_BIN}"
  exit 1
fi
export CHIO_BIN="${ARC_BIN}"

# ─── teardown helper ──────────────────────────────────────────────────
BOT_PID=""
cleanup() {
  echo
  echo "=== teardown ==="
  if [[ -n "${BOT_PID}" ]] && kill -0 "${BOT_PID}" 2>/dev/null; then
    echo "stopping bot pid=${BOT_PID}"
    kill -TERM "${BOT_PID}" 2>/dev/null || true
    sleep 1
    kill -KILL "${BOT_PID}" 2>/dev/null || true
  fi
  if [[ -d "${HARNESS_DIR}/bin" ]]; then
    bash "${HARNESS_DIR}/bin/stop.sh" 2>&1 | sed 's/^/  /' || true
  fi
  rm -f "${BOT_DB}"* "${HARNESS_DIR}/shifts.yaml" 2>/dev/null || true
  echo "teardown complete"
}
trap cleanup EXIT INT TERM

# ─── sanity: tests + stub grep + typecheck ─────────────────────────────
echo "--- sanity check: existing unit tests"
cd "${PLUGIN_DIR}"
npm test 2>&1 | tail -15

echo
echo "--- sanity check: stub grep over src/"
STUB_COUNT=$(grep -rn '"stub"' src/ 2>/dev/null | wc -l | tr -d ' ' || true)
echo "src/ contains ${STUB_COUNT} occurrences of \"stub\""
if [[ "${STUB_COUNT}" != "0" ]]; then
  echo "(non-zero — review SMOKE.md notes; may indicate scaffolding leftover)"
fi

echo
echo "--- sanity check: typecheck"
npm run typecheck 2>&1 | tail -5

echo
echo "--- build"
npm run build 2>&1 | tail -5

# ─── prepare harness clone ────────────────────────────────────────────
echo
echo "--- harness clone at ${HARNESS_DIR}"
if [[ ! -d "${HARNESS_DIR}" ]]; then
  cp -r "${SOURCE_HARNESS}" "${HARNESS_DIR}"
  sed -i.bak 's/8931/8939/g; s/8940/8948/g' \
    "${HARNESS_DIR}/bin/start.sh" \
    "${HARNESS_DIR}/bin/env.sh" \
    "${HARNESS_DIR}/bin/wait-ready.sh"
  echo "cloned + ports rewritten (trust=8948 mcp=8939)"
else
  echo "reusing existing clone"
fi

# ensure clean shutdown of any leftover state — and wipe persistent
# state so capability/passport DBs are fresh per smoke run.
bash "${HARNESS_DIR}/bin/stop.sh" 2>/dev/null | sed 's/^/  /' || true
rm -f "${HARNESS_DIR}/var/trust.pid" "${HARNESS_DIR}/var/mcp.pid"
rm -f "${HARNESS_DIR}/var/"*.sqlite "${HARNESS_DIR}/var/"*.sqlite-* \
      "${HARNESS_DIR}/var/passport-statuses.json" \
      "${HARNESS_DIR}/var/trust.token"
echo "wiped harness var/ state"

# ─── start chio daemons ────────────────────────────────────────────────
echo
echo "--- starting chio trust + mcp daemons"
bash "${HARNESS_DIR}/bin/start.sh" | sed 's/^/  /'

# shellcheck source=/dev/null
source "${HARNESS_DIR}/bin/env.sh"
echo "trust=${CHIO_TRUST_URL} mcp=${CHIO_MCP_URL} token=${CHIO_TOKEN:0:8}…"

# ─── start the bot ────────────────────────────────────────────────────
echo
echo "--- starting OpenClaw bot on port ${BOT_PORT}"
rm -f "${BOT_DB}" "${BOT_DB}-wal" "${BOT_DB}-shm"

export CHIO_TRUST_URL
export CHIO_TRUST_TOKEN="${CHIO_TOKEN}"
export CHIO_MCP_EDGE_URL="${CHIO_MCP_URL}"
export CHIO_RECEIPT_DB="${HARNESS_DIR}/var/receipts.sqlite"
export WEBAUTHN_RP_ID="localhost"
export WEBAUTHN_RP_NAME="Chio Smoke"
export WEBAUTHN_ORIGIN="http://localhost:${BOT_PORT}"
export OPENCLAW_PUBLIC_URL="http://localhost:${BOT_PORT}"
export DATABASE_PATH="${BOT_DB}"
export PORT="${BOT_PORT}"
# default 2-of-3 quorum
export DEFAULT_QUORUM=2
export DEFAULT_SIGNERS=3

cd "${PLUGIN_DIR}"
# tsc with rootDir="." emits to dist/src/index.js (templates also under dist/templates)
BOT_ENTRY="dist/src/index.js"
[[ -f "${BOT_ENTRY}" ]] || BOT_ENTRY="dist/index.js"
node "${BOT_ENTRY}" > "${RESULTS_DIR}/bot.log" 2>&1 &
BOT_PID=$!
echo "bot pid=${BOT_PID}"

# wait for /healthz
for i in $(seq 1 30); do
  if curl -s "http://localhost:${BOT_PORT}/healthz" >/dev/null 2>&1; then
    echo "bot is healthy after ${i}s"
    break
  fi
  if ! kill -0 "${BOT_PID}" 2>/dev/null; then
    echo "FATAL: bot died during startup. tail of bot.log:"
    tail -40 "${RESULTS_DIR}/bot.log" | sed 's/^/  /'
    exit 1
  fi
  sleep 1
done

# ─── run the main smoke probe ─────────────────────────────────────────
echo
echo "--- running smoke probe (steps 1–10)"
cd "${PLUGIN_DIR}"
# probe writes step-by-step results to stdout
npx tsx test/smoke/probe.ts

# ─── shift handoff scheduler probe (optional best-effort) ─────────────
echo
echo "--- running shift-handoff scheduler probe"
SHIFT_FIXTURE="${HARNESS_DIR}/shifts.yaml"
DATABASE_PATH="${BOT_DB}" \
SHIFT_FIXTURE="${SHIFT_FIXTURE}" \
CHIO_POLICY="${CHIO_POLICY}" \
CHIO_TRUST_URL="${CHIO_TRUST_URL}" \
CHIO_TRUST_TOKEN="${CHIO_TOKEN}" \
CHIO_RECEIPT_DB="${HARNESS_DIR}/var/receipts.sqlite" \
  npx tsx test/smoke/scheduler-probe.ts || echo "(scheduler probe non-blocking)"

# ─── final report ─────────────────────────────────────────────────────
end_t=$(date +%s)
elapsed=$((end_t - start_t))
echo
echo "=== smoke complete in ${elapsed}s ==="
echo "log: ${LOG}"
echo "stub count in src/ = ${STUB_COUNT}"
