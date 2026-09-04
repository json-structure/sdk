//! JSON Structure `$import` / `$importdefs` resolution and document consolidation.
//!
//! The [JSON Structure Import extension][import] lets a schema document pull the
//! type definitions of another document into a local namespace. Downstream
//! compilers — the Avro compiler in [`crate::avro`], the Protobuf generator in
//! the `jstruct` CLI — want a single self-contained document to work from, not a
//! graph of documents to chase at every `$ref`.
//!
//! [`consolidate`] produces that document: every import inlined, every JSON
//! Pointer rewritten to the merged namespace, and a deterministic result.
//!
//! [import]: https://json-structure.github.io/import
//!
//! # Example
//!
//! ```rust
//! use json_structure::consolidate::{consolidate, MapResolver};
//! use serde_json::json;
//!
//! let people = json!({
//!     "$schema": "https://json-structure.org/meta/core/v0/#",
//!     "$id": "https://example.com/people",
//!     "definitions": {
//!         "Person": { "type": "object", "properties": { "name": { "type": "string" } } }
//!     }
//! });
//!
//! let main = json!({
//!     "$schema": "https://json-structure.org/meta/core/v0/#",
//!     "$id": "https://example.com/main",
//!     "definitions": {
//!         "People": { "$importdefs": "https://example.com/people" }
//!     }
//! });
//!
//! let resolver = MapResolver::new(vec![people]);
//! let out = consolidate(&main, &resolver).unwrap();
//! assert!(out["definitions"]["People"]["Person"].is_object());
//! ```

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Errors produced while resolving imports.
#[derive(Debug, thiserror::Error)]
pub enum ConsolidateError {
    /// A referenced schema document could not be located.
    #[error("cannot resolve schema '{uri}' (at {path})")]
    Unresolved {
        /// The URI that could not be resolved.
        uri: String,
        /// JSON Pointer of the import keyword.
        path: String,
    },

    /// A referenced schema document could not be read or parsed.
    #[error("cannot load schema '{uri}': {reason}")]
    Load {
        /// The URI that failed to load.
        uri: String,
        /// Underlying reason.
        reason: String,
    },

    /// The import graph contains a cycle.
    #[error("import cycle detected: {}", .chain.join(" -> "))]
    Cycle {
        /// The chain of document identifiers forming the cycle.
        chain: Vec<String>,
    },

    /// The document is structurally invalid for consolidation purposes.
    #[error("{message} (at {path})")]
    Invalid {
        /// What is wrong.
        message: String,
        /// JSON Pointer of the offending node.
        path: String,
    },
}

/// Locates schema documents by URI.
///
/// Network access is deliberately not provided by any built-in implementation.
/// A caller who wants it supplies their own resolver and owns the consequences.
pub trait SchemaResolver {
    /// Resolves `uri` to a parsed JSON Structure document.
    ///
    /// Returns `Ok(None)` when the URI is simply not known to this resolver, and
    /// `Err` when it is known but could not be loaded.
    fn resolve(&self, uri: &str) -> Result<Option<Value>, ConsolidateError>;
}

/// Resolves imports from an in-memory set of documents keyed by `$id`.
///
/// This is the resolver behind the `jstruct --bundle` flag.
#[derive(Debug, Default, Clone)]
pub struct MapResolver {
    schemas: HashMap<String, Value>,
}

impl MapResolver {
    /// Builds a resolver from documents, keyed by each document's `$id`.
    ///
    /// Documents without an `$id` are ignored; there is no way to reference them.
    pub fn new(schemas: impl IntoIterator<Item = Value>) -> Self {
        let mut map = HashMap::new();
        for schema in schemas {
            if let Some(id) = schema.get("$id").and_then(Value::as_str) {
                map.insert(id.to_string(), schema);
            }
        }
        Self { schemas: map }
    }

    /// Registers a document under an explicit URI.
    pub fn insert(&mut self, uri: impl Into<String>, schema: Value) {
        self.schemas.insert(uri.into(), schema);
    }
}

impl SchemaResolver for MapResolver {
    fn resolve(&self, uri: &str) -> Result<Option<Value>, ConsolidateError> {
        Ok(self.schemas.get(uri).cloned())
    }
}

