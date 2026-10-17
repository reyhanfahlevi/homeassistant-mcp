#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiPathError, historyPath, logbookPath, selectStates, summarizeServices, truncate } from "./format.js";

const BASE = (process.env.HOMEASSISTANT_URL ?? process.env.HA_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.HOMEASSISTANT_TOKEN ?? process.env.HA_TOKEN ?? "";
const TIMEOUT_MS = 30_000;
const CHARACTER_LIMIT = 25_000;

if (!BASE) {
  console.error(
    "HOMEASSISTANT_URL is not set (e.g. http://homeassistant.local:8123). " +
      "Find yours under Settings > System > Network, or use the host running Home Assistant.",
  );
  process.exit(1);
}

async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  if (!TOKEN) {
    throw new Error(
      "HOMEASSISTANT_TOKEN is not set. Create one at http://<your-ha>:8123/profile → Long-Lived Access Tokens → Create Token.",
    );
  }
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const raw = await res.text();
  if (!res.ok) {
    const detail = raw.slice(0, 300).trim() || res.statusText;
    if (res.status === 401) {
      throw new Error(`${path}: unauthorized (401). HOMEASSISTANT_TOKEN is wrong or expired. ${detail}`);
    }
    if (res.status === 400) throw new Error(`${path}: bad request (400). Check the entity_id and arguments. ${detail}`);
    if (res.status === 404) throw new Error(`${path}: not found (404). Check the entity_id. ${detail}`);
    if (res.status === 405) throw new Error(`${path}: method not allowed (405). ${detail}`);
    throw new Error(`${path}: failed (${res.status}). ${detail}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function text(result: unknown) {
  const out = truncate(typeof result === "string" ? result : JSON.stringify(result, null, 2), CHARACTER_LIMIT);
  return { content: [{ type: "text" as const, text: out }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const server = new McpServer({ name: "homeassistant-mcp", version: "0.1.0" });

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

const timestamp = (what: string) =>
  z.string().optional().describe(`ISO 8601 timestamp, e.g. 2026-10-17T00:00:00+07:00. ${what}`);

// ---- Overview ----
server.registerTool(
  "ha_get_config",
  {
    title: "Get Home Assistant config",
    description: `Instance configuration: location, time zone, unit system, version, loaded components.
Best first call to confirm the connection works.`,
    inputSchema: {},
    annotations: READ,
  },
  () => run(() => request("/api/config")),
);

server.registerTool(
  "ha_list_states",
  {
    title: "List entity states",
    description: `All entity states (entity_id, state, attributes). Args: domain (optional, e.g. "light"),
limit (default 50), offset. Always pass a domain on a real install — the full list is huge.`,
    inputSchema: {
      domain: z.string().optional().describe('Entity domain to filter on, e.g. "light", "sensor", "switch"'),
      limit: z.number().int().min(1).max(1000).default(50).describe("Max entities to return"),
      offset: z.number().int().min(0).default(0).describe("Entities to skip, for paging"),
    },
    annotations: READ,
  },
  ({ domain, limit, offset }) =>
    run(async () => selectStates(await request("/api/states"), domain, limit, offset)),
);

server.registerTool(
  "ha_get_state",
  {
    title: "Get one entity state",
    description: "Current state and attributes of a single entity. Args: entityId (e.g. sensor.kitchen_temperature).",
    inputSchema: { entityId: z.string().describe('Entity id, e.g. "light.study_light"') },
    annotations: READ,
  },
  ({ entityId }) => run(() => request(`/api/states/${encodeURIComponent(entityId)}`)),
);

server.registerTool(
  "ha_list_services",
  {
    title: "List available services",
    description: `Services that can be called. Without domain: domain -> [service names] map (small).
With domain: full definitions for that domain, including the fields each service accepts.
Use this before ha_call_service when unsure about a service name or its data fields.`,
    inputSchema: {
      domain: z.string().optional().describe('Filter to one domain, e.g. "light" or "climate"'),
    },
    annotations: READ,
  },
  ({ domain }) => run(async () => summarizeServices(await request("/api/services"), domain)),
);

server.registerTool(
  "ha_get_history",
  {
    title: "Get state history",
    description: `State changes for one or more entities. Args: entityIds (required), start (default: 1 day ago),
end, minimalResponse (default true — only state + last_changed, much smaller), noAttributes.
Returns: one array per entity. Requires the recorder integration.`,
    inputSchema: {
      entityIds: z.array(z.string()).min(1).describe('Entity ids, e.g. ["sensor.kitchen_temperature"]'),
      start: timestamp("Start of the period. Defaults to 1 day before now."),
      end: timestamp("End of the period. Defaults to 1 day after start."),
      minimalResponse: z.boolean().default(true),
      noAttributes: z.boolean().default(false),
    },
    annotations: READ,
  },
  ({ entityIds, start, end, minimalResponse, noAttributes }) =>
    run(() => request(historyPath({ entityIds, start, end, minimalResponse, noAttributes }))),
);

server.registerTool(
  "ha_get_logbook",
  {
    title: "Get logbook",
    description: `Human-readable history entries ("Light turned on by automation"). Args: start (default: 1 day ago),
entity (optional), end. Returns entries with when, name, message, entity_id.`,
    inputSchema: {
      start: timestamp("Start of the period. Defaults to 1 day before now."),
      entity: z.string().optional().describe("Filter to one entity id"),
      end: timestamp("End of the period."),
    },
    annotations: READ,
  },
  ({ start, entity, end }) => run(() => request(logbookPath({ start, entity, end }))),
);

server.registerTool(
  "ha_get_error_log",
  {
    title: "Get error log",
    description: "Errors logged during the current Home Assistant session, as plain text. Useful when something misbehaves.",
    inputSchema: {},
    annotations: READ,
  },
  () => run(() => request("/api/error_log")),
);

server.registerTool(
  "ha_render_template",
  {
    title: "Render a Jinja template",
    description: `Render a Home Assistant Jinja2 template server-side. Args: template, variables (optional).
The cheapest way to read or compute many values at once, e.g. "{{ states('sensor.kitchen_temperature') }}"
or "{% for s in states.light %}{{ s.entity_id }}: {{ s.state }}\\n{% endfor %}".
Returns: the rendered string.`,
    inputSchema: {
      template: z.string().describe("Jinja2 template"),
      variables: z.record(z.unknown()).optional().describe("Variables available to the template"),
    },
    annotations: READ,
  },
  ({ template, variables }) => run(() => request("/api/template", { method: "POST", body: { template, variables } })),
);

server.registerTool(
  "ha_list_calendars",
  {
    title: "List calendars",
    description: "Calendar entities available in this instance. Args: none. Returns entity_id and name.",
    inputSchema: {},
    annotations: READ,
  },
  () => run(() => request("/api/calendars")),
);

server.registerTool(
  "ha_get_calendar_events",
  {
    title: "Get calendar events",
    description: "Events of one calendar between two timestamps. Args: entityId (required), start, end (both required).",
    inputSchema: {
      entityId: z.string().describe('Calendar entity id, e.g. "calendar.holidays"'),
      start: z.string().describe("ISO 8601 start, e.g. 2026-10-01T00:00:00+07:00"),
      end: z.string().describe("ISO 8601 end"),
    },
    annotations: READ,
  },
  ({ entityId, start, end }) =>
    run(() => {
      const params = new URLSearchParams({ start, end });
      return request(`/api/calendars/${encodeURIComponent(entityId)}?${params}`);
    }),
);

// ---- Control ----
server.registerTool(
  "ha_call_service",
  {
    title: "Call a service (control a device)",
    description: `Control Home Assistant: run a service in a domain. POST /api/services/{domain}/{service}.
Args: domain (e.g. "light"), service (e.g. "turn_on"), data (service payload — usually {"entity_id": "..."});
extra keys go in data, e.g. {"entity_id":"light.study","brightness_pct":40}.
Common: light.turn_on/turn_off/toggle, switch.toggle, cover.open_cover/close_cover/set_cover_position,
climate.set_temperature/set_hvac_mode, media_player.media_play_pause/volume_set, fan.turn_on,
lock.lock/unlock, vacuum.start, script.turn_on, automation.trigger, scene.turn_on, notify.send_message,
homeassistant.turn_off (whole domain or entity).
Returns: the states that changed while the service ran, plus the service response when the service supports it.`,
    inputSchema: {
      domain: z.string().describe('Service domain, e.g. "light"'),
      service: z.string().describe('Service name, e.g. "turn_on"'),
      data: z.record(z.unknown()).optional().describe('Service data, usually including "entity_id"'),
      returnResponse: z.boolean().default(false).describe("Ask the service to return response data, if it supports it"),
    },
    annotations: WRITE,
  },
  ({ domain, service, data, returnResponse }) =>
    run(() => {
      const query = returnResponse ? "?return_response" : "";
      return request(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}${query}`, {
        method: "POST",
        body: data ?? {},
      });
    }),
);

