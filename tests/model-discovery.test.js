import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelDiscoveryPut,
  canApplyModelDiscoveryResponse,
  canEditModelDiscovery,
  normalizeModelDiscovery,
  summarizeModelDiscovery,
  toLocalDateTimeInput,
  validateModelDiscoveryDraft,
} from '../model-discovery.js';

test('summarizes model discovery state for the dashboard panel', () => {
  assert.deepEqual(summarizeModelDiscovery(null), { state: 'loading', status: 'Loading', modelCount: '—', source: 'Catalog unavailable' });
  assert.deepEqual(summarizeModelDiscovery({ enabled: false, models: [] }), { state: 'disabled', status: 'Disabled', modelCount: '0 models', source: 'Effective catalog' });
  assert.deepEqual(summarizeModelDiscovery({ enabled: true, models: [{ id: 'runtime' }, { id: 'base' }] }), { state: 'enabled', status: 'Enabled', modelCount: '2 models', source: 'Effective catalog' });
});

test('accepts a model discovery response only when it contains a valid catalog', () => {
  assert.equal(canApplyModelDiscoveryResponse({ enabled: true, models: [] }), true);
  assert.equal(canApplyModelDiscoveryResponse(null), false);
  assert.equal(canApplyModelDiscoveryResponse({ enabled: 'yes', models: [] }), false);
  assert.equal(canApplyModelDiscoveryResponse({ enabled: true, models: 'invalid' }), false);
});

test('allows editing only after the catalog loads and while no request is pending', () => {
  assert.equal(canEditModelDiscovery(null, false), false);
  assert.equal(canEditModelDiscovery({ enabled: false, models: [] }, true), false);
  assert.equal(canEditModelDiscovery({ enabled: false, models: [] }, false), true);
});

test('normalizes the effective model discovery view and trims model IDs', () => {
  assert.deepEqual(normalizeModelDiscovery({
    enabled: true,
    models: [{
      id: '  model-a  ',
      displayName: 'Model A',
      createdAt: '2026-10-10T12:00:00Z',
      ownedBy: 'provider',
    }, { id: 'model-b', displayName: null, createdAt: null, ownedBy: null }],
  }), {
    enabled: true,
    models: [
      { id: 'model-a', displayName: 'Model A', createdAt: '2026-10-10T12:00:00Z', ownedBy: 'provider' },
      { id: 'model-b' },
    ],
  });
});

test('normalizes malformed discovery responses to a disabled empty catalog', () => {
  assert.deepEqual(normalizeModelDiscovery(null), { enabled: false, models: [] });
  assert.deepEqual(normalizeModelDiscovery({ enabled: 'yes', models: 'not-an-array' }), { enabled: false, models: [] });
  assert.deepEqual(normalizeModelDiscovery({ enabled: true, models: [{ id: 42 }, null, { id: '' }] }), {
    enabled: true,
    models: [],
  });
});

test('requires non-empty model IDs', () => {
  assert.match(validateModelDiscoveryDraft([{ id: '  ' }]), /ID.*required/i);
  assert.equal(validateModelDiscoveryDraft([{ id: 'model-a' }]), null);
});

test('rejects model IDs that differ only by case', () => {
  assert.match(validateModelDiscoveryDraft([{ id: 'Model-A' }, { id: 'model-a' }]), /duplicate/i);
});

test('rejects an invalid manually entered local date and time', () => {
  assert.match(validateModelDiscoveryDraft([{ id: 'model-a', createdAt: '2026-02-30T12:00' }]), /date|time/i);
  assert.match(validateModelDiscoveryDraft([{ id: 'model-a', createdAt: 'not-a-date' }]), /date|time/i);
});

test('converts a local date and time to an ISO-8601 timestamp', () => {
  const expected = new Date(2026, 9, 10, 8, 30).toISOString();
  const payload = buildModelDiscoveryPut({
    enabled: true,
    models: [{ id: ' model-a ', createdAt: '2026-10-10T08:30', displayName: ' Model A ', ownedBy: ' provider ' }],
  });
  assert.deepEqual(payload, {
    enabled: true,
    models: [{ id: 'model-a', createdAt: expected, displayName: 'Model A', ownedBy: 'provider' }],
  });
});

test('uses the injected current time when createdAt is blank and omits blank optional fields', () => {
  const now = () => new Date('2026-10-10T12:34:56.000Z');
  const payload = buildModelDiscoveryPut({ enabled: false, models: [{
    id: ' model-a ', createdAt: '', displayName: '  ', ownedBy: null,
  }] }, now);
  assert.deepEqual(payload, {
    enabled: false,
    models: [{ id: 'model-a', createdAt: '2026-10-10T12:34:56.000Z' }],
  });
});

test('formats ISO timestamps for a local datetime input', () => {
  const inputValue = toLocalDateTimeInput('2026-10-10T12:34:56.000Z');
  const date = new Date('2026-10-10T12:34:56.000Z');
  const pad = (part) => String(part).padStart(2, '0');
  assert.equal(inputValue, `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`);
  assert.equal(toLocalDateTimeInput(null), '');
  assert.equal(toLocalDateTimeInput('invalid'), '');
});