/// Resolves imports from the filesystem, relative to a base directory.
///
/// A URI is tried first as a key in the explicit map, then as a path relative to
/// the base directory, then as an absolute path. Remote URIs are not fetched.
#[derive(Debug, Clone)]
pub struct FileResolver {
    base: PathBuf,
    explicit: HashMap<String, PathBuf>,
}

impl FileResolver {
    /// Creates a resolver rooted at `base`.
    pub fn new(base: impl Into<PathBuf>) -> Self {
        Self {
            base: base.into(),
            explicit: HashMap::new(),
        }
    }

    /// Maps a URI to a specific file, bypassing path guessing.
    pub fn map(&mut self, uri: impl Into<String>, path: impl Into<PathBuf>) -> &mut Self {
        self.explicit.insert(uri.into(), path.into());
        self
    }

    fn candidate_paths(&self, uri: &str) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(p) = self.explicit.get(uri) {
            out.push(p.clone());
            return out;
        }
        // Strip a file: scheme if present; leave other schemes to fail loudly.
        let trimmed = uri.strip_prefix("file://").unwrap_or(uri);
        let as_path = Path::new(trimmed);
        if as_path.is_absolute() {
            out.push(as_path.to_path_buf());
        } else {
            out.push(self.base.join(as_path));
        }
        out
    }
}

impl SchemaResolver for FileResolver {
    fn resolve(&self, uri: &str) -> Result<Option<Value>, ConsolidateError> {
        for candidate in self.candidate_paths(uri) {
            if !candidate.is_file() {
                continue;
            }
            let text = fs::read_to_string(&candidate).map_err(|e| ConsolidateError::Load {
                uri: uri.to_string(),
                reason: e.to_string(),
            })?;
            let value = serde_json::from_str(&text).map_err(|e| ConsolidateError::Load {
                uri: uri.to_string(),
                reason: e.to_string(),
            })?;
            return Ok(Some(value));
        }
        Ok(None)
    }
}

/// A resolver that never resolves anything.
///
/// Useful for asserting that a document is already self-contained.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoResolver;

impl SchemaResolver for NoResolver {
    fn resolve(&self, _uri: &str) -> Result<Option<Value>, ConsolidateError> {
        Ok(None)
    }
}

/// Resolves every `$import` and `$importdefs` in `document`, returning a
/// self-contained JSON Structure document.
///
/// Local definitions shadow imported ones: when an imported namespace and the
/// importing namespace both define a name, the local declaration wins and the
/// imported one is discarded.
pub fn consolidate(
    document: &Value,
    resolver: &dyn SchemaResolver,
) -> Result<Value, ConsolidateError> {
    let mut stack = Vec::new();
    consolidate_document(document, resolver, &mut stack)
}

/// Returns true if the document contains any import keyword.
pub fn has_imports(document: &Value) -> bool {
    fn walk(value: &Value) -> bool {
        match value {
            Value::Object(map) => {
                if map.contains_key("$import") || map.contains_key("$importdefs") {
                    return true;
                }
                map.values().any(walk)
            }
            Value::Array(items) => items.iter().any(walk),
            _ => false,
        }
    }
    walk(document)
}

fn consolidate_document(
    document: &Value,
    resolver: &dyn SchemaResolver,
    stack: &mut Vec<String>,
) -> Result<Value, ConsolidateError> {
    let root = document.as_object().ok_or_else(|| ConsolidateError::Invalid {
        message: "schema document must be a JSON object".to_string(),
        path: "#".to_string(),
    })?;

    let id = root
        .get("$id")
        .and_then(Value::as_str)
        .unwrap_or("<anonymous>")
        .to_string();
    if stack.iter().any(|s| s == &id) {
        let mut chain = stack.clone();
        chain.push(id);
        return Err(ConsolidateError::Cycle { chain });
    }
    stack.push(id);

    let result = consolidate_root(root, resolver, stack);
    stack.pop();
    result
}

