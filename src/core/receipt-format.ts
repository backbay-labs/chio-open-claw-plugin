import type { ChioReceipt } from "@chio/bridge";

const GLYPH: Record<string, string> = {
  Allow: "\u2713",
  allow: "\u2713",
  Deny: "\u2715",
  deny: "\u2715",
  Cancelled: "\u25f7",
  cancelled: "\u25f7",
  Incomplete: "\u00b7",
  incomplete: "\u00b7",
};

function decisionVerdict(d: ChioReceipt["decision"]): string {
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "verdict" in d) {
    return String((d as { verdict: string }).verdict);
  }
  return "Allow";
}

function denyReason(d: ChioReceipt["decision"]): string | undefined {
  if (d && typeof d === "object") {
    const v = (d as { reason?: string; guard?: string }).reason;
    const g = (d as { reason?: string; guard?: string }).guard;
    return v ?? g;
  }
  return undefined;
}

export function formatReceiptLine(r: ChioReceipt): string {
  const verdict = decisionVerdict(r.decision);
  const glyph = GLYPH[verdict] ?? "\u00b7";
  const tool = r.tool_name ?? "tool";
  const server = r.tool_server ?? "";
  const reason = denyReason(r.decision);
  const head = `${glyph} ${server ? `${server}/` : ""}${tool}`;
  const hash = typeof r.content_hash === "string" ? r.content_hash.slice(0, 10) : "";
  const tail = [
    reason ? `reason=${reason}` : "",
    hash ? `hash=${hash}\u2026` : "",
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
  return tail ? `${head} \u00b7 ${tail}` : head;
}

export function formatReceiptBundle(rs: ChioReceipt[]): string {
  return rs.map(formatReceiptLine).join("\n");
}
