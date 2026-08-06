//! The compiler proper. See `spec/json-structure-to-avro.md` for the normative
//! mapping; this file is its implementation and the section references in the
//! comments point back at it.

use super::{AdditionalProperties, AvroOptions, CompileOutput, Mode, Warning};
use serde_json::{Map, Value};
use std::collections::HashSet;

/// A fatal compilation problem.
///
/// Every variant carries the JSON Pointer of the offending schema node, matching
/// the error style of the JSON Structure validators.
#[derive(Debug, Clone, thiserror::Error)]
pub enum AvroError {
    /// The document has no root type and none was named.
    #[error("document declares neither `type` nor `$root`; nothing to compile")]
    NoRootType,

    /// A `$ref`, `$extends`, or `$offers` pointer does not resolve.
    #[error("cannot resolve '{pointer}' (at {path})")]
    UnresolvedRef {
        /// The pointer that failed.
        pointer: String,
        /// JSON Pointer of the referring node.
        path: String,
    },

    /// The schema is not expressible in Avro, or is malformed.
    #[error("{message} (at {path})")]
    Invalid {
        /// What is wrong.
        message: String,
        /// JSON Pointer of the offending node.
        path: String,
    },

    /// An `altnames`/`altenums` override is not a legal Avro name.
    #[error("'{name}' is not a legal Avro name (at {path})")]
    IllegalName {
        /// The offending name.
        name: String,
        /// JSON Pointer of the offending node.
        path: String,
    },

    /// An add-in named in `uses` is not advertised by `$offers`.
    #[error("add-in '{name}' is not offered by this schema")]
    UnknownAddIn {
        /// The requested add-in name.
        name: String,
    },
}

impl AvroError {
    /// The variant name, so a conformance harness can assert *which* error was
    /// raised rather than trusting a substring of the message.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NoRootType => "NoRootType",
            Self::UnresolvedRef { .. } => "UnresolvedRef",
            Self::Invalid { .. } => "Invalid",
            Self::IllegalName { .. } => "IllegalName",
            Self::UnknownAddIn { .. } => "UnknownAddIn",
        }
    }

    /// JSON Pointer of the offending node, where the variant carries one.
    pub fn path(&self) -> Option<&str> {
        match self {
            Self::UnresolvedRef { path, .. }
            | Self::Invalid { path, .. }
            | Self::IllegalName { path, .. } => Some(path),
            Self::NoRootType | Self::UnknownAddIn { .. } => None,
        }
    }
}

/// Naming and error context for a schema node.
#[derive(Debug, Clone)]
struct Ctx {
    /// Avro namespace for anonymous types minted at this position.
    namespace: String,
    /// Base for generated names (§6.3).
    hint: String,
    /// JSON Pointer, for error reporting.
    pointer: String,
}

impl Ctx {
    fn child(&self, member: &str, pointer_segment: &str) -> Ctx {
        Ctx {
            namespace: self.namespace.clone(),
            hint: format!("{}_{}", self.hint, member),
            pointer: format!("{}/{}", self.pointer, pointer_segment),
        }
    }

    fn at(&self, pointer_segment: &str) -> Ctx {
        Ctx {
            namespace: self.namespace.clone(),
            hint: self.hint.clone(),
            pointer: format!("{}/{}", self.pointer, pointer_segment),
        }
    }
}

/// One field of a record, after `$extends` and add-in flattening.
struct FieldSpec {
    key: String,
    schema: Value,
    required: bool,
    pointer: String,
}

/// An add-in selected via the `uses` option.
struct AddIn {
    target: String,
    schema: Value,
    pointer: String,
}

pub(crate) struct Compiler<'a> {
    doc: &'a Value,
    opts: &'a AvroOptions,
    /// Fully-qualified names whose full definition has already been emitted.
    /// Membership lookups only — never iterated, per §7.2.
    emitted: HashSet<String>,
    /// Fully-qualified names taken, for generated-name collision suffixing.
    reserved: HashSet<String>,
    warnings: Vec<Warning>,
    addins: Vec<AddIn>,
    /// Selector names of inline unions. Core §Choice permits the selector to
    /// shadow a base-type property, so these names are exempt from the
    /// no-redefinition rule. Membership lookups only.
    shadowable: HashSet<String>,
}

impl<'a> Compiler<'a> {
    pub(crate) fn new(doc: &'a Value, opts: &'a AvroOptions) -> Self {
        Self {
            doc,
            opts,
            emitted: HashSet::new(),
            reserved: HashSet::new(),
            warnings: Vec::new(),
            addins: Vec::new(),
            shadowable: HashSet::new(),
        }
    }

    pub(crate) fn run(mut self) -> Result<CompileOutput, AvroError> {
        self.shadowable = collect_selectors(self.doc);
        self.collect_addins()?;
        self.reserve_declared_names()?;
        let schema = self.compile_root()?;
        Ok(CompileOutput {
            schema,
            warnings: self.warnings,
        })
    }

    /// Claims the Avro fullname of every declared type before anything is
    /// compiled.
    ///
    /// Generated helper names are minted with a collision suffix, but the
    /// suffixing only works against names already claimed. Reserving lazily —
    /// as each type happened to be reached — let a helper minted early take a
    /// name a declaration further down the document would later emit verbatim,
    /// producing two Avro definitions with one fullname. Avro parsers reject
    /// that outright, and a parser that did not would conflate the two types.
    ///
    /// Reserving up front also makes helper names independent of traversal
    /// order, which {{determinism}} requires.
    fn reserve_declared_names(&mut self) -> Result<(), AvroError> {
        let Some(definitions) = self.doc.get("definitions").and_then(Value::as_object) else {
            return Ok(());
        };
        let mut claims = Vec::new();
        self.walk_definitions(definitions, &[], "#/definitions", &mut claims)?;
        for (fq, pointer) in claims {
            if !self.reserved.insert(fq.clone()) {
                return Err(AvroError::Invalid {
                    message: format!(
                        "two declared types both map to the Avro fullname `{fq}`"
                    ),
                    path: pointer,
                });
            }
        }
        Ok(())
    }

    fn walk_definitions(
        &self,
        node: &Map<String, Value>,
        namespace: &[String],
        pointer: &str,
        out: &mut Vec<(String, String)>,
    ) -> Result<(), AvroError> {
        for (key, value) in node {
            let Some(map) = value.as_object() else {
                continue;
            };
            let child_pointer = format!("{pointer}/{key}");
            if is_type_declaration(map) {
                let name = self
                    .declared_name(map, &child_pointer)?
                    .unwrap_or_else(|| key.clone());
                out.push((qualify(&self.namespace_for(namespace), &name), child_pointer));
            } else {
                let mut nested = namespace.to_vec();
                nested.push(key.clone());
                self.walk_definitions(map, &nested, &child_pointer, out)?;
            }
        }
        Ok(())
    }

    // -- add-ins (§5.5) ---------------------------------------------------

