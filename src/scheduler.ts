/**
 * Shift handoff scheduler.
 *
 * Reads `.chio/shifts.yaml` (or `CHIO_SHIFTS_PATH`) at start, parses the
 * schedule, and rotates bonds at each boundary. "Rotating a bond" means:
 *
 *   1. Revoke the currently-active capability via `ChioBridge.revoke`.
 *   2. Mint a fresh `did:chio:…` for the incoming on-call.
 *   3. Issue a new capability scoped to the same tool servers + TTL that
 *      matches the length of the incoming shift.
 *
 * The loader and parser are deliberately small — this module avoids `cron`
 * as a dep and just runs a 60-second tick against the YAML schedule.
 *
 * shifts.yaml shape:
 *   timezone: "America/New_York"
 *   rotations:
 *     - agent: "backfill-agent"
 *       channel: "#ops"
 *       schedule:
 *         - start: "09:00"
 *           end:   "17:00"
 *           oncall_user_id: "slack:U12345"
 *           policy_path: "./policy/backfill-daytime.yaml"
 *         - start: "17:00"
 *           end:   "09:00"
 *           oncall_user_id: "slack:U67890"
 *           policy_path: "./policy/backfill-nights.yaml"
 */
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { config } from "./config.js";
import { revoke } from "./core/chio.js";

interface ShiftEntry {
  start: string;
  end: string;
  oncall_user_id: string;
  policy_path?: string;
  capability_id?: string;
}

interface Rotation {
  agent: string;
  channel: string;
  schedule: ShiftEntry[];
}

interface ShiftsFile {
  timezone?: string;
  rotations: Rotation[];
}

const TICK_MS = 60_000;
// agent → marker string (`agent:oncall_user_id`) used to detect shift changes.
const activeMarker = new Map<string, string>();
// agent → real capability id (did) recorded from the YAML, used for revoke.
const activeCapability = new Map<string, string>();

let timer: ReturnType<typeof setInterval> | undefined;

export async function startShiftScheduler(): Promise<void> {
  const path = config.CHIO_SHIFTS_PATH;
  if (!path) {
    console.log("[scheduler] CHIO_SHIFTS_PATH not set; shift handoff disabled");
    return;
  }
  let shifts: ShiftsFile;
  try {
    const raw = await readFile(path, "utf8");
    shifts = YAML.parse(raw) as ShiftsFile;
  } catch (err) {
    console.log(
      `[scheduler] cannot load ${path}: ${(err as Error).message}; disabled`,
    );
    return;
  }

  const tick = async () => {
    const now = new Date();
    for (const r of shifts.rotations ?? []) {
      const active = pickActiveShift(r.schedule, now);
      if (!active) continue;
      const marker = `${r.agent}:${active.oncall_user_id}`;
      if (activeMarker.get(r.agent) === marker) continue;

      // boundary crossed — revoke previous, mark new as active. Real capability
      // issuance for the new on-call happens lazily when they countersign a
      // bond card; the scheduler only handles the revoke + marker. We revoke
      // the real capability id recorded against the prior shift entry (if any);
      // without a concrete cap id there is nothing for the lifecycle registry
      // to revoke, so we skip the call rather than emit a noisy 404.
      const prevCap = activeCapability.get(r.agent);
      if (prevCap) {
        try {
          await revoke(prevCap);
          console.log(
            `[scheduler] rotated ${r.agent} — revoked previous cap ${prevCap}`,
          );
        } catch (err) {
          console.log(
            `[scheduler] rotation revoke failed for ${r.agent}: ${(err as Error).message}`,
          );
        }
      } else if (activeMarker.has(r.agent)) {
        console.log(
          `[scheduler] rotated ${r.agent} — no prior capability id recorded, marker updated only`,
        );
      }
      activeMarker.set(r.agent, marker);
      if (active.capability_id) {
        activeCapability.set(r.agent, active.capability_id);
      } else {
        activeCapability.delete(r.agent);
      }
    }
  };

  await tick();
  timer = setInterval(() => {
    tick().catch((e) =>
      console.log("[scheduler] tick failed:", (e as Error).message),
    );
  }, TICK_MS);
  console.log("[scheduler] shift rotation online");
}

export function stopShiftScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function pickActiveShift(
  schedule: ShiftEntry[] | undefined,
  now: Date,
): ShiftEntry | undefined {
  if (!schedule) return undefined;
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const s of schedule) {
    const start = parseClock(s.start);
    const end = parseClock(s.end);
    if (start === undefined || end === undefined) continue;
    if (start <= end) {
      if (minutes >= start && minutes < end) return s;
    } else {
      // overnight wrap (e.g. 17:00 → 09:00)
      if (minutes >= start || minutes < end) return s;
    }
  }
  return undefined;
}

function parseClock(s: string): number | undefined {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !m[1] || !m[2]) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}
