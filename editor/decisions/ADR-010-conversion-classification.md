# ADR-010: Conversion classification
- Owner: conversion
- Status: pending
- Rationale: Direct, bridged, and lossy Avrotize transformations require a pinned capability snapshot.
- Consequences: No conversion command is advertised in Phase 0; fixture: `coverage/gaps.json`.

## Import/export output ownership

Import commands execute a real conversion (not preview), validate the generated JSON Structure, and retain the single document in host-owned memory. Their lifecycle completes without publication; opaque generated-import handles are not filesystem paths or renderer-selected destinations. Structurize's uniquely allocated internal workspace is cleaned after its files have been read, including cooperative cancellation. No temporary location becomes an approved document path or import-resolution root.

Electron stages an untitled generated-import context behind the existing activation token. Only accepted activation clears the prior approved save/resource bindings; rejection and stale tokens leave them unchanged. The renderer treats imported content as dirty until Save As succeeds. VS Code creates an untitled TextDocument with the generated text and opens it in the custom editor, retaining native dirty/save behavior.

Exports always use the current editor snapshot bytes. Host-approved current-document identity is used for import-closure resolution only. The user-approved destination and existing all-or-nothing publication/rollback remain export-only. Review metadata uses outputMode to distinguish untitled-document from published-files; an import never claims an atomic commit to a user destination.
