import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const url = process.env.HOMEASSISTANT_URL ?? process.env.HA_URL;
const token = process.env.HOMEASSISTANT_TOKEN ?? process.env.HA_TOKEN;
const live = Boolean(url && token);

const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.HOMEASSISTANT_URL = url ?? "http://127.0.0.1:8123";
env.HOMEASSISTANT_TOKEN = token ?? "placeholder";

const client = new Client({ name: "homeassistant-mcp-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env }));

const { tools } = await client.listTools();
const names = tools.map((tool) => tool.name);
assert.ok(names.length >= 15, `expected >= 15 tools, got ${names.length}`);
for (const required of ["ha_get_config", "ha_list_states", "ha_call_service", "ha_render_template"]) {
  assert.ok(names.includes(required), `missing tool ${required}`);
}
console.log(`${names.length} tools: ${names.join(", ")}`);

if (!live) {
  console.log("HOMEASSISTANT_URL / HOMEASSISTANT_TOKEN not set — connected and listed tools, skipped live calls.");
} else {
  const show = (label: string, result: unknown) => {
    const content = (result as { content?: { text?: string }[] }).content ?? [];
    console.log(`\n${label}: ${(content[0]?.text ?? "").slice(0, 500)}`);
  };
  const config = await client.callTool({ name: "ha_get_config", arguments: {} });
  assert.ok(!(config as { isError?: boolean }).isError, "ha_get_config failed");
  show("ha_get_config", config);
  show("ha_list_states(light, 5)", await client.callTool({ name: "ha_list_states", arguments: { domain: "light", limit: 5 } }));
}

await client.close();
console.log("\nsmoke: ok");
