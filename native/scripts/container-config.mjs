#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRestrictedProfile } from "../src/profile.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: container-config.mjs input.json new-output.json");
const config = JSON.parse(readFileSync(resolve(input), "utf8"));
assertRestrictedProfile(config);
config.agents.defaults.workspace = "/state/workspace";
config.plugins.load = { paths: ["/opt/chio/node_modules/@chio/openclaw-kernel"] };
config.plugins.entries["chio-kernel"].config.stateDir = "/state/journal";
writeFileSync(resolve(output), JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o644 });
process.stdout.write(`Created container runtime config at ${resolve(output)}\n`);
