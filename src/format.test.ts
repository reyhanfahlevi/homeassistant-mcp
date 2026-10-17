import assert from "node:assert/strict";
import { apiPathError, historyPath, logbookPath, selectStates, summarizeServices, truncate } from "./format.js";

const states = [
  { entity_id: "light.study", state: "on" },
  { entity_id: "sensor.temp", state: "25" },
  { entity_id: "light.kitchen", state: "off" },
  { entity_id: "light.hall", state: "on" },
];

assert.deepEqual(selectStates(states, "light", 2, 0), {
  total: 3,
  states: [states[0], states[2]],
});
assert.deepEqual(selectStates(states, undefined, 10, 3).states, [states[3]]);
assert.deepEqual(selectStates("nope", "light", 10, 0), { total: 0, states: [] });

const services = [
  { domain: "light", services: { turn_on: { fields: {} }, turn_off: {} } },
  { domain: "switch", services: { toggle: {} } },
];
assert.deepEqual(summarizeServices(services), { light: ["turn_on", "turn_off"], switch: ["toggle"] });
assert.deepEqual(summarizeServices(services, "light"), { turn_on: { fields: {} }, turn_off: {} });
assert.deepEqual(summarizeServices(services, "missing"), {});

assert.equal(
  historyPath({ entityIds: ["sensor.temp", "sensor.hum"], minimalResponse: true }),
  "/api/history/period?filter_entity_id=sensor.temp%2Csensor.hum&minimal_response=",
);
assert.equal(
  historyPath({ entityIds: ["sensor.temp"], start: "2026-10-17T00:00:00+07:00", end: "2026-10-18T00:00:00+07:00", noAttributes: true }),
  "/api/history/period/2026-10-17T00%3A00%3A00%2B07%3A00?filter_entity_id=sensor.temp&end_time=2026-10-18T00%3A00%3A00%2B07%3A00&no_attributes=",
);

assert.equal(logbookPath({ entity: "light.study" }), "/api/logbook?entity=light.study");
assert.equal(logbookPath({ start: "2026-10-17T00:00:00+07:00" }), "/api/logbook/2026-10-17T00%3A00%3A00%2B07%3A00");

assert.equal(apiPathError("/api/components", "GET"), null);
assert.equal(apiPathError("/api/states", "GET"), null);
assert.match(String(apiPathError("/api/../local/www/x.js", "GET")), /must not contain/);
assert.match(String(apiPathError("http://evil.example/api/states", "GET")), /must start with \/api/);
assert.match(String(apiPathError("/api/states/light.study", "DELETE")), /ha_delete_state/);

assert.equal(truncate("abc", 10), "abc");
assert.match(truncate("x".repeat(20), 10), /^x{10}\n\n\[truncated/);

console.log("format.test: ok");
