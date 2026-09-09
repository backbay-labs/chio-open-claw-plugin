import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function durableCreate(path, value) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value) + "\n");
    await file.sync();
  } finally { await file.close(); }
}

async function syncDirectory(path) {
  const dir = await open(path, "r");
  try { await dir.sync(); } finally { await dir.close(); }
}

async function completedRecord(path) {
  let contents;
  try { contents = await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  return JSON.parse(contents);
}

// An unresolved dispatch fences this subject/resource owner across host session
// resets and restarts. The operator reconciles it before removing the lock.
export class DispatchJournal {
  constructor(stateDir) {
    if (!isAbsolute(stateDir)) throw new Error("Chio stateDir must be absolute");
    this.stateDir = stateDir;
  }

  async run(request, dispatch) {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const session = digest({ host: request.caller.host, subjectKey: request.authority?.subjectKey ?? null, serverId: request.authority?.serverId ?? null });
    const pending = join(this.stateDir, `${session}.pending.json`);
    const completed = join(this.stateDir, `${request.requestId}.result.json`);
    const requestHash = digest(request);
    {
      const prior = await completedRecord(completed);
      if (prior !== undefined) {
        if (prior.requestHash !== requestHash) throw new Error("Chio operation id reused with a different request");
        return prior.response;
      }
    }
    try {
      await durableCreate(pending, { request, requestHash, state: "dispatch_pending" });
      await syncDirectory(this.stateDir);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("Chio session has an unresolved dispatch; operator reconciliation required before further protected work");
      throw error;
    }
    // A concurrent invocation may have read ENOENT before the first operation
    // completed, then acquired the lock after it was released. Recheck under
    // our exclusive ownership so that window cannot redispatch a completed ID.
    {
      const prior = await completedRecord(completed);
      if (prior !== undefined) {
        await unlink(pending);
        await syncDirectory(this.stateDir);
        if (prior.requestHash !== requestHash) throw new Error("Chio operation id reused with a different request or authority");
        return prior.response;
      }
    }
    const response = await dispatch();
    const complete = response?.state === "completed" && response.evidence === "verified";
    const notDispatched = response?.state === "not_dispatched";
    // A signed denial can follow an output guard after an external effect. It
    // does not release this resource owner's fence. Unknowns and invalid evidence
    // likewise need independent operator reconciliation.
    if (!complete && !notDispatched) return { ...response, fenced: true };
    await durableCreate(completed, { requestHash, response });
    await syncDirectory(this.stateDir);
    await unlink(pending);
    await syncDirectory(this.stateDir);
    return response;
  }
}
