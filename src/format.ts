export interface HaState {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
}

export interface HaServiceDomain {
  domain: string;
  services: Record<string, unknown>;
}

/** Filter the (large) state list by domain, then page it. */
export function selectStates(states: unknown, domain: string | undefined, limit: number, offset: number) {
  const list = Array.isArray(states) ? (states as HaState[]) : [];
  const filtered = domain ? list.filter((s) => s.entity_id?.startsWith(`${domain}.`)) : list;
  return { total: filtered.length, states: filtered.slice(offset, offset + limit) };
}

/** One domain -> full service definitions; no domain -> domain -> [service names], to keep the payload small. */
export function summarizeServices(services: unknown, domain?: string): Record<string, unknown> {
  const all = Array.isArray(services) ? (services as HaServiceDomain[]) : [];
  if (domain) return all.find((d) => d.domain === domain)?.services ?? {};
  return Object.fromEntries(all.map((d) => [d.domain, Object.keys(d.services ?? {})]));
}

export function historyPath(opts: {
  entityIds: string[];
  start?: string;
  end?: string;
  minimalResponse?: boolean;
  noAttributes?: boolean;
}): string {
  const params = new URLSearchParams({ filter_entity_id: opts.entityIds.join(",") });
  if (opts.end) params.set("end_time", opts.end);
  if (opts.minimalResponse) params.set("minimal_response", "");
  if (opts.noAttributes) params.set("no_attributes", "");
  const start = opts.start ? `/${encodeURIComponent(opts.start)}` : "";
  return `/api/history/period${start}?${params}`;
}

export function logbookPath(opts: { start?: string; entity?: string; end?: string }): string {
  const params = new URLSearchParams();
  if (opts.entity) params.set("entity", opts.entity);
  if (opts.end) params.set("end_time", opts.end);
  const start = opts.start ? `/${encodeURIComponent(opts.start)}` : "";
  const query = params.toString();
  return `/api/logbook${start}${query ? `?${query}` : ""}`;
}

/** Guard for ha_call_api: only paths under /api, no traversal out of it. Returns an error message, or null when valid. */
export function apiPathError(path: string, method: string): string | null {
  if (!path.startsWith("/api")) return `path must start with /api (got "${path}")`;
  if (path.includes("..")) return `path must not contain ".." (got "${path}")`;
  if (method === "DELETE" && path.startsWith("/api/states/")) {
    return "Use ha_delete_state for this — it is marked destructive so clients can confirm it.";
  }
  return null;
}

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[truncated at ${limit} chars — narrow the query or page with limit/offset]`;
}