    /// Resolves the `uses` option against `$offers`.
    ///
    /// Iteration follows `$offers` document order rather than the caller's
    /// order; §7.5 requires the output not to depend on how the caller sorted
    /// its argument.
    fn collect_addins(&mut self) -> Result<(), AvroError> {
        if self.opts.uses.is_empty() {
            return Ok(());
        }
        let offers = self.doc.get("$offers").and_then(Value::as_object);
        let requested: HashSet<&str> = self.opts.uses.iter().map(String::as_str).collect();

        let mut found: HashSet<&str> = HashSet::new();
        if let Some(offers) = offers {
            for (name, value) in offers {
                if !requested.contains(name.as_str()) {
                    continue;
                }
                found.insert(name.as_str());
                let pointers: Vec<&Value> = match value {
                    Value::Array(items) => items.iter().collect(),
                    other => vec![other],
                };
                for pointer_value in pointers {
                    let pointer =
                        pointer_value
                            .as_str()
                            .ok_or_else(|| AvroError::Invalid {
                                message: "`$offers` values must be JSON Pointers".to_string(),
                                path: format!("#/$offers/{name}"),
                            })?;
                    let (schema, _) = self.resolve(pointer, &format!("#/$offers/{name}"))?;
                    let target = schema
                        .get("$extends")
                        .and_then(Value::as_str)
                        .ok_or_else(|| AvroError::Invalid {
                            message: format!(
                                "add-in '{name}' must declare a single `$extends` target"
                            ),
                            path: pointer.to_string(),
                        })?
                        .to_string();
                    self.addins.push(AddIn {
                        target,
                        schema: schema.clone(),
                        pointer: pointer.to_string(),
                    });
                }
            }
        }

        for name in &self.opts.uses {
            if !found.contains(name.as_str()) {
                return Err(AvroError::UnknownAddIn { name: name.clone() });
            }
        }
        Ok(())
    }

    // -- roots (§5.1) -----------------------------------------------------

    fn compile_root(&mut self) -> Result<Value, AvroError> {
        if let Some(pointer) = self.doc.get("$root").and_then(Value::as_str) {
            let (_, path) = self.resolve(pointer, "#/$root")?;
            return self.compile_definition(&path, None);
        }

        let root = self.doc.as_object().ok_or_else(|| AvroError::Invalid {
            message: "schema document must be a JSON object".to_string(),
            path: "#".to_string(),
        })?;
        if !root.contains_key("type") {
            return Err(AvroError::NoRootType);
        }

        let name = self.declared_name(root, "#")?.unwrap_or_else(|| "Root".into());
        let namespace = self.namespace_for(&[]);
        let ctx = Ctx {
            namespace: namespace.clone(),
            hint: name.clone(),
            pointer: "#".to_string(),
        };
        self.build_named(root, &name, &namespace, &ctx, "#", None)
    }

    // -- named definitions (§5.3) -----------------------------------------

    /// Compiles the type at `path` under `definitions`, emitting its full
    /// definition the first time and a name reference thereafter.
    fn compile_definition(
        &mut self,
        path: &[String],
        inject_selector: Option<&str>,
    ) -> Result<Value, AvroError> {
        let pointer = definition_pointer(path);
        let decl = self
            .lookup(path)
            .ok_or_else(|| AvroError::UnresolvedRef {
                pointer: pointer.clone(),
                path: pointer.clone(),
            })?
            .clone();
        let map = decl.as_object().ok_or_else(|| AvroError::Invalid {
            message: "type declaration must be a JSON object".to_string(),
            path: pointer.clone(),
        })?;

        if map.get("abstract").and_then(Value::as_bool) == Some(true) {
            return Err(AvroError::Invalid {
                message: "abstract types cannot be used as a value type".to_string(),
                path: pointer.clone(),
            });
        }

        let key = path.last().cloned().unwrap_or_default();
        let name = self
            .declared_name(map, &pointer)?
            .unwrap_or(key);
        let namespace = self.namespace_for(&path[..path.len().saturating_sub(1)]);
        let fq = qualify(&namespace, &name);

        if self.emitted.contains(&fq) {
            return Ok(Value::String(fq));
        }
        self.emitted.insert(fq.clone());
        self.reserved.insert(fq);

        let ctx = Ctx {
            namespace: namespace.clone(),
            hint: name.clone(),
            pointer: pointer.clone(),
        };
        self.build_named(map, &name, &namespace, &ctx, &pointer, inject_selector)
    }

    /// Builds the definition body for a type that has a settled name.
    fn build_named(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        namespace: &str,
        ctx: &Ctx,
        pointer: &str,
        inject_selector: Option<&str>,
    ) -> Result<Value, AvroError> {
        if let Some(enum_schema) = self.try_enum(decl, name, namespace, pointer)? {
            return Ok(enum_schema);
        }

        let type_value = decl.get("type").ok_or_else(|| AvroError::Invalid {
            message: "type declaration is missing the `type` keyword".to_string(),
            path: pointer.to_string(),
        })?;

        match type_value {
            Value::String(t) => match t.as_str() {
                "object" => self.build_record(decl, name, namespace, ctx, pointer, inject_selector),
                "tuple" => self.build_tuple(decl, name, namespace, ctx, pointer),
                "choice" => self.build_choice(decl, name, namespace, ctx, pointer),
                "any" => Ok(self.any_record(name, namespace, pointer)),
                _ => self.compile_inline(decl, ctx),
            },
            _ => self.compile_inline(decl, ctx),
        }
    }

    // -- records (§3.1, §3.2) ---------------------------------------------

    fn build_record(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        namespace: &str,
        ctx: &Ctx,
        pointer: &str,
        inject_selector: Option<&str>,
    ) -> Result<Value, AvroError> {
        self.check_additional_properties(decl, pointer)?;

        let mut specs = Vec::new();
        let mut seen = HashSet::new();
        self.collect_fields(decl, pointer, &mut specs, &mut seen)?;

        // §3.7.2: the inline-union selector is materialized as the first field
        // unless the branch already declares it.
        let has_selector = inject_selector.is_some_and(|s| seen.contains(s));
        let mut fields = Vec::new();
        if let Some(selector) = inject_selector {
            if !has_selector {
                let mut field = Map::new();
                field.insert("name".to_string(), Value::String(selector.to_string()));
                field.insert("type".to_string(), Value::String("string".to_string()));
                fields.push(Value::Object(field));
            }
        }

        for spec in specs {
            fields.push(self.build_field(&spec, ctx)?);
        }

        let mut out = Map::new();
        out.insert("type".to_string(), Value::String("record".to_string()));
        out.insert("name".to_string(), Value::String(name.to_string()));
        if !namespace.is_empty() {
            out.insert("namespace".to_string(), Value::String(namespace.to_string()));
        }
        if let Some(doc) = self.doc_of(decl) {
            out.insert("doc".to_string(), Value::String(doc));
        }
        out.insert("fields".to_string(), Value::Array(fields));
        Ok(Value::Object(out))
    }

