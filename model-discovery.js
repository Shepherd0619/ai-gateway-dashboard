function parseLocalDateTime(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date;
}

export function summarizeModelDiscovery(value) {
  if (!value) return { state: 'loading', status: 'Loading', modelCount: '—', source: 'Catalog unavailable' };
  const count = Array.isArray(value.models) ? value.models.length : 0;
  return {
    state: value.enabled ? 'enabled' : 'disabled',
    status: value.enabled ? 'Enabled' : 'Disabled',
    modelCount: `${count} ${count === 1 ? 'model' : 'models'}`,
    source: 'Effective catalog',
  };
}

export function canApplyModelDiscoveryResponse(value) {
  return !!value && typeof value.enabled === 'boolean' && Array.isArray(value.models);
}

export function canEditModelDiscovery(draft, busy) {
  return draft !== null && !busy;
}

function optionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeModelDiscovery(value) {
  const enabled = !!(value && value.enabled === true);
  const source = value && Array.isArray(value.models) ? value.models : [];
  const models = source.filter((model) => model && typeof model.id === 'string' && model.id.trim()).map((model) => {
    const normalized = { id: model.id.trim() };
    const displayName = optionalString(model.displayName);
    const createdAt = optionalString(model.createdAt);
    const ownedBy = optionalString(model.ownedBy);
    if (displayName !== undefined) normalized.displayName = displayName;
    if (createdAt !== undefined) normalized.createdAt = createdAt;
    if (ownedBy !== undefined) normalized.ownedBy = ownedBy;
    return normalized;
  });
  return { enabled, models };
}

export function validateModelDiscoveryDraft(models) {
  const seenIds = new Set();
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index] || {};
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id) return `Model ${index + 1}: ID is required.`;
    const normalizedId = id.toLowerCase();
    if (seenIds.has(normalizedId)) return `Model ${index + 1}: duplicate model ID (IDs are case-insensitive).`;
    seenIds.add(normalizedId);
    const createdAt = typeof model.createdAt === 'string' ? model.createdAt.trim() : '';
    if (createdAt && !parseLocalDateTime(createdAt)) return `Model ${index + 1}: enter a valid local date and time.`;
  }
  return null;
}

export function toLocalDateTimeInput(isoValue) {
  if (typeof isoValue !== 'string' || !isoValue.trim()) return '';
  const date = new Date(isoValue);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildModelDiscoveryPut(settings, now) {
  const clock = typeof now === 'function' ? now : () => new Date();
  const models = (Array.isArray(settings && settings.models) ? settings.models : []).map((model) => {
    const entry = { id: typeof model.id === 'string' ? model.id.trim() : '' };
    const displayName = optionalString(model.displayName);
    const ownedBy = optionalString(model.ownedBy);
    if (displayName !== undefined) entry.displayName = displayName;
    if (ownedBy !== undefined) entry.ownedBy = ownedBy;
    const createdAt = typeof model.createdAt === 'string' ? model.createdAt.trim() : '';
    const createdDate = createdAt ? parseLocalDateTime(createdAt) : clock();
    entry.createdAt = createdDate.toISOString();
    return entry;
  });
  return { enabled: !!(settings && settings.enabled), models };
}