server.registerTool(
  "ha_fire_event",
  {
    title: "Fire an event",
    description: `Fire a custom event on the event bus (automations can listen for it). Args: eventType, eventData.
Args: eventType (e.g. "my_custom_event"), eventData (optional JSON object).`,
    inputSchema: {
      eventType: z.string().describe("Event type to fire"),
      eventData: z.record(z.unknown()).optional().describe("Event payload"),
    },
    annotations: WRITE,
  },
  ({ eventType, eventData }) =>
    run(() => request(`/api/events/${encodeURIComponent(eventType)}`, { method: "POST", body: eventData ?? {} })),
);

server.registerTool(
  "ha_set_state",
  {
    title: "Set an entity state",
    description: `Overwrite an entity's state and attributes. This only changes the representation inside Home Assistant —
it does NOT talk to the physical device. To control a device, use ha_call_service instead.
Args: entityId (required), state (required), attributes (optional). Creates the entity when it does not exist yet.`,
    inputSchema: {
      entityId: z.string().describe("Entity id to set"),
      state: z.string().describe("New state value"),
      attributes: z.record(z.unknown()).optional().describe("Attributes to store with the state"),
    },
    annotations: WRITE,
  },
  ({ entityId, state, attributes }) =>
    run(() => request(`/api/states/${encodeURIComponent(entityId)}`, { method: "POST", body: { state, attributes } })),
);