    fn build_field(&mut self, spec: &FieldSpec, ctx: &Ctx) -> Result<Value, AvroError> {
        let decl = spec.schema.as_object().ok_or_else(|| AvroError::Invalid {
            message: "property schema must be a JSON object".to_string(),
            path: spec.pointer.clone(),
        })?;
        let field_name = match self.alt_name(decl, &spec.pointer)? {
            Some(n) => n,
            None => spec.key.clone(),
        };

        let child = Ctx {
            namespace: ctx.namespace.clone(),
            hint: format!("{}_{}", ctx.hint, spec.key),
            pointer: spec.pointer.clone(),
        };
        let base_type = self.compile_inline(decl, &child)?;
        let (field_type, default) =
            self.nullable(base_type, spec.required, decl.get("default"), &spec.pointer)?;

        // Avro has no notion of a fixed value. A `const` becomes an ordinary
        // field that any writer may set to anything, which is worth saying out
        // loud rather than dropping on the floor.
        if decl.contains_key("const") {
            self.warnings.push(Warning {
                path: spec.pointer.clone(),
                message: "Avro cannot express `const`; the value is not enforced".to_string(),
            });
        }

        let mut out = Map::new();
        out.insert("name".to_string(), Value::String(field_name));
        out.insert("type".to_string(), field_type);
        if let Some(doc) = self.doc_of(decl) {
            out.insert("doc".to_string(), Value::String(doc));
        }
        if let Some(default) = default {
            out.insert("default".to_string(), default);
        }
        Ok(Value::Object(out))
    }

    /// `required` for one declaration, warning when Core's alternative sets had
    /// to be collapsed to their intersection.
    fn required_here(&mut self, decl: &Map<String, Value>, pointer: &str) -> HashSet<String> {
        let (required, note) = required_set(decl);
        if let Some(note) = note {
            self.warnings.push(Warning {
                path: pointer.to_string(),
                message: note,
            });
        }
        required
    }

    /// Flattens `$extends` bases, own properties, and add-ins into one ordered
    /// field list (§5.4, §5.5). Base fields come first; with multiple bases the
    /// first in the array wins.
    fn collect_fields(
        &mut self,
        decl: &Map<String, Value>,
        pointer: &str,
        out: &mut Vec<FieldSpec>,
        seen: &mut HashSet<String>,
    ) -> Result<(), AvroError> {
        let mut chain = Vec::new();
        self.collect_fields_from(decl, pointer, out, seen, &mut chain)
    }

    fn collect_fields_from(
        &mut self,
        decl: &Map<String, Value>,
        pointer: &str,
        out: &mut Vec<FieldSpec>,
        seen: &mut HashSet<String>,
        chain: &mut Vec<String>,
    ) -> Result<(), AvroError> {
        // Core forbids `$extends` cycles. Without this the recursion below
        // overflows the stack rather than reporting the schema error.
        if chain.iter().any(|p| p == pointer) {
            chain.push(pointer.to_string());
            return Err(AvroError::Invalid {
                message: format!("`$extends` cycle: {}", chain.join(" -> ")),
                path: pointer.to_string(),
            });
        }
        chain.push(pointer.to_string());

        // Names already contributed by an enclosing call or by an earlier
        // sibling base. Core says the first base in the array wins, so a
        // collision against these is legal; a collision against a name from
        // *our own* extends chain is not.
        let outer: HashSet<String> = seen.clone();

        if let Some(extends) = decl.get("$extends") {
            for base_pointer in pointer_list(extends, pointer)? {
                let (base, _) = self.resolve(&base_pointer, pointer)?;
                let base = base.clone();
                let base_map = base.as_object().ok_or_else(|| AvroError::Invalid {
                    message: "`$extends` must point at a type declaration".to_string(),
                    path: pointer.to_string(),
                })?;
                self.collect_fields_from(base_map, &base_pointer, out, seen, chain)?;
            }
        }

        let required = self.required_here(decl, pointer);
        if let Some(properties) = decl.get("properties").and_then(Value::as_object) {
            for (key, schema) in properties {
                if seen.contains(key) {
                    // Core: an extending type MUST NOT redefine an inherited
                    // property. The one exception is an inline union's
                    // selector, which MAY shadow a base property.
                    if !outer.contains(key) && !self.shadowable.contains(key) {
                        return Err(AvroError::Invalid {
                            message: format!(
                                "property '{key}' is inherited through `$extends` and MUST NOT be redefined"
                            ),
                            path: format!("{pointer}/properties/{key}"),
                        });
                    }
                    continue;
                }
                seen.insert(key.clone());
                out.push(FieldSpec {
                    key: key.clone(),
                    schema: schema.clone(),
                    required: required.contains(key),
                    pointer: format!("{pointer}/properties/{key}"),
                });
            }
        }

        // Add-ins targeting this exact type append after its own properties.
        let applicable: Vec<(Value, String)> = self
            .addins
            .iter()
            .filter(|a| a.target == pointer)
            .map(|a| (a.schema.clone(), a.pointer.clone()))
            .collect();
        for (schema, addin_pointer) in applicable {
            let map = schema.as_object().ok_or_else(|| AvroError::Invalid {
                message: "add-in must be a type declaration".to_string(),
                path: addin_pointer.clone(),
            })?;
            let addin_required = self.required_here(map, &addin_pointer);
            if let Some(properties) = map.get("properties").and_then(Value::as_object) {
                for (key, prop) in properties {
                    if seen.contains(key) {
                        continue;
                    }
                    seen.insert(key.clone());
                    out.push(FieldSpec {
                        key: key.clone(),
                        schema: prop.clone(),
                        required: addin_required.contains(key),
                        pointer: format!("{addin_pointer}/properties/{key}"),
                    });
                }
            }
        }

        // `chain` tracks ancestors only. Popping here is what lets a diamond
        // (two bases sharing a grandparent) through while a true cycle fails.
        chain.pop();
        Ok(())
    }

    // -- tuples (§3.5) -----------------------------------------------------

    fn build_tuple(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        namespace: &str,
        ctx: &Ctx,
        pointer: &str,
    ) -> Result<Value, AvroError> {
        let order = decl
            .get("tuple")
            .and_then(Value::as_array)
            .ok_or_else(|| AvroError::Invalid {
                message: "`tuple` types require the `tuple` keyword".to_string(),
                path: pointer.to_string(),
            })?;

        let mut specs = Vec::new();
        let mut seen = HashSet::new();
        self.collect_fields(decl, pointer, &mut specs, &mut seen)?;

        let mut fields = Vec::new();
        for entry in order {
            let key = entry.as_str().ok_or_else(|| AvroError::Invalid {
                message: "`tuple` entries must be property names".to_string(),
                path: pointer.to_string(),
            })?;
            let spec = specs
                .iter()
                .find(|s| s.key == key)
                .ok_or_else(|| AvroError::Invalid {
                    message: format!("`tuple` names unknown property '{key}'"),
                    path: pointer.to_string(),
                })?;
            // All tuple properties are implicitly required (§3.5).
            let spec = FieldSpec {
                key: spec.key.clone(),
                schema: spec.schema.clone(),
                required: true,
                pointer: spec.pointer.clone(),
            };
            fields.push(self.build_field(&spec, ctx)?);
        }

        let mut out = Map::new();
        out.insert("type".to_string(), Value::String("record".to_string()));
        out.insert("name".to_string(), Value::String(name.to_string()));
        if !namespace.is_empty() {
            out.insert("namespace".to_string(), Value::String(namespace.to_string()));
        }
        if let Some(doc) = self.doc_of(decl) {
            out.insert("doc".to_string(), Value::String(doc));
        }
        out.insert("fields".to_string(), Value::Array(fields));
        Ok(Value::Object(out))
    }

