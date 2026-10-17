# @reyhanfahlevi/homeassistant-mcp

MCP server for the [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/), authenticated with a long-lived access token.

## Setup

1. In Home Assistant: open your profile (`http://<your-ha>:8123/profile`) → **Long-Lived Access Tokens** → **Create Token**. Copy the whole string.
2. Add the server to your MCP client:

```jsonc
{
  "mcpServers": {
    "homeassistant": {
      "command": "npx",
      "args": ["-y", "@reyhanfahlevi/homeassistant-mcp"],
      "env": {
        "HOMEASSISTANT_URL": "http://homeassistant.local:8123",
        "HOMEASSISTANT_TOKEN": "eyJhbGciOiJIUzI1NiIs..."
      }
    }
  }
}
```

`HA_URL` / `HA_TOKEN` are accepted as aliases. Use `http://` and the port the instance runs on (8123 unless changed; 80 on Home Assistant OS). No trailing slash needed.

### From a local checkout

Not on npm yet — clone, build, and point the client at the folder:

```bash
git clone https://github.com/reyhanfahlevi/homeassistant-mcp && cd homeassistant-mcp
npm install && npm run build
```

```jsonc
"command": "npx",
"args": ["-y", "/absolute/path/to/homeassistant-mcp"]
```

`node /absolute/path/to/homeassistant-mcp/dist/index.js` works too.

## Tools

| Tool | Type | Purpose |
| --- | --- | --- |
| `ha_get_config` | read | Instance config: location, units, version, components |
| `ha_list_states` | read | Entity states, filtered by `domain` and paged |
| `ha_get_state` | read | One entity's state and attributes |
| `ha_list_services` | read | Callable services; with `domain`, their fields |
| `ha_get_history` | read | State history of entities over a period |
| `ha_get_logbook` | read | Human-readable activity entries |
| `ha_get_error_log` | read | Errors from the current session |
| `ha_render_template` | read | Render a Jinja2 template server-side |
| `ha_list_calendars` | read | Calendar entities |
| `ha_get_calendar_events` | read | Events in a calendar between timestamps |
| `ha_call_service` | write | Control devices, e.g. `light` / `turn_on` |
| `ha_fire_event` | write | Fire an event on the event bus |
| `ha_set_state` | write | Overwrite an entity's state (representation only, no device I/O) |
| `ha_delete_state` | destructive | Remove a manually created entity |
| `ha_call_api` | any | Any other path under `/api` |

Endpoints not covered directly (`/api/components`, `/api/events`, `/api/config/core/check_config`, …) go through
`ha_call_api`, e.g. `{"method": "GET", "path": "/api/components"}`.

Not covered by the REST API at all: the device/area/entity **registries** and long-term statistics.
Those only exist over the WebSocket API — a separate server would be needed.

## Development

```bash
npm install
npm run build              # tsc -> dist/
npm test                   # unit checks on the path/format helpers
npm run smoke              # boots dist/ over stdio and lists tools (+ live calls if env is set)
HOMEASSISTANT_URL=http://homeassistant.local:8123 HOMEASSISTANT_TOKEN=... npm run smoke
```

## License

MIT
