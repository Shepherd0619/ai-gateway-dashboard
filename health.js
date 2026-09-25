export async function readApiResponse(response, allowNonOkStatus) {
  let data = null;
  try { data = await response.json(); } catch (error) { data = null; }
  return { status: response.status, data, ok: response.ok || allowNonOkStatus === response.status };
}

export function getBackendHealthRows(health) {
  return Object.entries(health && health.backends || {}).map(([name, backend]) => ({
    name,
    upstream: backend.upstream,
    status: backend.status,
    latency_ms: backend.latency_ms,
    error: backend.error,
  }));
}

export function getHealthSummary(health) {
  const rows = getBackendHealthRows(health);
  if (rows.length === 0) return { state: 'idle', text: 'NO BACKENDS' };

  const reachable = rows.filter((backend) => backend.status === 'healthy').length;
  if (health.status === 'healthy') {
    return { state: 'ok', text: 'ALL REACHABLE · ' + reachable + '/' + rows.length };
  }
  if (reachable === 0) {
    return { state: 'bad', text: 'UNREACHABLE · 0/' + rows.length + ' REACHABLE' };
  }
  return { state: 'bad', text: 'PARTIAL · ' + reachable + '/' + rows.length + ' REACHABLE' };
}