fn consolidate_root(
    root: &Map<String, Value>,
    resolver: &dyn SchemaResolver,
    stack: &mut Vec<String>,
) -> Result<Value, ConsolidateError> {
    let mut out = Map::new();
    let mut definitions = Map::new();
    let mut offers = Map::new();

    // Preserve everything that is not an import keyword or the definitions tree.
    for (key, value) in root {
        match key.as_str() {
            "$import" | "$importdefs" => {}
            "definitions" => {}
            "$offers" => {
                if let Some(map) = value.as_object() {
                    for (k, v) in map {
                        offers.insert(k.clone(), v.clone());
                    }
                }
            }
            _ => {
                out.insert(key.clone(), value.clone());
            }
        }
    }

    // Root-level $import / $importdefs land in the root namespace, exactly as if
    // they had been written inside `definitions`.
    for keyword in ["$import", "$importdefs"] {
        if let Some(uri) = root.get(keyword) {
            let import = load_import(
                uri,
                keyword,
                &format!("#/{keyword}"),
                &[],
                resolver,
                stack,
                &mut offers,
            )?;
            merge_namespace(&mut definitions, import);
        }
    }

    if let Some(existing) = root.get("definitions") {
        let map = existing
            .as_object()
            .ok_or_else(|| ConsolidateError::Invalid {
                message: "`definitions` must be a JSON object".to_string(),
                path: "#/definitions".to_string(),
            })?;
        let processed = process_namespace(
            map,
            &[],
            "#/definitions",
            resolver,
            stack,
            &mut offers,
        )?;
        merge_namespace(&mut definitions, processed);
    }

    if !definitions.is_empty() {
        out.insert("definitions".to_string(), Value::Object(definitions));
    }
    if !offers.is_empty() {
        out.insert("$offers".to_string(), Value::Object(offers));
    }
    Ok(Value::Object(out))
}

/// Processes one namespace node, resolving any imports declared inside it.
///
/// `path` is the namespace's location relative to the `definitions` root, and is
/// what imported pointers get prefixed with.
fn process_namespace(
    namespace: &Map<String, Value>,
    path: &[String],
    pointer: &str,
    resolver: &dyn SchemaResolver,
    stack: &mut Vec<String>,
    offers: &mut Map<String, Value>,
) -> Result<Map<String, Value>, ConsolidateError> {
    let mut local = Map::new();
    let mut imported = Map::new();

    for (key, value) in namespace {
        let child_pointer = format!("{pointer}/{key}");
        match key.as_str() {
            "$import" | "$importdefs" => {
                let contribution = load_import(
                    value,
                    key,
                    &child_pointer,
                    path,
                    resolver,
                    stack,
                    offers,
                )?;
                merge_namespace(&mut imported, contribution);
            }
            _ => {
                if is_type_declaration(value) {
                    local.insert(key.clone(), value.clone());
                } else if let Some(child) = value.as_object() {
                    let mut child_path = path.to_vec();
                    child_path.push(key.clone());
                    let processed = process_namespace(
                        child,
                        &child_path,
                        &child_pointer,
                        resolver,
                        stack,
                        offers,
                    )?;
                    local.insert(key.clone(), Value::Object(processed));
                } else {
                    local.insert(key.clone(), value.clone());
                }
            }
        }
    }

    // Local declarations shadow imported ones.
    merge_namespace(&mut imported, local);
    Ok(imported)
}