server.registerTool(
  "ha_delete_state",
  {
    title: "Delete an entity state",
    description: `Remove an entity created through ha_set_state. Irreversible: the entity and its attributes are gone.
Args: entityId. Only works on entities that are not backed by an integration.`,
    inputSchema: { entityId: z.string().describe("Entity id to delete") },
    annotations: DESTRUCTIVE,
  },
  ({ entityId }) => run(() => request(`/api/states/${encodeURIComponent(entityId)}`, { method: "DELETE" })),
);

// ---- Escape hatch ----
server.registerTool(
  "ha_call_api",
  {
    title: "Call any Home Assistant REST path",
    description: `Call any REST endpoint under /api for cases without a dedicated tool, e.g.
GET /api/components, GET /api/events, POST /api/config/core/check_config, GET /api/calendars/... .
Args: method (GET|POST|DELETE), path (must start with /api and may include a query string), body (optional JSON).
Prefer the dedicated tools when one exists; this one cannot bypass their guards.`,
    inputSchema: {
      method: z.enum(["GET", "POST", "DELETE"]).default("GET"),
      path: z.string().describe('Path starting with /api, e.g. "/api/components"'),
      body: z.record(z.unknown()).optional().describe("JSON body for POST"),
    },
    annotations: WRITE,
  },
  ({ method, path, body }) =>
    run(() => {
      const invalid = apiPathError(path, method);
      if (invalid) throw new Error(invalid);
      return request(path, { method, body });
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`homeassistant-mcp ready (${BASE})`);
