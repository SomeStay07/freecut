# Reels Finder 006A: durable checkpoint operation

## Gap matrix

| Concern | Before 006A | 006A contract |
| --- | --- | --- |
| Recipe ownership | Generic edit requests expose a broad, partially open operation set. | FreeCut owns one closed `1.1` checkpoint recipe schema over an explicit edit subset. Unknown fields, operations, versions, references, and media IDs are rejected. Linked-sensitive operations require an explicit `linked` boolean. |
| Schema negotiation | Capabilities publish generated request schemas without a content identity. | Capabilities publish the recipe version, its canonical JSON Schema, and a `sha256:<hex>` hash of canonical schema bytes. |
| Caller identity | Queue/status identifiers are generated in-process and reset on restart. | The caller supplies a canonical UUIDv7 operation ID and an idempotency key; both bind to one canonical request hash durably. |
| Request durability | Synchronous handlers dispatch before any durable operation record exists. | Canonical request bytes and their qualified SHA-256 are persisted before the existing serialized queue is asked to dispatch. |
| Mutation concurrency | Persisted lifecycle edits support `expectedRevision`, with an optional legacy `force` escape hatch. | Checkpoint operations require an exact qualified revision and never expose `force`. |
| Edit/phase crash gap | Project JSON and request/idempotency ledgers are separate atomic files. | The edited project and an internal application receipt are one atomic project-resource write. The receipt binds operation ID, request hash, recipe hash, prior revision, and the canonical applied-project hash; the enclosing resource hash is the resulting revision. Internal receipts are excluded from public project inputs/responses and engine payloads. |
| Durable progress | `/v1/status` work in the source checkout tracks only the current process. | Per-operation records persist the phase sequence `queued -> applying_recipe -> project_committed -> rendering -> artifact_committed -> succeeded`, or terminal `failed`. |
| Recovery authority | Queue state, started work, and file existence are transient or ambiguous. | Startup reads persisted operations and project resources. Before `project_committed`, a matching embedded receipt is adopted; a mismatched receipt fails closed; only an absent receipt permits a revision-checked reapply. |
| Render binding | `/v1/render` loads the current project and returns a transient download. | The checkpoint render uses the exact recorded resulting project revision and an operation-scoped deterministic temporary path. |
| Artifact commit | Existing render output is not an operation-owned durable resource. | The temp artifact is hashed, sized, fsynced, bound in the operation record, and atomically renamed to a contained final relative path. Existing unbound output is never overwritten. |
| Terminal evidence | Process-local completion or an output file can be mistaken for success. | Success requires persisted `artifact_committed` evidence and returns the project revision plus artifact relative path, qualified content SHA-256, byte size, and MIME type. |
| Queueing | The service has one bounded serialized browser queue. | Checkpoint execution adapts that same queue; no dispatcher or second queue is introduced. |
| Compatibility | Legacy render/edit/lifecycle routes are synchronous. | Existing routes and response shapes remain available. Process-local status/progress changes are retained as observability only and are not presented as restart-safe checkpoint evidence. |

## Wire shape

`POST /v1/checkpoint-operations` requires an `Idempotency-Key` header and a body shaped like:

```json
{
  "operationId": "018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10",
  "projectId": "reel_project",
  "expectedRevision": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "recipe": {
    "schemaVersion": "1.1",
    "operations": [
      { "callerId": "track_1", "op": "addTrack", "kind": "video" },
      {
        "callerId": "clip_1",
        "op": "addClip",
        "mediaId": "source_1",
        "trackId": { "$ref": "track_1#/detail/trackId" },
        "from": 0,
        "durationInFrames": 90
      }
    ],
    "render": { "codec": "h264", "container": "mp4", "quality": "high" }
  },
  "recipeSha256": "sha256:eebb237308b432a35093330eb6f67c48b204fc3a6df35cec273849342b994618",
  "outputRelativePath": "artifacts/reel_project/checkpoint.mp4"
}
```

The recipe hash is calculated over canonical UTF-8 JSON: object keys sorted recursively, array order
preserved, no insignificant whitespace. The service validates the submitted hash before persisting the
canonical request. A successful submission returns `202`; replaying the same operation ID or
idempotency key with the same canonical request returns the existing operation. Changed canonical
bytes return `409`. Output paths must begin with `artifacts/`; project, media, and
`.freecut-headless` namespaces are never valid artifact targets.

Checkpoint recipe `1.1` requires `linked: true|false` on `removeItems`, `split`, `trimStart`, and
`trimEnd`. The broader `/edit` wire contract accepts the same field optionally for backward
compatibility. When present, FreeCut scopes the linked-selection override to that one operation and
restores the prior process state in `finally`, including failure paths.

The canonical recipe 1.1 JSON Schema hash advertised by capabilities is
`sha256:b721d4668b6bdbe618cfbb6546bf991a6e413f6d1311bf50e7f5179e29d02793`.

`GET /v1/checkpoint-operations/:id` returns only durable state. A successful terminal response has:

```json
{
  "ok": true,
  "apiVersion": 1,
  "operation": {
    "operationId": "018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10",
    "state": "succeeded",
    "phase": "succeeded",
    "projectId": "reel_project",
    "expectedRevision": "sha256:...",
    "resultingRevision": "sha256:...",
    "artifact": {
      "relativePath": "artifacts/reel_project/checkpoint.mp4",
      "sha256": "sha256:...",
      "byteSize": 123456,
      "mimeType": "video/mp4"
    }
  }
}
```

Cancellation, final-render semantics, Reels Finder UI, montage selection, review, analytics, cloud
sync, and literal exactly-once physical rendering remain outside 006A.