    // -- choices (§3.7) ----------------------------------------------------

    fn build_choice(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        namespace: &str,
        ctx: &Ctx,
        pointer: &str,
    ) -> Result<Value, AvroError> {
        let choices = decl
            .get("choices")
            .and_then(Value::as_object)
            .ok_or_else(|| AvroError::Invalid {
                message: "`choice` types require the `choices` keyword".to_string(),
                path: pointer.to_string(),
            })?
            .clone();

        let selector = decl.get("selector").and_then(Value::as_str);
        let inline = decl.contains_key("$extends") && selector.is_some();

        let mut branches = Vec::new();
        for (key, branch) in &choices {
            let branch_pointer = format!("{pointer}/choices/{key}");
            if inline {
                let selector = selector.expect("checked above");
                let branch_ref = branch
                    .get("type")
                    .and_then(|t| t.get("$ref"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| AvroError::Invalid {
                        message: "inline union choices must be `$ref` to a named type".to_string(),
                        path: branch_pointer.clone(),
                    })?;
                let (_, path) = self.resolve(branch_ref, &branch_pointer)?;
                branches.push(self.compile_definition(&path, Some(selector))?);
                continue;
            }

            let branch_map = branch.as_object().ok_or_else(|| AvroError::Invalid {
                message: "choice branches must be schema objects".to_string(),
                path: branch_pointer.clone(),
            })?;
            let child = Ctx {
                namespace: namespace.to_string(),
                hint: format!("{}_{}", ctx.hint, key),
                pointer: branch_pointer.clone(),
            };
            let compiled = self.compile_inline(branch_map, &child)?;

            // §3.7.1: use the branch directly when its Avro name already equals
            // the choice key, otherwise wrap it in a record named for the key.
            if unqualified_name(&compiled).as_deref() == Some(key.as_str()) {
                branches.push(compiled);
            } else {
                let mut field = Map::new();
                field.insert("name".to_string(), Value::String("value".to_string()));
                field.insert("type".to_string(), compiled);

                let mut wrapper = Map::new();
                wrapper.insert("type".to_string(), Value::String("record".to_string()));
                let wrapper_name = self.mint_named(key, &child);
                wrapper.insert("name".to_string(), Value::String(wrapper_name));
                if !namespace.is_empty() {
                    wrapper
                        .insert("namespace".to_string(), Value::String(namespace.to_string()));
                }
                wrapper.insert("fields".to_string(), Value::Array(vec![Value::Object(field)]));
                branches.push(Value::Object(wrapper));
            }
        }

        // A choice is a union, and Avro unions are not named. The choice's own
        // name survives only through the branch wrappers.
        let _ = name;
        Ok(union_of(branches))
    }

    // -- inline schemas ----------------------------------------------------

    /// Compiles a schema node that is not itself a `definitions` entry.
    fn compile_inline(
        &mut self,
        decl: &Map<String, Value>,
        ctx: &Ctx,
    ) -> Result<Value, AvroError> {
        if let Some(type_value) = decl.get("type") {
            if let Value::Object(inner) = type_value {
                if let Some(reference) = inner.get("$ref").and_then(Value::as_str) {
                    let (_, path) = self.resolve(reference, &ctx.pointer)?;
                    return self.compile_definition(&path, None);
                }
            }
        }

        // An anonymous enum needs a minted name.
        if decl.contains_key("enum") {
            let name = self.mint_name(ctx);
            if let Some(enum_schema) =
                self.try_enum(decl, &name, &ctx.namespace, &ctx.pointer)?
            {
                return Ok(enum_schema);
            }
        }

        let type_value = decl.get("type").ok_or_else(|| AvroError::Invalid {
            message: "schema is missing the `type` keyword".to_string(),
            path: ctx.pointer.clone(),
        })?;

        match type_value {
            Value::String(name) => self.compile_type_name(name, decl, ctx),
            Value::Array(branches) => {
                let mut compiled = Vec::new();
                for (index, branch) in branches.iter().enumerate() {
                    let child = ctx.at(&format!("type/{index}"));
                    compiled.push(self.compile_union_branch(branch, &child)?);
                }
                Ok(union_of(compiled))
            }
            other => Err(AvroError::Invalid {
                message: format!("unsupported `type` value: {other}"),
                path: ctx.pointer.clone(),
            }),
        }
    }

    fn compile_union_branch(&mut self, branch: &Value, ctx: &Ctx) -> Result<Value, AvroError> {
        match branch {
            Value::String(name) => {
                let empty = Map::new();
                self.compile_type_name(name, &empty, ctx)
            }
            Value::Object(map) => {
                if let Some(reference) = map.get("$ref").and_then(Value::as_str) {
                    let (_, path) = self.resolve(reference, &ctx.pointer)?;
                    return self.compile_definition(&path, None);
                }
                self.compile_inline(map, ctx)
            }
            other => Err(AvroError::Invalid {
                message: format!("unsupported union branch: {other}"),
                path: ctx.pointer.clone(),
            }),
        }
    }

    fn compile_type_name(
        &mut self,
        type_name: &str,
        decl: &Map<String, Value>,
        ctx: &Ctx,
    ) -> Result<Value, AvroError> {
        if let Some(primitive) = avro_primitive(type_name) {
            return Ok(self.primitive_value(type_name, primitive, decl, ctx));
        }

        match type_name {
            "array" | "set" => {
                if type_name == "set" {
                    // Avro has no set type. The values survive; the uniqueness
                    // constraint does not.
                    self.warnings.push(Warning {
                        path: ctx.pointer.clone(),
                        message: "Avro has no set type; uniqueness is not enforced on the wire"
                            .to_string(),
                    });
                }
                let items = decl
                    .get("items")
                    .and_then(Value::as_object)
                    .ok_or_else(|| AvroError::Invalid {
                        message: format!("`{type_name}` requires `items`"),
                        path: ctx.pointer.clone(),
                    })?
                    .clone();
                let child = ctx.child("item", "items");
                let item_type = self.compile_inline(&items, &child)?;
                let mut out = Map::new();
                out.insert("type".to_string(), Value::String("array".to_string()));
                out.insert("items".to_string(), item_type);
                Ok(Value::Object(out))
            }
            "map" => {
                let values = decl
                    .get("values")
                    .and_then(Value::as_object)
                    .ok_or_else(|| AvroError::Invalid {
                        message: "`map` requires `values`".to_string(),
                        path: ctx.pointer.clone(),
                    })?
                    .clone();
                let child = ctx.child("value", "values");
                let value_type = self.compile_inline(&values, &child)?;
                let mut out = Map::new();
                out.insert("type".to_string(), Value::String("map".to_string()));
                out.insert("values".to_string(), value_type);
                Ok(Value::Object(out))
            }
            "object" => {
                let name = self.mint_name(ctx);
                let namespace = ctx.namespace.clone();
                self.build_record(decl, &name, &namespace, ctx, &ctx.pointer.clone(), None)
            }
            "tuple" => {
                let name = self.mint_name(ctx);
                let namespace = ctx.namespace.clone();
                self.build_tuple(decl, &name, &namespace, ctx, &ctx.pointer.clone())
            }
            "choice" => {
                let name = self.mint_name(ctx);
                let namespace = ctx.namespace.clone();
                self.build_choice(decl, &name, &namespace, ctx, &ctx.pointer.clone())
            }
            "any" => {
                let name = self.mint_name(ctx);
                let namespace = ctx.namespace.clone();
                Ok(self.any_record(&name, &namespace, &ctx.pointer))
            }
            other => Err(AvroError::Invalid {
                message: format!("unknown type '{other}'"),
                path: ctx.pointer.clone(),
            }),
        }
    }

    // -- any (§3.6) --------------------------------------------------------

    /// `any` compiles to a zero-field record: a hole a writer schema fills in
    /// and a reader schema steps over.
    ///
    /// This is asymmetric, and the asymmetry is the whole point, so it is worth
    /// stating plainly. Avro resolves records by name and ignores writer fields
    /// the reader does not declare. A reader holding this empty record therefore
    /// accepts *whatever* the writer put there and hands back an empty record —
    /// the data is read as if the reader did not know its shape, which is
    /// exactly what `any` means.
    ///
    /// What you cannot do is write through the hole. The compiled schema is a
    /// reader schema at this position; `apache-avro` rejects a non-empty record
    /// value against a zero-field schema. To produce data, compile or hand-write
    /// a writer schema in which the hole is filled with the concrete type.
    fn any_record(&mut self, name: &str, namespace: &str, pointer: &str) -> Value {
        self.warnings.push(Warning {
            path: pointer.to_string(),
            message:
                "`any` compiles to an empty Avro record: readable but not writable at this \
                 position. A writer must supply a schema that fills the hole with a concrete \
                 type; inside `array`/`map` every element must share that one type, because \
                 Avro collections are homogeneous"
                    .to_string(),
        });
        empty_record(name, namespace)
    }

    // -- enums (§4.1) ------------------------------------------------------

    fn try_enum(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        namespace: &str,
        pointer: &str,
    ) -> Result<Option<Value>, AvroError> {
        let Some(values) = decl.get("enum").and_then(Value::as_array) else {
            return Ok(None);
        };
        if decl.get("type").and_then(Value::as_str) != Some("string") {
            return Ok(None);
        }

        let overrides = decl
            .get("altenums")
            .and_then(Value::as_object)
            .and_then(|m| m.get("avro"))
            .and_then(Value::as_object);

        let mut symbols = Vec::new();
        let mut seen = HashSet::new();
        for value in values {
            let Some(raw) = value.as_str() else {
                return Ok(None);
            };
            let symbol = match overrides.and_then(|o| o.get(raw)).and_then(Value::as_str) {
                Some(mapped) => {
                    if !is_avro_name(mapped) {
                        return Err(AvroError::IllegalName {
                            name: mapped.to_string(),
                            path: format!("{pointer}/altenums/avro/{raw}"),
                        });
                    }
                    mapped.to_string()
                }
                None => {
                    // Not expressible as an Avro enum; fall back to `string`.
                    if !is_avro_name(raw) {
                        return Ok(None);
                    }
                    raw.to_string()
                }
            };
            if !seen.insert(symbol.clone()) {
                return Ok(None);
            }
            symbols.push(Value::String(symbol));
        }
        if symbols.is_empty() {
            return Ok(None);
        }

        let mut out = Map::new();
        out.insert("type".to_string(), Value::String("enum".to_string()));
        out.insert("name".to_string(), Value::String(name.to_string()));
        if !namespace.is_empty() {
            out.insert("namespace".to_string(), Value::String(namespace.to_string()));
        }
        if let Some(doc) = self.doc_of(decl) {
            out.insert("doc".to_string(), Value::String(doc));
        }
        out.insert("symbols".to_string(), Value::Array(symbols.clone()));

        // An Avro reader fails on an unknown symbol unless the enum has a
        // default, so carry one through whenever the schema offers it.
        if let Some(default) = decl.get("default").and_then(Value::as_str) {
            let mapped = overrides
                .and_then(|o| o.get(default))
                .and_then(Value::as_str)
                .unwrap_or(default);
            if symbols.iter().any(|s| s.as_str() == Some(mapped)) {
                out.insert("default".to_string(), Value::String(mapped.to_string()));
            }
        }

        self.reserved.insert(qualify(namespace, name));
        Ok(Some(Value::Object(out)))
    }

    // -- helpers -----------------------------------------------------------

    /// Applies §3.2: nullability, union flattening, and default placement.
    fn nullable(
        &self,
        base: Value,
        required: bool,
        default: Option<&Value>,
        pointer: &str,
    ) -> Result<(Value, Option<Value>), AvroError> {
        let mut branches = flatten_union(base);

        let default = match default {
            // A required field keeps its declared type untouched.
            None if required => return Ok((union_of(branches), None)),
            None => None,
            Some(value) if value.is_null() && !required => None,
            Some(value) => Some(value.clone()),
        };

        let Some(default) = default else {
            if required {
                return Ok((union_of(branches), None));
            }
            // Optional with no usable default: `null` leads and defaults to null.
            branches.retain(|b| !is_null_branch(b));
            branches.insert(0, Value::String("null".to_string()));
            return Ok((union_of(branches), Some(Value::Null)));
        };

        // Avro validates a field default against the **first** branch of a union
        // and nothing else. A JSON Structure default that names a later branch
        // is not wrong, it is merely in the wrong place, so move the branch it
        // names to the front instead of emitting a default that parses cleanly
        // and then fails at read-time resolution.
        let default = place_default(&mut branches, default, pointer)?;

        if !required && !branches.iter().any(is_null_branch) {
            branches.push(Value::String("null".to_string()));
        }
        // A lone branch collapses to the bare type, where the default is checked
        // against the type itself rather than against a first branch.
        Ok((union_of(branches), Some(default)))
    }

    fn check_additional_properties(
        &mut self,
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<(), AvroError> {
        let open = match decl.get("additionalProperties") {
            None => false,
            Some(Value::Bool(false)) => false,
            Some(_) => true,
        };
        if !open {
            return Ok(());
        }
        let message = "Avro records are closed; `additionalProperties` cannot be carried \
                       and undeclared properties will not be transmitted"
            .to_string();
        match self.opts.additional_properties {
            AdditionalProperties::Error => Err(AvroError::Invalid {
                message,
                path: pointer.to_string(),
            }),
            AdditionalProperties::Ignore => {
                self.warnings.push(Warning {
                    path: pointer.to_string(),
                    message,
                });
                Ok(())
            }
        }
    }

    /// The declared Avro name of a type: `altnames.avro`, else `name` (§6.1).
    fn declared_name(
        &self,
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<Option<String>, AvroError> {
        if let Some(alt) = self.alt_name(decl, pointer)? {
            return Ok(Some(alt));
        }
        Ok(decl.get("name").and_then(Value::as_str).map(str::to_string))
    }

    fn alt_name(
        &self,
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<Option<String>, AvroError> {
        let Some(alt) = decl
            .get("altnames")
            .and_then(Value::as_object)
            .and_then(|m| m.get("avro"))
        else {
            return Ok(None);
        };
        let name = alt.as_str().ok_or_else(|| AvroError::Invalid {
            message: "`altnames.avro` must be a string".to_string(),
            path: format!("{pointer}/altnames/avro"),
        })?;
        if !is_avro_name(name) {
            return Err(AvroError::IllegalName {
                name: name.to_string(),
                path: format!("{pointer}/altnames/avro"),
            });
        }
        Ok(Some(name.to_string()))
    }

    fn doc_of(&self, decl: &Map<String, Value>) -> Option<String> {
        if !self.opts.emit_doc {
            return None;
        }
        let base = decl.get("description").and_then(Value::as_str);
        if self.opts.mode != Mode::Full {
            return base.map(str::to_string);
        }
        // §6.4.1: `full` mode appends Avrotize's constraint annotation, because
        // interoperating with Avrotize-generated schemas is the point of the
        // mode. It is a display string; nothing parses it back.
        let annotations: Vec<String> = DOC_ANNOTATIONS
            .iter()
            .filter_map(|(keyword, label)| {
                decl.get(*keyword)
                    .map(|value| format!("{label}: {}", lexical(value)))
            })
            .collect();
        match (base, annotations.is_empty()) {
            (None, true) => None,
            (None, false) => Some(format!("[{}]", annotations.join(", "))),
            (Some(text), true) => Some(text.to_string()),
            (Some(text), false) => Some(format!("{text} [{}]", annotations.join(", "))),
        }
    }

    /// Renders a primitive.
    ///
    /// `decimal` is resolved in both modes (§2.3); the `full`-mode annotations
    /// of §2.5 ride on top of the base type without changing it.
    fn primitive_value(
        &mut self,
        type_name: &str,
        primitive: &str,
        decl: &Map<String, Value>,
        ctx: &Ctx,
    ) -> Value {
        if type_name == "decimal" {
            return self.decimal_value(decl, ctx);
        }

        if self.opts.mode == Mode::Full {
            if let Some(logical) = avro_logical(type_name) {
                let mut out = Map::new();
                out.insert("type".to_string(), Value::String(primitive.to_string()));
                out.insert("logicalType".to_string(), Value::String(logical.to_string()));
                return Value::Object(out);
            }
        }

        Value::String(primitive.to_string())
    }

    /// §2.3: `decimal` carries Avro's own `decimal` logical type on a `bytes`
    /// base, in both modes. Avro is exactly right here, so the choice does not
    /// belong to a mode.
    ///
    /// Avro requires a `precision` and forbids a `scale` above it. Neither can
    /// be invented, so a declaration that satisfies neither falls back to a
    /// lexical `string` with a warning.
    fn decimal_value(&mut self, decl: &Map<String, Value>, ctx: &Ctx) -> Value {
        let Some(precision) = decl.get("precision").and_then(Value::as_u64) else {
            self.warnings.push(Warning {
                path: ctx.pointer.clone(),
                message: "`decimal` declares no `precision`, which Avro's decimal logical type \
                          requires; the value is carried as a lexical string"
                    .to_string(),
            });
            return Value::String("string".to_string());
        };

        let scale = decl.get("scale").and_then(Value::as_u64).unwrap_or(0);
        if scale > precision {
            self.warnings.push(Warning {
                path: ctx.pointer.clone(),
                message: format!(
                    "`decimal` declares scale {scale} greater than precision {precision}, which \
                     Avro forbids; the value is carried as a lexical string"
                ),
            });
            return Value::String("string".to_string());
        }

        let mut out = Map::new();
        out.insert("type".to_string(), Value::String("bytes".to_string()));
        out.insert(
            "logicalType".to_string(),
            Value::String("decimal".to_string()),
        );
        out.insert("precision".to_string(), Value::from(precision));
        out.insert("scale".to_string(), Value::from(scale));
        Value::Object(out)
    }

    /// Mints a generated name, suffixing on collision (§6.3).
    fn mint_name(&mut self, ctx: &Ctx) -> String {
        let hint = ctx.hint.clone();
        self.mint_named(&hint, ctx)
    }

    /// Mints a generated name from an explicit base rather than `ctx.hint`.
    /// Tagged-union branch wrappers use this: §3.7.1 wants them named for the
    /// choice key, but the name still has to be reserved like any other.
    fn mint_named(&mut self, base: &str, ctx: &Ctx) -> String {
        let namespace = &ctx.namespace;
        let mut candidate = base.to_string();
        let mut counter = 2;
        while self.reserved.contains(&qualify(namespace, &candidate)) {
            candidate = format!("{base}_{counter}");
            counter += 1;
        }
        if candidate != *base {
            self.warnings.push(Warning {
                path: ctx.pointer.clone(),
                message: format!(
                    "generated name `{}` is already taken; \
                     this anonymous type is named `{}` instead",
                    qualify(namespace, base),
                    qualify(namespace, &candidate)
                ),
            });
        }
        self.reserved.insert(qualify(namespace, &candidate));
        candidate
    }

    fn namespace_for(&self, path: &[String]) -> String {
        path.join(".")
    }

    fn resolve(
        &self,
        pointer: &str,
        from: &str,
    ) -> Result<(&'a Value, Vec<String>), AvroError> {
        let path = definition_path(pointer).ok_or_else(|| AvroError::UnresolvedRef {
            pointer: pointer.to_string(),
            path: from.to_string(),
        })?;
        let value = self.lookup(&path).ok_or_else(|| AvroError::UnresolvedRef {
            pointer: pointer.to_string(),
            path: from.to_string(),
        })?;
        Ok((value, path))
    }

    fn lookup(&self, path: &[String]) -> Option<&'a Value> {
        let mut current = self.doc.get("definitions")?;
        for segment in path {
            current = current.get(segment)?;
        }
        Some(current)
    }
}

// -- free functions --------------------------------------------------------

/// The primitive mapping table of §2. `None` means the name is not a primitive.
///
/// This is the *wire* type and is the same in both modes; `full` mode only adds
/// annotations on top of it (§2.5).
fn avro_primitive(type_name: &str) -> Option<&'static str> {
    Some(match type_name {
        "null" => "null",
        "boolean" => "boolean",
        "string" => "string",
        "number" => "double",
        "integer" | "int8" | "int16" | "int32" | "uint8" | "uint16" => "int",
        "int64" | "uint32" => "long",
        // Lossless by construction: these exceed a signed 64-bit range, so they
        // travel in their lexical form (§2.2).
        "int128" | "uint64" | "uint128" => "string",
        "float8" | "float" => "float",
        "double" => "double",
        // Only when `precision` is declared; `primitive_value` falls back to
        // `string` and warns otherwise (§2.3).
        "decimal" => "bytes",
        // Avro has no offset-carrying temporal type; RFC 3339 text keeps it.
        "date" | "time" | "datetime" | "duration" => "string",
        "uuid" | "uri" | "jsonpointer" => "string",
        "binary" => "bytes",
        _ => return None,
    })
}

/// The `full`-mode logical annotation for a primitive (§2.5), over the *same*
/// base type `avro_primitive` already chose.
///
/// The `rfc3339-*` names are Avrotize's extension. They are not reserved Avro
/// logical types, which is exactly the point: a reader that does not know the
/// name sees the `string` base and is correct, so `full` and `compact` describe
/// byte-identical data. Avro's own `date` and `timestamp-micros` would instead
/// move the value onto an integer base and discard the RFC 3339 offset.
fn avro_logical(type_name: &str) -> Option<&'static str> {
    Some(match type_name {
        "date" => "rfc3339-date",
        "time" => "rfc3339-time-micros",
        "datetime" => "rfc3339-timestamp-micros",
        "duration" => "rfc3339-duration",
        "uuid" => "uuid",
        _ => return None,
    })
}

/// The constraint keywords §6.4.1 appends to `doc` in `full` mode, in their
/// fixed emission order, paired with the annotation label.
const DOC_ANNOTATIONS: &[(&str, &str)] = &[
    ("maxLength", "maxLength"),
    ("minLength", "minLength"),
    ("precision", "precision"),
    ("scale", "scale"),
    ("pattern", "pattern"),
    ("minimum", "minimum"),
    ("maximum", "maximum"),
    ("contentEncoding", "encoding"),
    ("contentMediaType", "mediaType"),
    ("contentCompression", "compression"),
];

/// Avro identifier rule, which is also JSON Structure's identifier rule.
fn is_avro_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn qualify(namespace: &str, name: &str) -> String {
    if namespace.is_empty() {
        name.to_string()
    } else {
        format!("{namespace}.{name}")
    }
}

fn definition_pointer(path: &[String]) -> String {
    if path.is_empty() {
        "#/definitions".to_string()
    } else {
        format!("#/definitions/{}", path.join("/"))
    }
}

fn definition_path(pointer: &str) -> Option<Vec<String>> {
    let rest = pointer.strip_prefix("#/definitions/")?;
    if rest.is_empty() {
        return None;
    }
    Some(rest.split('/').map(str::to_string).collect())
}

fn pointer_list(value: &Value, path: &str) -> Result<Vec<String>, AvroError> {
    match value {
        Value::String(s) => Ok(vec![s.clone()]),
        Value::Array(items) => items
            .iter()
            .map(|i| {
                i.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| AvroError::Invalid {
                        message: "`$extends` entries must be JSON Pointers".to_string(),
                        path: path.to_string(),
                    })
            })
            .collect(),
        _ => Err(AvroError::Invalid {
            message: "`$extends` must be a JSON Pointer or an array of them".to_string(),
            path: path.to_string(),
        }),
    }
}

