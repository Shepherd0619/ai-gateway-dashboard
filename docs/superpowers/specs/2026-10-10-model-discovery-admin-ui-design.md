# Model Discovery Admin UI Design

## Background

The gateway backend now exposes an authenticated model discovery administration API:

- `GET /admin/model-discovery` returns the effective `{ enabled, models }` catalog.
- `PUT /admin/model-discovery` replaces runtime settings and returns the effective view.
- `DELETE /admin/model-discovery` removes the runtime override and restores the configured baseline, returning `204`.

All requests use the existing `x-admin-key` authentication. The dashboard currently supports backend-name discovery for routing selectors, but it has no UI for managing the shared model catalog. The model catalog controls `/v1/models` discovery; it does not create routing mappings.

Runtime entries precede and override configured entries with the same case-insensitive ID. Configured entries not shadowed by a runtime entry remain in the effective catalog. Consequently, deleting a model from the editor does not necessarily hide a configured baseline model; restoring the baseline is a separate `DELETE` operation.

## Goals

- Give administrators a clear UI to inspect and update model-discovery enabled state and model metadata for the selected gateway.
- Use the backend's existing GET/PUT/DELETE contract and the dashboard's shared API authentication/error handling.
- Make the effective-catalog merge and restore-to-baseline behavior understandable before users save.
- Provide usable date/time entry while sending backend-compatible ISO-8601 timestamps.

## Design

### Entry point and dialog

Add a full-width **Model Discovery** summary panel below the Auto Mode Classifier panel; the dashboard's Mapping Rules, Auto Mode Classifier, and Model Discovery panels are stacked vertically in that order. The summary shows loading/error, enabled state, effective model count, and labels the data accurately as the effective catalog (the API does not identify entry provenance), plus a **Manage catalog** action. Opening the editor fetches the current effective view from `GET /admin/model-discovery`. The editor remains a separate dialog from gateway connection management, routing mappings, and upstream health.

The dialog includes a discovery enabled checkbox and an editable ordered list of model entries. Each entry exposes:

- `id` — required text input.
- `displayName` — optional text input.
- `ownedBy` — optional text input.
- `createdAt` — optional local date/time input, with support for the browser's native picker and manual entry in the displayed local format.

Users can add and remove entries. An empty optional field is omitted from the PUT payload. For `createdAt`, a populated local value is converted to an ISO-8601 timestamp. If it is left empty, saving fills it with the current local date/time at save time, then serializes it to ISO-8601. Labels/help text explain this fallback and the input format. Existing entries with timestamps are rendered in local date/time form; a missing or invalid timestamp remains blank until the administrator chooses a value or leaves it blank to use save-time now.

### Save and restore

Save submits the complete enabled flag and edited model array to `PUT /admin/model-discovery`. Before submission, the UI validates that each ID is non-empty, IDs are unique case-insensitively, and any manually entered date/time parses to a valid date. Backend validation errors remain visible in the dialog. On success, use the returned effective view to update the home summary panel, close the editor, and show a success toast. On validation/API errors, keep the editor open and show the error inline.

A separate **Restore base configuration** action calls `DELETE /admin/model-discovery`, then reloads the effective view with GET. Since this discards the runtime override, require an explicit confirmation before sending DELETE. The action and confirmation text distinguish restoring the configured baseline from deleting individual rows.

### Loading, errors, and gateway changes

Show distinct loading, saving, and restoring states and prevent duplicate submissions while a request is active. Display API/network errors in the dialog without silently treating a failed read as an empty catalog. Use the existing gateway/API wrapper so selected gateway and admin-key handling match other dashboard features. Closing and reopening the dialog reloads the currently selected gateway's settings; switching gateways must not accidentally save stale state to another gateway.

### Safety and rendering

Render API-provided values as text/input values using the project's existing safe DOM rendering conventions; do not interpolate model metadata into HTML. Never modify route mappings as a side effect of model catalog editing.

## Testing

Add focused tests for any extracted catalog normalization/validation/payload helpers:

1. Preserve enabled state and all supported model fields from API responses.
2. Omit blank optional text fields and preserve non-empty values.
3. Reject blank IDs and duplicate IDs case-insensitively.
4. Serialize valid local date/time values as ISO-8601 and substitute a controllable current-time value when blank.
5. Reject invalid manually entered date/time values.
6. Build the expected GET/PUT/DELETE API requests and consume PUT's effective response.

Perform a manual UI verification for loading, successful save, backend validation failure, restore confirmation and success, empty catalog, and switching between gateways. Run the existing `npm test` suite and any relevant new tests.

## Out of scope

- Fetching models live from upstream providers; the catalog is administrator-maintained configuration.
- Editing an arbitrary raw `/v1/models` response body or response template.
- Automatically creating/updating routing mappings from model catalog entries.
- Changing backend routes, response formats, persistence, merge rules, or authentication.
- Editing the base `appsettings`/environment configuration directly from the dashboard; restore only removes the runtime override.