/// Loads one import and returns the definitions it contributes to the target
/// namespace, with all internal pointers rewritten.
fn load_import(
    uri_value: &Value,
    keyword: &str,
    pointer: &str,
    target_path: &[String],
    resolver: &dyn SchemaResolver,
    stack: &mut Vec<String>,
    offers: &mut Map<String, Value>,
) -> Result<Map<String, Value>, ConsolidateError> {
    let uri = uri_value
        .as_str()
        .ok_or_else(|| ConsolidateError::Invalid {
            message: format!("`{keyword}` must be a string URI"),
            path: pointer.to_string(),
        })?;

    let external = resolver
        .resolve(uri)?
        .ok_or_else(|| ConsolidateError::Unresolved {
            uri: uri.to_string(),
            path: pointer.to_string(),
        })?;

    let external = consolidate_document(&external, resolver, stack)?;
    let external = external.as_object().ok_or_else(|| ConsolidateError::Invalid {
        message: "imported schema must be a JSON object".to_string(),
        path: pointer.to_string(),
    })?;

    let mut contribution = Map::new();
    if let Some(defs) = external.get("definitions").and_then(Value::as_object) {
        for (key, value) in defs {
            contribution.insert(key.clone(), value.clone());
        }
    }

    // `$import` additionally brings the imported document's root type;
    // `$importdefs` deliberately does not.
    if keyword == "$import" {
        if let Some(root_type) = external.get("type") {
            let name = external
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| ConsolidateError::Invalid {
                    message: format!(
                        "imported schema '{uri}' declares an inline root type without a `name`"
                    ),
                    path: pointer.to_string(),
                })?;
            let mut decl = external.clone();
            for key in [
                "$schema",
                "$id",
                "$root",
                "$offers",
                "$uses",
                "definitions",
            ] {
                decl.remove(key);
            }
            decl.insert("type".to_string(), root_type.clone());
            contribution.insert(name.to_string(), Value::Object(decl));
        }
    }

    // Imported `$offers` entries join the consolidated document's offers, with
    // their pointers rewritten to the merged namespace.
    if let Some(external_offers) = external.get("$offers").and_then(Value::as_object) {
        for (key, value) in external_offers {
            let rewritten = rewrite_pointers(value, target_path);
            offers.entry(key.clone()).or_insert(rewritten);
        }
    }

    let mut rewritten = Map::new();
    for (key, value) in contribution {
        rewritten.insert(key, rewrite_pointers(&value, target_path));
    }
    Ok(rewritten)
}

/// Inserts every entry of `overlay` into `base`, overwriting on conflict.
fn merge_namespace(base: &mut Map<String, Value>, overlay: Map<String, Value>) {
    for (key, value) in overlay {
        base.insert(key, value);
    }
}

/// A type declaration is any object under `definitions` carrying a `type`
/// keyword. Everything else is a namespace.
fn is_type_declaration(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.contains_key("type"))
}

/// Rewrites every JSON Pointer inside `value` so that `#/definitions/X` becomes
/// `#/definitions/<prefix>/X`.
///
/// Pointers appear as `$ref`, `$extends`, `$root`, and as `$offers` values. They
/// may be single strings or arrays of strings.
fn rewrite_pointers(value: &Value, prefix: &[String]) -> Value {
    if prefix.is_empty() {
        return value.clone();
    }
    let joined = prefix.join("/");
    rewrite(value, &joined)
}

fn rewrite(value: &Value, prefix: &str) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, child) in map {
                let rewritten = match key.as_str() {
                    "$ref" | "$extends" | "$root" => rewrite_pointer_value(child, prefix),
                    _ => rewrite(child, prefix),
                };
                out.insert(key.clone(), rewritten);
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(|i| rewrite(i, prefix)).collect()),
        other => other.clone(),
    }
}