/// Core lets `required` be either a flat list of names or a list of *alternative*
/// sets, any one of which satisfies the type. Neither Avro nor Protobuf can
/// express that disjunction.
///
/// The sound reduction is the **intersection**: a property in every alternative
/// is present no matter which alternative holds, so it can be a non-null field.
/// A property in only some alternatives may legitimately be absent, so it must
/// stay optional. Taking the union instead would emit non-null fields for data
/// that is allowed to omit them, which fails at write time; dropping the
/// keyword — the previous behavior — quietly retypes every field in the record.
///
/// Returns the intersection and, when alternatives were present, a note for the
/// caller to warn with.
fn required_set(decl: &Map<String, Value>) -> (HashSet<String>, Option<String>) {
    let Some(items) = decl.get("required").and_then(Value::as_array) else {
        return (HashSet::new(), None);
    };

    let alternatives: Vec<HashSet<String>> = items
        .iter()
        .filter_map(|item| item.as_array())
        .map(|set| {
            set.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .collect();

    if alternatives.is_empty() {
        let flat = items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        return (flat, None);
    }

    let mut intersection = alternatives[0].clone();
    for alternative in &alternatives[1..] {
        intersection.retain(|name| alternative.contains(name));
    }
    let mut shared: Vec<_> = intersection.iter().cloned().collect();
    shared.sort();
    let note = format!(
        "`required` declares {} alternative sets; the target has no way to express \
         that choice. Only the properties common to every alternative [{}] are emitted \
         as non-null, and the alternatives are not enforced on the wire",
        alternatives.len(),
        shared.join(", ")
    );
    (intersection, Some(note))
}

/// Every `selector` name belonging to an inline union anywhere in the document.
/// Core permits an inline union's selector to shadow a base-type property, so
/// these names are exempt from the no-redefinition rule.
fn collect_selectors(doc: &Value) -> HashSet<String> {
    fn walk(node: &Value, out: &mut HashSet<String>) {
        match node {
            Value::Object(map) => {
                if map.contains_key("$extends") {
                    if let Some(selector) = map.get("selector").and_then(Value::as_str) {
                        out.insert(selector.to_string());
                    }
                }
                for value in map.values() {
                    walk(value, out);
                }
            }
            Value::Array(items) => {
                for value in items {
                    walk(value, out);
                }
            }
            _ => {}
        }
    }

    let mut out = HashSet::new();
    walk(doc, &mut out);
    out
}

fn empty_record(name: &str, namespace: &str) -> Value {
    let mut out = Map::new();
    out.insert("type".to_string(), Value::String("record".to_string()));
    out.insert("name".to_string(), Value::String(name.to_string()));
    if !namespace.is_empty() {
        out.insert("namespace".to_string(), Value::String(namespace.to_string()));
    }
    out.insert("fields".to_string(), Value::Array(Vec::new()));
    Value::Object(out)
}

/// Whether this node declares a type, as opposed to being a namespace holding
/// further definitions.
fn is_type_declaration(node: &Map<String, Value>) -> bool {
    node.contains_key("type") || node.contains_key("$extends") || node.contains_key("abstract")
}

fn is_null_branch(value: &Value) -> bool {
    value.as_str() == Some("null")
}

fn flatten_union(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items.into_iter().flat_map(flatten_union).collect(),
        other => vec![other],
    }
}

/// Positions `default` so that Avro will accept it, reordering `branches` if it
/// has to, and rejects it if no branch can hold it.
///
/// Avro checks a field default against exactly one schema: the first branch of a
/// union, or the type itself when there is no union. That is a placement rule,
/// not a value rule, so a default naming some other branch is fixed by moving
/// the branch, not by dropping the default. Emitting the default anyway is the
/// dangerous option — `parse_str` accepts it and the failure surfaces much later
/// as a resolution error against real data.
///
/// A JSON Structure tagged-union default arrives as `{"<branch>": value}`; the
/// tag is consumed here because Avro writes a union default as the bare value of
/// its first branch.
fn place_default(
    branches: &mut [Value],
    default: Value,
    pointer: &str,
) -> Result<Value, AvroError> {
    let reject = |value: &Value, branches: &[Value]| AvroError::Invalid {
        message: format!(
            "`default` {} matches no branch of the generated Avro type [{}]; \
             Avro validates a default against the first branch only",
            value,
            branches
                .iter()
                .map(|b| branch_tag(b).unwrap_or_else(|| "?".to_string()))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        path: pointer.to_string(),
    };

    // A tagged default names its branch outright, which is more reliable than
    // inferring one from the JSON shape.
    if branches.len() > 1 {
        if let Some(map) = default.as_object() {
            if map.len() == 1 {
                let (tag, inner) = map.iter().next().expect("length checked");
                if let Some(index) = branches
                    .iter()
                    .position(|b| branch_tag(b).as_deref() == Some(tag.as_str()))
                {
                    let mut inner = inner.clone();
                    // A branch whose Avro name did not already match the choice
                    // key was wrapped in a single-field record (§3.7.1), so the
                    // default has to be wrapped the same way.
                    if !default_matches(&branches[index], &inner) && is_branch_wrapper(&branches[index])
                    {
                        let mut wrapper = Map::new();
                        wrapper.insert("value".to_string(), inner);
                        inner = Value::Object(wrapper);
                    }
                    if !default_matches(&branches[index], &inner) {
                        return Err(reject(&inner, branches));
                    }
                    branches[..=index].rotate_right(1);
                    return Ok(inner);
                }
            }
        }
    }

    let Some(index) = branches.iter().position(|b| default_matches(b, &default)) else {
        return Err(reject(&default, branches));
    };
    branches[..=index].rotate_right(1);
    Ok(default)
}

/// Whether this branch is the single-field record §3.7.1 generates for a choice
/// key that did not already name an Avro type.
fn is_branch_wrapper(branch: &Value) -> bool {
    let Some(map) = branch.as_object() else {
        return false;
    };
    if map.get("type").and_then(Value::as_str) != Some("record") {
        return false;
    }
    let Some(fields) = map.get("fields").and_then(Value::as_array) else {
        return false;
    };
    fields.len() == 1 && fields[0].get("name").and_then(Value::as_str) == Some("value")
}

/// The name a tagged union value would use for this branch: the unqualified
/// Avro name, which is what {{tagged-unions}} keys on.
fn branch_tag(branch: &Value) -> Option<String> {
    let name = match branch {
        Value::String(name) => name.as_str(),
        Value::Object(map) => map
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| map.get("type").and_then(Value::as_str))?,
        _ => return None,
    };
    Some(name.rsplit('.').next().unwrap_or(name).to_string())
}

/// Whether a JSON default *could* be an Avro value of this schema.
///
/// Deliberately structural rather than exhaustive: it catches the mismatches
/// that corrupt reads — an object where a number belongs, a tagged union value
/// left wrapped — without reimplementing Avro's validator.
fn default_matches(branch: &Value, default: &Value) -> bool {
    let type_name = match branch {
        Value::String(name) => name.as_str(),
        Value::Object(map) => match map.get("type") {
            Some(Value::String(name)) => name.as_str(),
            // A nested union in a branch position; Avro forbids it, and
            // `flatten_union` has already removed it.
            _ => return true,
        },
        Value::Array(_) => return true,
        _ => return false,
    };

    match type_name {
        "null" => default.is_null(),
        "boolean" => default.is_boolean(),
        "int" | "long" => default.is_i64() || default.is_u64(),
        "float" | "double" => default.is_number(),
        // Avro encodes `bytes` and `fixed` defaults as strings.
        "string" | "bytes" | "fixed" | "enum" => default.is_string(),
        "array" => default.is_array(),
        "record" | "map" => default.is_object(),
        // A bare name referring to a previously defined type. The definition is
        // not in hand here, so accept anything but a plainly impossible shape.
        _ => true,
    }
}

/// Builds a union from `branches`, deduplicating by Avro type identity and
/// collapsing a single branch to the bare type (§3.8).
fn union_of(branches: Vec<Value>) -> Value {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for branch in branches.into_iter().flat_map(flatten_union) {
        let key = type_key(&branch);
        if seen.insert(key) {
            out.push(branch);
        }
    }
    if out.len() == 1 {
        out.into_iter().next().expect("length checked")
    } else {
        Value::Array(out)
    }
}

/// Identity of an Avro type for union deduplication. Named types are identified
/// by their fully-qualified name so a definition and a later reference to it
/// collapse to one branch.
///
/// Everything else is identified by its Avro *type*, which is exactly the rule
/// Avro states: a union may not hold two schemas of the same type unless they
/// are `record`, `enum`, or `fixed`. That matters in `full` mode, where a `date`
/// is `{"type": "int", "logicalType": "date"}` and would otherwise sit beside a
/// plain `int` in a union that no Avro parser will accept.
fn type_key(value: &Value) -> String {
    match value {
        Value::String(name) => name.clone(),
        Value::Object(map) => match map.get("type").and_then(Value::as_str) {
            Some("record" | "enum" | "fixed") => {
                let name = map.get("name").and_then(Value::as_str).unwrap_or_default();
                let namespace = map.get("namespace").and_then(Value::as_str).unwrap_or("");
                qualify(namespace, name)
            }
            Some(other) => other.to_string(),
            None => value.to_string(),
        },
        other => other.to_string(),
    }
}

/// Renders a JSON value in its lexical form for a §6.4.1 `doc` annotation.
/// Strings appear unquoted; a `pattern` reads better as `pattern: ^a+$` than as
/// `pattern: "^a+$"`, and nothing parses this back.
fn lexical(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// The unqualified Avro name of a compiled type, if it has one.
fn unqualified_name(value: &Value) -> Option<String> {
    match value {
        Value::String(name) => Some(
            name.rsplit('.')
                .next()
                .unwrap_or(name.as_str())
                .to_string(),
        ),
        Value::Object(map) => map
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    }
}