fn rewrite_pointer_value(value: &Value, prefix: &str) -> Value {
    match value {
        Value::String(s) => Value::String(rewrite_pointer(s, prefix)),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|i| rewrite_pointer_value(i, prefix))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn rewrite_pointer(pointer: &str, prefix: &str) -> String {
    const ROOT: &str = "#/definitions";
    if pointer == ROOT {
        return format!("{ROOT}/{prefix}");
    }
    match pointer.strip_prefix("#/definitions/") {
        Some(rest) => format!("{ROOT}/{prefix}/{rest}"),
        None => pointer.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn people() -> Value {
        json!({
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": "https://example.com/people",
            "definitions": {
                "Person": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "address": { "type": { "$ref": "#/definitions/Address" } }
                    }
                },
                "Address": {
                    "type": "object",
                    "properties": { "city": { "type": "string" } }
                }
            }
        })
    }

    #[test]
    fn importdefs_into_named_namespace_rewrites_refs() {
        let main = json!({
            "$id": "https://example.com/main",
            "definitions": {
                "People": { "$importdefs": "https://example.com/people" }
            }
        });
        let out = consolidate(&main, &MapResolver::new(vec![people()])).unwrap();
        assert_eq!(
            out["definitions"]["People"]["Person"]["properties"]["address"]["type"]["$ref"],
            json!("#/definitions/People/Address")
        );
    }

    #[test]
    fn root_level_import_lands_in_root_namespace() {
        let main = json!({
            "$id": "https://example.com/main",
            "$import": "https://example.com/people"
        });
        let out = consolidate(&main, &MapResolver::new(vec![people()])).unwrap();
        assert!(out["definitions"]["Person"].is_object());
        assert_eq!(
            out["definitions"]["Person"]["properties"]["address"]["type"]["$ref"],
            json!("#/definitions/Address")
        );
    }

    #[test]
    fn import_brings_the_root_type_and_importdefs_does_not() {
        let lib = json!({
            "$id": "https://example.com/lib",
            "name": "Root",
            "type": "object",
            "properties": { "a": { "type": "string" } },
            "definitions": { "Helper": { "type": "object", "properties": { "b": { "type": "string" } } } }
        });
        let resolver = MapResolver::new(vec![lib]);

        let with_import = consolidate(
            &json!({ "$id": "https://example.com/m1", "$import": "https://example.com/lib" }),
            &resolver,
        )
        .unwrap();
        assert!(with_import["definitions"]["Root"].is_object());
        assert!(with_import["definitions"]["Helper"].is_object());

        let with_defs = consolidate(
            &json!({ "$id": "https://example.com/m2", "$importdefs": "https://example.com/lib" }),
            &resolver,
        )
        .unwrap();
        assert!(with_defs["definitions"]["Root"].is_null());
        assert!(with_defs["definitions"]["Helper"].is_object());
    }

    #[test]
    fn local_definitions_shadow_imported_ones() {
        let main = json!({
            "$id": "https://example.com/main",
            "$importdefs": "https://example.com/people",
            "definitions": {
                "Person": { "type": "object", "properties": { "local": { "type": "boolean" } } }
            }
        });
        let out = consolidate(&main, &MapResolver::new(vec![people()])).unwrap();
        assert!(out["definitions"]["Person"]["properties"]["local"].is_object());
        assert!(out["definitions"]["Person"]["properties"]["name"].is_null());
    }

    #[test]
    fn unresolved_import_is_an_error() {
        let main = json!({ "$id": "m", "$importdefs": "https://example.com/missing" });
        let err = consolidate(&main, &NoResolver).unwrap_err();
        assert!(matches!(err, ConsolidateError::Unresolved { .. }));
    }

    #[test]
    fn cycles_are_detected() {
        let a = json!({ "$id": "a", "$importdefs": "b" });
        let b = json!({ "$id": "b", "$importdefs": "a" });
        let resolver = MapResolver::new(vec![a.clone(), b]);
        let err = consolidate(&a, &resolver).unwrap_err();
        assert!(matches!(err, ConsolidateError::Cycle { .. }));
    }

    #[test]
    fn transitive_imports_are_resolved() {
        let base = json!({
            "$id": "https://example.com/base",
            "definitions": { "Money": { "type": "object", "properties": { "amount": { "type": "decimal" } } } }
        });
        let mid = json!({
            "$id": "https://example.com/mid",
            "definitions": {
                "Base": { "$importdefs": "https://example.com/base" },
                "Order": { "type": "object", "properties": { "total": { "type": { "$ref": "#/definitions/Base/Money" } } } }
            }
        });
        let main = json!({
            "$id": "https://example.com/main",
            "definitions": { "Mid": { "$importdefs": "https://example.com/mid" } }
        });
        let out = consolidate(&main, &MapResolver::new(vec![base, mid])).unwrap();
        assert!(out["definitions"]["Mid"]["Base"]["Money"].is_object());
        assert_eq!(
            out["definitions"]["Mid"]["Order"]["properties"]["total"]["type"]["$ref"],
            json!("#/definitions/Mid/Base/Money")
        );
    }

    #[test]
    fn has_imports_detects_nested_keywords() {
        assert!(has_imports(&json!({ "definitions": { "N": { "$import": "x" } } })));
        assert!(!has_imports(&json!({ "definitions": { "N": { "type": "string" } } })));
    }

    #[test]
    fn consolidation_is_idempotent() {
        let main = json!({
            "$id": "https://example.com/main",
            "definitions": { "People": { "$importdefs": "https://example.com/people" } }
        });
        let resolver = MapResolver::new(vec![people()]);
        let once = consolidate(&main, &resolver).unwrap();
        let twice = consolidate(&once, &resolver).unwrap();
        assert_eq!(once, twice);
    }
}
