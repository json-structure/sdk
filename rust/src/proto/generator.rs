//! The proto3 generator proper. See `spec/json-structure-to-proto.md` for the
//! normative mapping; section references in the comments point back at it.

use super::ir::{self, Decl, Enum, EnumValue, Field, File, Member, Message, Oneof, Rule};
use super::{AdditionalProperties, GenerateOutput, ProtoFile, ProtoOptions, Warning};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// The field-number lock format version. Bumped whenever the shape changes, so
/// that a stale lock is rejected rather than silently ignored — an ignored lock
/// renumbers every field, which is precisely the corruption the lock prevents.
pub(crate) const LOCK_VERSION: u64 = 2;

/// A fatal generation problem.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ProtoError {
    /// The document has no root type and no definitions either.
    #[error(
        "document declares neither `type` nor `$root`, and has no `definitions`; \
         nothing to generate"
    )]
    NoRootType,

    /// A `$ref`, `$extends`, or `$offers` pointer does not resolve.
    #[error("cannot resolve '{pointer}' (at {path})")]
    UnresolvedRef {
        /// The pointer that failed.
        pointer: String,
        /// JSON Pointer of the referring node.
        path: String,
    },

    /// The schema is not expressible in proto3, or is malformed.
    #[error("{message} (at {path})")]
    Invalid {
        /// What is wrong.
        message: String,
        /// JSON Pointer of the offending node.
        path: String,
    },

    /// An `altnames`/`altenums` override is not a legal protobuf identifier.
    #[error("'{name}' is not a legal protobuf identifier (at {path})")]
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

    /// Two field numbers collide, or a pin contradicts the lock file.
    #[error("{message} (in message {message_name})")]
    Numbering {
        /// What is wrong.
        message: String,
        /// The fully qualified message name.
        message_name: String,
    },

    /// Two packages reference each other; `protoc` forbids circular imports.
    #[error("packages '{a}' and '{b}' reference each other; protoc forbids circular file imports. Put mutually-referencing types in one namespace.")]
    ImportCycle {
        /// One participating package.
        a: String,
        /// The other participating package.
        b: String,
    },
}

impl ProtoError {
    /// The variant name, so a conformance harness can assert *which* error was
    /// raised rather than trusting a substring of the message.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NoRootType => "NoRootType",
            Self::UnresolvedRef { .. } => "UnresolvedRef",
            Self::Invalid { .. } => "Invalid",
            Self::IllegalName { .. } => "IllegalName",
            Self::UnknownAddIn { .. } => "UnknownAddIn",
            Self::Numbering { .. } => "Numbering",
            Self::ImportCycle { .. } => "ImportCycle",
        }
    }

    /// JSON Pointer of the offending node, where the variant carries one.
    pub fn path(&self) -> Option<&str> {
        match self {
            Self::UnresolvedRef { path, .. }
            | Self::Invalid { path, .. }
            | Self::IllegalName { path, .. } => Some(path),
            Self::NoRootType | Self::UnknownAddIn { .. } | Self::Numbering { .. } | Self::ImportCycle { .. } => None,
        }
    }
}

/// Where a named type lives once generation is planned.
#[derive(Debug, Clone)]
struct Registered {
    /// Fully qualified protobuf name, e.g. `com.example.sales.Order`.
    fq: String,
    /// Index into `Generator::files`.
    file: usize,
    /// Whether the declaration is abstract and therefore never emitted.
    abstract_: bool,
    /// JSON Pointer of the declaration.
    pointer: String,
}

/// An add-in selected via the `uses` option.
struct AddIn {
    target: String,
    schema: Value,
    pointer: String,
}

/// Naming and error context for a schema node.
#[derive(Clone)]
struct Ctx {
    /// Base for generated names (§7.2).
    hint: String,
    /// The property name this node hangs off, if any. Used to name `oneof`s.
    member: Option<String>,
    /// JSON Pointer, for error reporting.
    pointer: String,
    /// Index of the file being written into.
    file: usize,
}

/// One field of a message, after `$extends` and add-in flattening.
struct FieldSpec {
    key: String,
    schema: Value,
    required: bool,
    pointer: String,
}

pub(crate) struct Generator<'a> {
    doc: &'a Value,
    opts: &'a ProtoOptions,
    files: Vec<File>,
    /// Definition path (joined with `/`) → registration.
    registry: HashMap<String, Registered>,
    /// Names taken per file, for generated-name collision suffixing.
    taken: HashSet<String>,
    /// Package → packages it references, for cycle detection.
    edges: Vec<(String, String)>,
    warnings: Vec<Warning>,
    addins: Vec<AddIn>,
    /// Selector names of inline unions, exempt from the no-redefinition rule.
    shadowable: HashSet<String>,
    /// The lock as it is being rebuilt.
    lock_out: Map<String, Value>,
    /// Protobuf package → the JSON Structure namespace paths that produced it.
    /// Package segments are lowercased (§5.2), and Core namespace names are
    /// case-sensitive, so two distinct namespaces can land on one package.
    package_sources: HashMap<String, Vec<String>>,
    /// Fully qualified enum symbol → the enum that declared it. Protobuf uses
    /// C++ scoping for enum values, so symbols are siblings of their enum and
    /// two enums in one package may not share one (§4.1).
    enum_symbols: HashMap<String, String>,
}

impl<'a> Generator<'a> {
    pub(crate) fn new(doc: &'a Value, opts: &'a ProtoOptions) -> Self {
        let mut lock_out = Map::new();
        lock_out.insert("version".to_string(), Value::from(LOCK_VERSION));
        lock_out.insert("messages".to_string(), Value::Object(Map::new()));
        lock_out.insert("enums".to_string(), Value::Object(Map::new()));
        Self {
            doc,
            opts,
            files: Vec::new(),
            registry: HashMap::new(),
            taken: HashSet::new(),
            edges: Vec::new(),
            warnings: Vec::new(),
            addins: Vec::new(),
            shadowable: HashSet::new(),
            lock_out,
            package_sources: HashMap::new(),
            enum_symbols: HashMap::new(),
        }
    }

    pub(crate) fn run(mut self) -> Result<GenerateOutput, ProtoError> {
        if let Some(lock) = &self.opts.numbers {
            let version = lock.get("version").and_then(Value::as_u64);
            if version != Some(LOCK_VERSION) {
                return Err(ProtoError::Numbering {
                    message: format!(
                        "field-number lock has version {}, but this implementation writes version {LOCK_VERSION}; \
                         regenerate the lock rather than letting it be ignored",
                        version.map_or_else(|| "none".to_string(), |v| v.to_string())
                    ),
                    message_name: "<lock>".to_string(),
                });
            }
        }
        self.shadowable = collect_selectors(self.doc);
        self.collect_addins()?;
        let plan = self.plan()?;
        self.check_package_collisions()?;

        for (path, pointer) in plan {
            let registered = self
                .registry
                .get(&path.join("/"))
                .cloned()
                .expect("planned types are registered");
            if registered.abstract_ {
                continue;
            }
            let decl = self
                .lookup(&path)
                .cloned()
                .ok_or_else(|| ProtoError::UnresolvedRef {
                    pointer: pointer.clone(),
                    path: pointer.clone(),
                })?;
            let map = decl.as_object().ok_or_else(|| ProtoError::Invalid {
                message: "type declaration must be a JSON object".to_string(),
                path: pointer.clone(),
            })?;
            let name = registered
                .fq
                .rsplit('.')
                .next()
                .expect("fq names have a last segment")
                .to_string();
            let ctx = Ctx {
                hint: name.clone(),
                member: None,
                pointer: pointer.clone(),
                file: registered.file,
            };
            let package = self.files[registered.file].package.clone();
            let decl = self.build_named(map, &name, &package, &ctx)?;
            self.files[registered.file].decls.push(decl);
        }

        self.check_import_cycles()?;

        let mut files: Vec<ProtoFile> = self
            .files
            .iter()
            .filter(|f| !f.decls.is_empty())
            .map(|f| ProtoFile {
                path: f.path.clone(),
                package: f.package.clone(),
                contents: ir::render(f),
            })
            .collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));

        if files.is_empty() {
            return Err(ProtoError::NoRootType);
        }

        Ok(GenerateOutput {
            files,
            numbers: Value::Object(self.lock_out),
            warnings: self.warnings,
        })
    }

    // -- planning ----------------------------------------------------------

    /// Registers every named type and its destination file, in document order.
    ///
    /// Registration has to happen before generation because a type may
    /// reference another that appears later in the document, and the reference
    /// needs both the fully qualified name and the file to import.
    fn plan(&mut self) -> Result<Vec<(Vec<String>, String)>, ProtoError> {
        let mut plan = Vec::new();

        if let Some(definitions) = self.doc.get("definitions").and_then(Value::as_object) {
            self.plan_namespace(definitions, &[], &mut plan)?;
        }

        // An inline root type is not in `definitions` and needs its own entry.
        let has_root_pointer = self.doc.get("$root").is_some();
        if let Some(pointer) = self.doc.get("$root").and_then(Value::as_str) {
            let (root, _) = self.resolve(pointer, "#/$root")?;
            if root.get("abstract").and_then(Value::as_bool) == Some(true) {
                return Err(ProtoError::Invalid {
                    message: "the root type is abstract and cannot be generated".to_string(),
                    path: pointer.to_string(),
                });
            }
        }
        let inline_root = self.doc.get("type").is_some();
        if !inline_root && !has_root_pointer && plan.is_empty() {
            return Err(ProtoError::NoRootType);
        }
        if inline_root {
            let root = self.doc.as_object().expect("checked by caller");
            let name = self
                .declared_name(root, "#")?
                .unwrap_or_else(|| "Root".to_string());
            let file = self.file_for(&[]);
            let package = self.files[file].package.clone();
            self.registry.insert(
                "#".to_string(),
                Registered {
                    fq: qualify(&package, &name),
                    file,
                    abstract_: false,
                    pointer: "#".to_string(),
                },
            );
            self.taken.insert(qualify(&package, &name));
            plan.push((vec!["#".to_string()], "#".to_string()));
        }

        if plan.is_empty() {
            return Err(ProtoError::NoRootType);
        }
        Ok(plan)
    }

    fn plan_namespace(
        &mut self,
        node: &Map<String, Value>,
        path: &[String],
        plan: &mut Vec<(Vec<String>, String)>,
    ) -> Result<(), ProtoError> {
        for (key, value) in node {
            let Some(map) = value.as_object() else { continue };
            let mut child_path = path.to_vec();
            child_path.push(key.clone());

            if is_type_declaration(map) {
                let pointer = definition_pointer(&child_path);
                let name = self.declared_name(map, &pointer)?.unwrap_or_else(|| key.clone());
                let file = self.file_for(path);
                let package = self.files[file].package.clone();
                let fq = qualify(&package, &name);
                if !self.taken.insert(fq.clone()) {
                    return Err(ProtoError::Invalid {
                        message: format!(
                            "two declared types both map to the protobuf name `{fq}`"
                        ),
                        path: pointer,
                    });
                }
                self.registry.insert(
                    child_path.join("/"),
                    Registered {
                        fq,
                        file,
                        abstract_: map.get("abstract").and_then(Value::as_bool) == Some(true),
                        pointer: pointer.clone(),
                    },
                );
                plan.push((child_path, pointer));
            } else {
                self.plan_namespace(map, &child_path, plan)?;
            }
        }
        Ok(())
    }

    /// Rejects two Core namespaces that lowercase onto one protobuf package.
    ///
    /// Core namespace names are case-sensitive; protobuf package segments are
    /// lowercased (§5.2). `Sales` and `sales` are therefore two namespaces in
    /// the source and one package in the output, which merges their contents
    /// into a single file and silently changes the fully-qualified name of
    /// every type in at least one of them.
    fn check_package_collisions(&self) -> Result<(), ProtoError> {
        let mut collisions: Vec<(&String, &Vec<String>)> = self
            .package_sources
            .iter()
            .filter(|(_, sources)| sources.len() > 1)
            .collect();
        collisions.sort_by_key(|(package, _)| *package);

        let Some((package, sources)) = collisions.first() else {
            return Ok(());
        };
        let mut sources = (*sources).clone();
        sources.sort();
        Err(ProtoError::Invalid {
            message: format!(
                "namespaces [{}] all lowercase to the protobuf package `{package}`; \
                 protobuf package segments are lowercased, so these namespaces would merge. \
                 Rename them in the JSON Structure document so they differ by more than case",
                sources.join(", ")
            ),
            path: "#/definitions".to_string(),
        })
    }

    /// Finds or creates the file for a namespace path (§5.2).
    fn file_for(&mut self, path: &[String]) -> usize {
        let segments: Vec<String> = path.iter().map(|s| s.to_ascii_lowercase()).collect();

        let package = segments.join(".");
        let file_path = if segments.is_empty() {
            format!("{}.proto", self.document_stem())
        } else {
            format!("{}.proto", segments.join("/"))
        };

        let origin = path.join(".");
        let sources = self.package_sources.entry(package.clone()).or_default();
        if !sources.contains(&origin) {
            sources.push(origin);
        }

        if let Some(index) = self.files.iter().position(|f| f.path == file_path) {
            return index;
        }
        self.files.push(File {
            path: file_path,
            package,
            imports: Vec::new(),
            decls: Vec::new(),
        });
        self.files.len() - 1
    }

    /// The filename stem for types that sit outside any namespace: the root
    /// type's name, else the last segment of `$id`, else `schema`.
    fn document_stem(&self) -> String {
        if let Some(name) = self.doc.get("name").and_then(Value::as_str) {
            return name.to_ascii_lowercase();
        }
        if let Some(id) = self.doc.get("$id").and_then(Value::as_str) {
            let last = id.trim_end_matches('/').rsplit('/').next().unwrap_or("");
            let cleaned: String = last
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                        c.to_ascii_lowercase()
                    } else {
                        '_'
                    }
                })
                .collect();
            if !cleaned.is_empty() {
                return cleaned;
            }
        }
        "schema".to_string()
    }

    // -- add-ins (§5.5) ----------------------------------------------------

    fn collect_addins(&mut self) -> Result<(), ProtoError> {
        if self.opts.uses.is_empty() {
            return Ok(());
        }
        let requested: HashSet<&str> = self.opts.uses.iter().map(String::as_str).collect();
        let mut found: HashSet<&str> = HashSet::new();

        if let Some(offers) = self.doc.get("$offers").and_then(Value::as_object) {
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
                    let pointer = pointer_value.as_str().ok_or_else(|| ProtoError::Invalid {
                        message: "`$offers` values must be JSON Pointers".to_string(),
                        path: format!("#/$offers/{name}"),
                    })?;
                    let (schema, _) = self.resolve(pointer, &format!("#/$offers/{name}"))?;
                    let target = schema
                        .get("$extends")
                        .and_then(Value::as_str)
                        .ok_or_else(|| ProtoError::Invalid {
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
                return Err(ProtoError::UnknownAddIn { name: name.clone() });
            }
        }
        Ok(())
    }

    // -- named types -------------------------------------------------------

    fn build_named(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        package: &str,
        ctx: &Ctx,
    ) -> Result<Decl, ProtoError> {
        if let Some(enum_decl) = self.try_enum(decl, name, package, &ctx.pointer)? {
            return Ok(Decl::Enum(enum_decl));
        }

        let type_value = decl.get("type").ok_or_else(|| ProtoError::Invalid {
            message: "type declaration is missing the `type` keyword".to_string(),
            path: ctx.pointer.clone(),
        })?;

        match type_value {
            Value::String(t) if t == "object" => {
                Ok(Decl::Message(self.build_message(decl, name, package, ctx)?))
            }
            Value::String(t) if t == "tuple" => {
                Ok(Decl::Message(self.build_tuple(decl, name, package, ctx)?))
            }
            Value::String(t) if t == "choice" => {
                Ok(Decl::Message(self.build_choice(decl, name, package, ctx)?))
            }
            // Anything else at the top level is a scalar alias, which protobuf
            // cannot express. Wrap it so the name survives.
            _ => {
                let ty = self.type_ref(decl, ctx)?;
                let members = vec![Member::Field(Field {
                    name: "value".to_string(),
                    number: 1,
                    pin: None,
                    rule: ty.rule,
                    ty: ty.name,
                    comment: None,
                })];
                Ok(Decl::Message(Message {
                    name: name.to_string(),
                    comment: self.comment_of(decl),
                    members,
                    reserved: Vec::new(),
                }))
            }
        }
    }

    // -- messages (§3.1, §3.2) --------------------------------------------

    fn build_message(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        package: &str,
        ctx: &Ctx,
    ) -> Result<Message, ProtoError> {
        self.check_additional_properties(decl, &ctx.pointer)?;

        let mut specs = Vec::new();
        let mut seen = HashSet::new();
        self.collect_fields(decl, &ctx.pointer, &mut specs, &mut seen)?;

        let members = self.build_members(&specs, ctx)?;
        self.finish_message(name, package, self.comment_of(decl), members)
    }

    /// Turns field specs into unnumbered members, then numbers them.
    fn build_members(&mut self, specs: &[FieldSpec], ctx: &Ctx) -> Result<Vec<Member>, ProtoError> {
        let mut members = Vec::new();
        for spec in specs {
            members.push(Member::Field(self.build_field(spec, ctx)?));
        }
        Ok(members)
    }

    fn build_field(&mut self, spec: &FieldSpec, ctx: &Ctx) -> Result<Field, ProtoError> {
        let decl = spec.schema.as_object().ok_or_else(|| ProtoError::Invalid {
            message: "property schema must be a JSON object".to_string(),
            path: spec.pointer.clone(),
        })?;
        let field_name = match self.alt_name(decl, &spec.pointer)? {
            Some(n) => n,
            None => spec.key.clone(),
        };

        let child = Ctx {
            hint: format!("{}_{}", ctx.hint, spec.key),
            member: Some(spec.key.clone()),
            pointer: spec.pointer.clone(),
            file: ctx.file,
        };
        let resolved = self.type_ref(decl, &child)?;

        // §3.2: `optional` buys explicit presence, which is exactly the
        // distinction `required` is drawing. Repeated and map fields cannot
        // carry it and do not need it.
        let rule = match resolved.rule {
            Rule::Singular if !spec.required => Rule::Optional,
            other => other,
        };

        let mut comment = self.comment_of(decl);
        // §3.2: proto3 has no user-supplied defaults or constants; keep the
        // value visible to a human reading the artifact, and warn either way —
        // the warning is about lost semantics, not about comment rendering.
        for (keyword, label) in [("default", "default"), ("const", "const")] {
            let Some(value) = decl.get(keyword) else {
                continue;
            };
            if self.opts.emit_comments {
                let note = format!("JSON Structure {label}: {value}");
                comment = Some(match comment {
                    Some(existing) => format!("{existing}\n{note}"),
                    None => note,
                });
            }
            self.warnings.push(Warning {
                path: spec.pointer.clone(),
                message: format!("proto3 cannot express `{keyword}`; the value is not enforced"),
            });
        }

        // §6.2: an explicit pin overrides positional assignment.
        let pin = match decl.get("protoNumber") {
            None => None,
            Some(v) => {
                let n = v.as_u64().ok_or_else(|| ProtoError::Invalid {
                    message: "`protoNumber` must be a non-negative integer".to_string(),
                    path: spec.pointer.clone(),
                })?;
                if n == 0 || n > 536_870_911 {
                    return Err(ProtoError::Invalid {
                        message: format!(
                            "`protoNumber` {n} is outside the legal protobuf field number range 1..=536870911"
                        ),
                        path: spec.pointer.clone(),
                    });
                }
                if is_reserved_range(n as u32) {
                    return Err(ProtoError::Invalid {
                        message: format!(
                            "`protoNumber` {n} falls in the reserved range 19000..=19999"
                        ),
                        path: spec.pointer.clone(),
                    });
                }
                Some(n as u32)
            }
        };

        Ok(Field {
            name: field_name,
            number: 0, // assigned by `finish_message`
            pin,
            rule,
            ty: resolved.name,
            comment,
        })
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
    ) -> Result<(), ProtoError> {
        let mut chain = Vec::new();
        self.collect_fields_from(decl, pointer, out, seen, &mut chain)
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

    fn collect_fields_from(
        &mut self,
        decl: &Map<String, Value>,
        pointer: &str,
        out: &mut Vec<FieldSpec>,
        seen: &mut HashSet<String>,
        chain: &mut Vec<String>,
    ) -> Result<(), ProtoError> {
        // Core forbids `$extends` cycles. Without this the recursion below
        // overflows the stack rather than reporting the schema error.
        if chain.iter().any(|p| p == pointer) {
            chain.push(pointer.to_string());
            return Err(ProtoError::Invalid {
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
                let base_map = base.as_object().ok_or_else(|| ProtoError::Invalid {
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
                        return Err(ProtoError::Invalid {
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

        let applicable: Vec<(Value, String)> = self
            .addins
            .iter()
            .filter(|a| a.target == pointer)
            .map(|a| (a.schema.clone(), a.pointer.clone()))
            .collect();
        for (schema, addin_pointer) in applicable {
            let map = schema.as_object().ok_or_else(|| ProtoError::Invalid {
                message: "add-in must be a type declaration".to_string(),
                path: addin_pointer.clone(),
            })?;
            let addin_required = self.required_here(map, &addin_pointer);
            if let Some(properties) = map.get("properties").and_then(Value::as_object) {
                for (key, prop) in properties {
                    if !seen.insert(key.clone()) {
                        continue;
                    }
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
        package: &str,
        ctx: &Ctx,
    ) -> Result<Message, ProtoError> {
        let order = decl
            .get("tuple")
            .and_then(Value::as_array)
            .ok_or_else(|| ProtoError::Invalid {
                message: "`tuple` types require the `tuple` keyword".to_string(),
                path: ctx.pointer.clone(),
            })?
            .clone();

        let mut specs = Vec::new();
        let mut seen = HashSet::new();
        self.collect_fields(decl, &ctx.pointer, &mut specs, &mut seen)?;

        let mut ordered = Vec::new();
        for entry in &order {
            let key = entry.as_str().ok_or_else(|| ProtoError::Invalid {
                message: "`tuple` entries must be property names".to_string(),
                path: ctx.pointer.clone(),
            })?;
            let spec = specs
                .iter()
                .find(|s| s.key == key)
                .ok_or_else(|| ProtoError::Invalid {
                    message: format!("`tuple` names unknown property '{key}'"),
                    path: ctx.pointer.clone(),
                })?;
            // A tuple's arity is fixed, so every position is present (§3.5).
            ordered.push(FieldSpec {
                key: spec.key.clone(),
                schema: spec.schema.clone(),
                required: true,
                pointer: spec.pointer.clone(),
            });
        }

        let members = self.build_members(&ordered, ctx)?;
        self.finish_message(name, package, self.comment_of(decl), members)
    }

    // -- choices (§3.7) ----------------------------------------------------

    fn build_choice(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        package: &str,
        ctx: &Ctx,
    ) -> Result<Message, ProtoError> {
        let choices = decl
            .get("choices")
            .and_then(Value::as_object)
            .ok_or_else(|| ProtoError::Invalid {
                message: "`choice` types require the `choices` keyword".to_string(),
                path: ctx.pointer.clone(),
            })?
            .clone();

        let selector = decl.get("selector").and_then(Value::as_str).map(str::to_string);
        let inline = decl.contains_key("$extends") && selector.is_some();

        let mut members = Vec::new();
        if inline {
            // §3.7.2: the base type's fields come first, then the oneof. The
            // selector property itself is not materialized; the oneof tag is
            // the discriminator on the wire.
            let mut specs = Vec::new();
            let mut seen = HashSet::new();
            self.collect_fields(decl, &ctx.pointer, &mut specs, &mut seen)?;
            let selector_name = selector.clone().expect("checked above");
            specs.retain(|s| s.key != selector_name);
            members = self.build_members(&specs, ctx)?;
        }

        let oneof_name = selector
            .clone()
            .or_else(|| ctx.member.clone())
            .unwrap_or_else(|| "value".to_string());

        let mut branches = Vec::new();
        for (key, branch) in &choices {
            let branch_pointer = format!("{}/choices/{key}", ctx.pointer);
            let branch_map = branch.as_object().ok_or_else(|| ProtoError::Invalid {
                message: "choice branches must be schema objects".to_string(),
                path: branch_pointer.clone(),
            })?;
            let child = Ctx {
                hint: format!("{}_{}", ctx.hint, key),
                member: Some(key.clone()),
                pointer: branch_pointer.clone(),
                file: ctx.file,
            };
            let resolved = self.type_ref_for_oneof(branch_map, &child)?;
            branches.push(Field {
                name: key.clone(),
                number: 0,
                pin: None,
                rule: Rule::Singular,
                ty: resolved,
                comment: None,
            });
        }

        members.push(Member::Oneof(Oneof {
            name: oneof_name,
            fields: branches,
        }));
        self.finish_message(name, package, self.comment_of(decl), members)
    }

    // -- type references ---------------------------------------------------

    /// Resolves a schema node to a protobuf type and quantifier, minting helper
    /// messages into the current file as needed.
    fn type_ref(&mut self, decl: &Map<String, Value>, ctx: &Ctx) -> Result<Resolved, ProtoError> {
        if let Some(Value::Object(inner)) = decl.get("type") {
            if let Some(reference) = inner.get("$ref").and_then(Value::as_str) {
                return Ok(Resolved::singular(self.reference(reference, ctx)?));
            }
        }
        if let Some(reference) = decl.get("$ref").and_then(Value::as_str) {
            return Ok(Resolved::singular(self.reference(reference, ctx)?));
        }

        if decl.contains_key("enum") {
            let name = self.mint(ctx);
            let package = self.files[ctx.file].package.clone();
            if let Some(enum_decl) = self.try_enum(decl, &name, &package, &ctx.pointer)? {
                self.files[ctx.file].decls.push(Decl::Enum(enum_decl));
                return Ok(Resolved::singular(name));
            }
        }

        let type_value = decl.get("type").ok_or_else(|| ProtoError::Invalid {
            message: "schema is missing the `type` keyword".to_string(),
            path: ctx.pointer.clone(),
        })?;

        match type_value {
            Value::String(name) => self.type_by_name(name, decl, ctx),
            Value::Array(branches) => {
                let name = self.union_message(branches, ctx)?;
                Ok(Resolved::singular(name))
            }
            other => Err(ProtoError::Invalid {
                message: format!("unsupported `type` value: {other}"),
                path: ctx.pointer.clone(),
            }),
        }
    }

    /// A `oneof` cannot hold a `repeated` or `map` field (§3.7.1), so anything
    /// that resolves to one gets wrapped.
    fn type_ref_for_oneof(
        &mut self,
        decl: &Map<String, Value>,
        ctx: &Ctx,
    ) -> Result<String, ProtoError> {
        let resolved = self.type_ref(decl, ctx)?;
        match resolved.rule {
            Rule::Singular | Rule::Optional => Ok(resolved.name),
            Rule::Repeated => Ok(self.wrap(&resolved, "items", ctx)),
            Rule::Map(_) => Ok(self.wrap(&resolved, "values", ctx)),
        }
    }

    fn type_by_name(
        &mut self,
        type_name: &str,
        decl: &Map<String, Value>,
        ctx: &Ctx,
    ) -> Result<Resolved, ProtoError> {
        if let Some(primitive) = proto_primitive(type_name) {
            if type_name == "null" {
                self.files[ctx.file].add_import("google/protobuf/struct.proto");
            }
            return Ok(Resolved::singular(primitive.to_string()));
        }

        match type_name {
            "array" | "set" => {
                if type_name == "set" {
                    self.warnings.push(Warning {
                        path: ctx.pointer.clone(),
                        message: "protobuf has no set type; uniqueness is not enforced on the wire"
                            .to_string(),
                    });
                }
                let items = decl
                    .get("items")
                    .and_then(Value::as_object)
                    .ok_or_else(|| ProtoError::Invalid {
                        message: format!("`{type_name}` requires `items`"),
                        path: ctx.pointer.clone(),
                    })?
                    .clone();
                let child = Ctx {
                    hint: format!("{}Item", ctx.hint),
                    member: None,
                    pointer: format!("{}/items", ctx.pointer),
                    file: ctx.file,
                };
                let inner = self.type_ref(&items, &child)?;
                // §3.3: protobuf has no `repeated repeated`.
                let name = match inner.rule {
                    Rule::Singular | Rule::Optional => inner.name,
                    Rule::Repeated => self.wrap(&inner, "items", &child),
                    Rule::Map(_) => self.wrap(&inner, "values", &child),
                };
                Ok(Resolved {
                    name,
                    rule: Rule::Repeated,
                })
            }
            "map" => {
                let values = decl
                    .get("values")
                    .and_then(Value::as_object)
                    .ok_or_else(|| ProtoError::Invalid {
                        message: "`map` requires `values`".to_string(),
                        path: ctx.pointer.clone(),
                    })?
                    .clone();
                let child = Ctx {
                    hint: format!("{}Value", ctx.hint),
                    member: None,
                    pointer: format!("{}/values", ctx.pointer),
                    file: ctx.file,
                };
                let inner = self.type_ref(&values, &child)?;
                // §3.4: map values may not themselves be repeated or maps.
                let name = match inner.rule {
                    Rule::Singular | Rule::Optional => inner.name,
                    Rule::Repeated => self.wrap(&inner, "items", &child),
                    Rule::Map(_) => self.wrap(&inner, "values", &child),
                };
                Ok(Resolved {
                    name,
                    rule: Rule::Map("string".to_string()),
                })
            }
            "object" | "tuple" | "choice" => {
                let name = self.mint(ctx);
                let package = self.files[ctx.file].package.clone();
                let message = match type_name {
                    "object" => self.build_message(decl, &name, &package, ctx)?,
                    "tuple" => self.build_tuple(decl, &name, &package, ctx)?,
                    _ => self.build_choice(decl, &name, &package, ctx)?,
                };
                self.files[ctx.file].decls.push(Decl::Message(message));
                Ok(Resolved::singular(name))
            }
            "any" => {
                self.files[ctx.file].add_import("google/protobuf/any.proto");
                Ok(Resolved::singular("google.protobuf.Any".to_string()))
            }
            other => Err(ProtoError::Invalid {
                message: format!("unknown type '{other}'"),
                path: ctx.pointer.clone(),
            }),
        }
    }

    /// Mints a single-field wrapper message for something protobuf refuses to
    /// nest, and returns its name.
    ///
    /// The wrapper *is* the item or value type, so it takes that name directly
    /// (§7.2). Appending a further `Wrapper` would produce
    /// `Foo_matrixItemWrapper`, which says the same thing twice and does not
    /// match the name any other implementation would generate from the spec.
    fn wrap(&mut self, inner: &Resolved, field_name: &str, ctx: &Ctx) -> String {
        let name = self.mint(ctx);
        let message = Message {
            name: name.clone(),
            comment: None,
            members: vec![Member::Field(Field {
                name: field_name.to_string(),
                number: 1,
                pin: None,
                rule: inner.rule.clone(),
                ty: inner.name.clone(),
                comment: None,
            })],
            reserved: Vec::new(),
        };
        self.files[ctx.file].decls.push(Decl::Message(message));
        name
    }

    /// §3.8: a non-discriminated union becomes a message with a `oneof`.
    fn union_message(&mut self, branches: &[Value], ctx: &Ctx) -> Result<String, ProtoError> {
        let name = self.mint(ctx);

        let mut fields: Vec<Field> = Vec::new();
        for (index, branch) in branches.iter().enumerate() {
            let child = Ctx {
                hint: format!("{}_{index}", ctx.hint),
                member: None,
                pointer: format!("{}/type/{index}", ctx.pointer),
                file: ctx.file,
            };
            let ty = match branch {
                Value::String(type_name) => {
                    let empty = Map::new();
                    self.type_ref_for_oneof_named(type_name, &empty, &child)?
                }
                Value::Object(map) => self.type_ref_for_oneof(map, &child)?,
                other => {
                    return Err(ProtoError::Invalid {
                        message: format!("unsupported union branch: {other}"),
                        path: child.pointer.clone(),
                    })
                }
            };
            // §3.8: two branches are the same branch only if they map to the
            // same protobuf type. Deduplicating on the generated field name
            // instead would silently drop `a.Foo` in favour of `b.Foo`.
            if fields.iter().any(|f| f.ty == ty) {
                continue;
            }
            let stem = branch_field_stem(&ty);
            let mut field_name = format!("{stem}_value");
            if fields.iter().any(|f| f.name == field_name) {
                // Distinct types whose short names collide. Qualify with the
                // full type path, which is unique by construction.
                field_name = format!(
                    "{}_value",
                    ty.trim_start_matches('.').replace('.', "_").to_ascii_lowercase()
                );
            }
            fields.push(Field {
                name: field_name,
                number: 0,
                pin: None,
                rule: Rule::Singular,
                ty,
                comment: None,
            });
        }

        let package = self.files[ctx.file].package.clone();
        let message = self.finish_message(&name, &package, None, vec![Member::Oneof(Oneof {
            name: "value".to_string(),
            fields,
        })])?;
        self.files[ctx.file].decls.push(Decl::Message(message));
        Ok(name)
    }

    fn type_ref_for_oneof_named(
        &mut self,
        type_name: &str,
        decl: &Map<String, Value>,
        ctx: &Ctx,
    ) -> Result<String, ProtoError> {
        let resolved = self.type_by_name(type_name, decl, ctx)?;
        match resolved.rule {
            Rule::Singular | Rule::Optional => Ok(resolved.name),
            Rule::Repeated => Ok(self.wrap(&resolved, "items", ctx)),
            Rule::Map(_) => Ok(self.wrap(&resolved, "values", ctx)),
        }
    }

    /// Resolves a `$ref` to a fully qualified name, importing across files.
    fn reference(&mut self, pointer: &str, ctx: &Ctx) -> Result<String, ProtoError> {
        let path = definition_path(pointer).ok_or_else(|| ProtoError::UnresolvedRef {
            pointer: pointer.to_string(),
            path: ctx.pointer.clone(),
        })?;
        let registered = self
            .registry
            .get(&path.join("/"))
            .cloned()
            .ok_or_else(|| ProtoError::UnresolvedRef {
                pointer: pointer.to_string(),
                path: ctx.pointer.clone(),
            })?;

        if registered.abstract_ {
            return Err(ProtoError::Invalid {
                message: "abstract types cannot be used as a value type".to_string(),
                path: registered.pointer.clone(),
            });
        }

        if registered.file != ctx.file {
            let import = self.files[registered.file].path.clone();
            self.files[ctx.file].add_import(&import);
            let from = self.files[ctx.file].package.clone();
            let to = self.files[registered.file].package.clone();
            self.edges.push((from, to));
        }
        Ok(registered.fq.clone())
    }

    // -- enums (§4.1) ------------------------------------------------------

    fn try_enum(
        &mut self,
        decl: &Map<String, Value>,
        name: &str,
        package: &str,
        pointer: &str,
    ) -> Result<Option<Enum>, ProtoError> {
        let Some(values) = decl.get("enum").and_then(Value::as_array) else {
            return Ok(None);
        };
        if decl.get("type").and_then(Value::as_str) != Some("string") {
            return Ok(None);
        }

        let overrides = decl
            .get("altenums")
            .and_then(Value::as_object)
            .and_then(|m| m.get("proto"))
            .and_then(Value::as_object);

        let mut symbols: Vec<String> = Vec::new();
        for value in values {
            let Some(raw) = value.as_str() else {
                return Ok(None);
            };
            match overrides.and_then(|o| o.get(raw)).and_then(Value::as_str) {
                Some(mapped) => {
                    if !is_identifier(mapped) {
                        return Err(ProtoError::IllegalName {
                            name: mapped.to_string(),
                            path: format!("{pointer}/altenums/proto/{raw}"),
                        });
                    }
                    symbols.push(mapped.to_string());
                }
                None => {
                    if !is_identifier(raw) {
                        self.warnings.push(Warning {
                            path: pointer.to_string(),
                            message: format!(
                                "enum symbol '{raw}' is not a legal protobuf identifier; \
                                 the type falls back to `string`"
                            ),
                        });
                        return Ok(None);
                    }
                    symbols.push(raw.to_string());
                }
            }
        }
        if symbols.is_empty() {
            return Ok(None);
        }
        if let Some(duplicate) = first_duplicate(&symbols) {
            return Err(ProtoError::Invalid {
                message: format!("enum declares '{duplicate}' twice"),
                path: pointer.to_string(),
            });
        }

        // §4.1: proto3 requires a zero value, and JSON Structure enums have no
        // natural zero, so one is synthesized.
        let fq = qualify(package, name);
        let (numbers, retired) = self.enum_numbers(&fq, &symbols, decl, pointer)?;

        let unspecified = format!("{}_UNSPECIFIED", screaming_snake(name));
        if symbols.contains(&unspecified) {
            return Err(ProtoError::Invalid {
                message: format!(
                    "enum symbol '{unspecified}' collides with the synthesized zero value"
                ),
                path: pointer.to_string(),
            });
        }

        let mut out = vec![EnumValue {
            name: unspecified,
            number: 0,
            comment: None,
        }];
        for (symbol, number) in symbols.iter().zip(numbers) {
            out.push(EnumValue {
                name: symbol.clone(),
                number,
                comment: None,
            });
        }

        // §4.1: enum values are siblings of their enum, not children, so every
        // symbol in a package must be unique across all enums in it.
        for value in &out {
            let scoped = qualify(package, &value.name);
            if let Some(owner) = self.enum_symbols.get(&scoped) {
                return Err(ProtoError::Invalid {
                    message: format!(
                        "enum symbol '{}' is already declared by enum `{owner}`; \
                         protobuf enum values are siblings of their type, so they \
                         must be unique within the enclosing scope",
                        value.name
                    ),
                    path: pointer.to_string(),
                });
            }
            self.enum_symbols.insert(scoped, fq.clone());
        }

        self.taken.insert(fq);
        Ok(Some(Enum {
            name: name.to_string(),
            comment: self.comment_of(decl),
            values: out,
            reserved: retired,
        }))
    }

    // -- numbering (§6) ----------------------------------------------------

    /// Numbers a message's fields and records the result in the lock.
    fn finish_message(
        &mut self,
        name: &str,
        package: &str,
        comment: Option<String>,
        mut members: Vec<Member>,
    ) -> Result<Message, ProtoError> {
        let fq = qualify(package, name);

        let mut names: Vec<String> = Vec::new();
        let mut pins: Vec<(String, Option<u32>)> = Vec::new();
        for member in &members {
            match member {
                Member::Field(f) => {
                    names.push(f.name.clone());
                    pins.push((f.name.clone(), f.pin));
                }
                Member::Oneof(o) => {
                    for f in &o.fields {
                        names.push(f.name.clone());
                        pins.push((f.name.clone(), f.pin));
                    }
                }
            }
        }

        if let Some(dup) = first_duplicate(&names) {
            return Err(ProtoError::Numbering {
                message: format!(
                    "field '{dup}' is declared twice; two properties map to the same protobuf field name"
                ),
                message_name: fq.clone(),
            });
        }

        let locked = self
            .opts
            .numbers
            .as_ref()
            .and_then(|l| l.get("messages"))
            .and_then(|m| m.get(&fq));
        let locked_fields: Vec<(String, u32)> = locked
            .and_then(|m| m.get("fields"))
            .and_then(Value::as_object)
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_u64().map(|n| (k.clone(), n as u32)))
                    .collect()
            })
            .unwrap_or_default();
        let mut reserved: Vec<u32> = locked
            .and_then(|m| m.get("reserved"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_u64).map(|n| n as u32).collect())
            .unwrap_or_default();

        let mut taken: HashSet<u32> = reserved.iter().copied().collect();
        let mut assigned: HashMap<String, u32> = HashMap::new();

        // §6.2: explicit pins are the strongest claim on a number, so they are
        // placed before the lock gets a say.
        for (field, pin) in &pins {
            let Some(pin) = pin else { continue };
            if let Some((_, locked)) = locked_fields.iter().find(|(k, _)| k == field) {
                if locked != pin {
                    return Err(ProtoError::Numbering {
                        message: format!(
                            "field '{field}' is pinned to {pin} but locked at {locked}"
                        ),
                        message_name: fq.clone(),
                    });
                }
            }
            if !taken.insert(*pin) {
                return Err(ProtoError::Numbering {
                    message: format!("number {pin} is pinned twice"),
                    message_name: fq.clone(),
                });
            }
            assigned.insert(field.clone(), *pin);
        }

        for (field, number) in &locked_fields {
            if assigned.contains_key(field) {
                continue; // already honored as a pin, and verified to agree
            }
            if names.iter().any(|n| n == field) {
                if !taken.insert(*number) {
                    return Err(ProtoError::Numbering {
                        message: format!("lock file assigns number {number} twice"),
                        message_name: fq.clone(),
                    });
                }
                assigned.insert(field.clone(), *number);
            } else {
                // §6.3: a retired number must never be reused for a new meaning.
                reserved.push(*number);
                taken.insert(*number);
            }
        }

        let mut next = 1u32;
        let mut numbers = Vec::with_capacity(names.len());
        for field in &names {
            let number = match assigned.get(field) {
                Some(n) => *n,
                None => {
                    while taken.contains(&next) || is_reserved_range(next) {
                        next += 1;
                    }
                    taken.insert(next);
                    assigned.insert(field.clone(), next);
                    next
                }
            };
            numbers.push(number);
        }

        let mut iter = numbers.into_iter();
        for member in &mut members {
            match member {
                Member::Field(f) => f.number = iter.next().expect("one number per field"),
                Member::Oneof(o) => {
                    for f in &mut o.fields {
                        f.number = iter.next().expect("one number per field");
                    }
                }
            }
        }

        let mut fields_out = Map::new();
        for field in &names {
            fields_out.insert(
                field.clone(),
                Value::from(*assigned.get(field).expect("assigned above")),
            );
        }
        reserved.sort_unstable();
        reserved.dedup();
        let mut entry = Map::new();
        entry.insert("fields".to_string(), Value::Object(fields_out));
        if !reserved.is_empty() {
            entry.insert(
                "reserved".to_string(),
                Value::Array(reserved.iter().map(|n| Value::from(*n)).collect()),
            );
        }
        self.lock_out
            .get_mut("messages")
            .and_then(Value::as_object_mut)
            .expect("initialized in `new`")
            .insert(fq, Value::Object(entry));

        Ok(Message {
            name: name.to_string(),
            comment,
            members,
            reserved,
        })
    }

    /// Numbers an enum's declared symbols, honoring pins and the lock.
    fn enum_numbers(
        &mut self,
        fq: &str,
        symbols: &[String],
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<(Vec<u32>, Vec<u32>), ProtoError> {
        let pins = decl.get("protoNumbers").and_then(Value::as_object);
        let entry = self
            .opts
            .numbers
            .as_ref()
            .and_then(|l| l.get("enums"))
            .and_then(|m| m.get(fq));
        let locked = entry.and_then(|e| e.get("values")).and_then(Value::as_object);

        let mut taken: HashSet<u32> = HashSet::from([0]);
        let mut assigned: HashMap<String, u32> = HashMap::new();

        // §6.3: a symbol that has left the schema must not surrender its number
        // to a newcomer — a reader compiled against the old enum would decode
        // the new symbol as the retired one.
        let mut retired: Vec<u32> = entry
            .and_then(|e| e.get("reserved"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_u64).map(|n| n as u32).collect())
            .unwrap_or_default();
        for number in &retired {
            taken.insert(*number);
        }
        if let Some(locked) = locked {
            for (symbol, number) in locked {
                let Some(number) = number.as_u64().map(|n| n as u32) else {
                    continue;
                };
                if !symbols.iter().any(|s| s == symbol) {
                    retired.push(number);
                    taken.insert(number);
                }
            }
        }

        for symbol in symbols {
            let pinned = match pins.and_then(|p| p.get(symbol)) {
                None => None,
                Some(v) => {
                    // Enum values are int32 on the wire. `as u32` would happily
                    // truncate 2^31 into a legal-looking number.
                    let n = v.as_i64().ok_or_else(|| ProtoError::Invalid {
                        message: format!("`protoNumbers` entry for '{symbol}' must be an integer"),
                        path: pointer.to_string(),
                    })?;
                    if n < 0 || n > i64::from(i32::MAX) {
                        return Err(ProtoError::Invalid {
                            message: format!(
                                "`protoNumbers` value {n} for '{symbol}' is outside the int32 range \
                                 protobuf enum values occupy"
                            ),
                            path: pointer.to_string(),
                        });
                    }
                    Some(n as u32)
                }
            };
            let from_lock = locked
                .and_then(|l| l.get(symbol))
                .and_then(Value::as_u64)
                .map(|n| n as u32);
            if let (Some(pinned), Some(from_lock)) = (pinned, from_lock) {
                if pinned != from_lock {
                    return Err(ProtoError::Numbering {
                        message: format!(
                            "value '{symbol}' is pinned to {pinned} but locked at {from_lock}"
                        ),
                        message_name: fq.to_string(),
                    });
                }
            }
            if let Some(number) = pinned.or(from_lock) {
                if number == 0 {
                    return Err(ProtoError::Invalid {
                        message: format!(
                            "value '{symbol}' cannot take number 0; \
                             that number is the synthesized UNSPECIFIED value"
                        ),
                        path: pointer.to_string(),
                    });
                }
                if !taken.insert(number) {
                    return Err(ProtoError::Numbering {
                        message: format!("number {number} is assigned twice"),
                        message_name: fq.to_string(),
                    });
                }
                assigned.insert(symbol.clone(), number);
            }
        }

        let mut next = 1u32;
        let mut out = Vec::with_capacity(symbols.len());
        let mut lock_entry = Map::new();
        for symbol in symbols {
            let number = match assigned.get(symbol) {
                Some(n) => *n,
                None => {
                    while taken.contains(&next) {
                        next += 1;
                    }
                    taken.insert(next);
                    next
                }
            };
            lock_entry.insert(symbol.clone(), Value::from(number));
            out.push(number);
        }

        retired.sort_unstable();
        retired.dedup();
        let mut entry_out = Map::new();
        entry_out.insert("values".to_string(), Value::Object(lock_entry));
        if !retired.is_empty() {
            entry_out.insert(
                "reserved".to_string(),
                Value::Array(retired.iter().map(|n| Value::from(*n)).collect()),
            );
        }
        self.lock_out
            .get_mut("enums")
            .and_then(Value::as_object_mut)
            .expect("initialized in `new`")
            .insert(fq.to_string(), Value::Object(entry_out));
        Ok((out, retired))
    }

    // -- validation --------------------------------------------------------

    /// §5.3: `protoc` forbids circular file imports. A pairwise check finds
    /// only two-node cycles, so walk the graph properly.
    fn check_import_cycles(&self) -> Result<(), ProtoError> {
        let mut adjacency: Vec<(String, Vec<String>)> = Vec::new();
        for (a, b) in &self.edges {
            if a == b {
                continue;
            }
            match adjacency.iter_mut().find(|(k, _)| k == a) {
                Some((_, targets)) => {
                    if !targets.contains(b) {
                        targets.push(b.clone());
                    }
                }
                None => adjacency.push((a.clone(), vec![b.clone()])),
            }
        }

        // Depth-first over the ancestor path. Nodes are visited in insertion
        // order so the reported cycle is deterministic.
        fn walk(
            node: &str,
            adjacency: &[(String, Vec<String>)],
            path: &mut Vec<String>,
            done: &mut Vec<String>,
        ) -> Option<(String, String)> {
            if let Some(index) = path.iter().position(|p| p == node) {
                return Some((path[index].clone(), path.last().cloned().unwrap_or_default()));
            }
            if done.iter().any(|d| d == node) {
                return None;
            }
            path.push(node.to_string());
            if let Some((_, targets)) = adjacency.iter().find(|(k, _)| k == node) {
                for target in targets {
                    if let Some(found) = walk(target, adjacency, path, done) {
                        return Some(found);
                    }
                }
            }
            path.pop();
            done.push(node.to_string());
            None
        }

        let mut done: Vec<String> = Vec::new();
        for (node, _) in &adjacency {
            let mut path = Vec::new();
            if let Some((a, b)) = walk(node, &adjacency, &mut path, &mut done) {
                return Err(ProtoError::ImportCycle { a, b });
            }
        }
        Ok(())
    }

    fn check_additional_properties(
        &mut self,
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<(), ProtoError> {
        let open = !matches!(
            decl.get("additionalProperties"),
            None | Some(Value::Bool(false))
        );
        if !open {
            return Ok(());
        }
        let message = "protobuf messages are closed; `additionalProperties` cannot be carried \
                       and undeclared properties will not be transmitted"
            .to_string();
        match self.opts.additional_properties {
            AdditionalProperties::Error => Err(ProtoError::Invalid {
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

    // -- helpers -----------------------------------------------------------

    fn declared_name(
        &self,
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<Option<String>, ProtoError> {
        if let Some(alt) = self.alt_name(decl, pointer)? {
            return Ok(Some(alt));
        }
        Ok(decl.get("name").and_then(Value::as_str).map(str::to_string))
    }

    fn alt_name(
        &self,
        decl: &Map<String, Value>,
        pointer: &str,
    ) -> Result<Option<String>, ProtoError> {
        let Some(alt) = decl
            .get("altnames")
            .and_then(Value::as_object)
            .and_then(|m| m.get("proto"))
        else {
            return Ok(None);
        };
        let name = alt.as_str().ok_or_else(|| ProtoError::Invalid {
            message: "`altnames.proto` must be a string".to_string(),
            path: format!("{pointer}/altnames/proto"),
        })?;
        if !is_identifier(name) {
            return Err(ProtoError::IllegalName {
                name: name.to_string(),
                path: format!("{pointer}/altnames/proto"),
            });
        }
        Ok(Some(name.to_string()))
    }

    fn comment_of(&self, decl: &Map<String, Value>) -> Option<String> {
        if !self.opts.emit_comments {
            return None;
        }
        decl.get("description")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    /// Mints a generated name, suffixing on collision (§7.2).
    fn mint(&mut self, ctx: &Ctx) -> String {
        let (hint, file) = (&ctx.hint, ctx.file);
        let package = self.files[file].package.clone();
        let mut candidate = hint.to_string();
        let mut counter = 1;
        while self.taken.contains(&qualify(&package, &candidate)) {
            candidate = format!("{hint}_{counter}");
            counter += 1;
        }
        if candidate != *hint {
            self.warnings.push(Warning {
                path: ctx.pointer.clone(),
                message: format!(
                    "generated name `{}` is already taken by a declared type; \
                     this generated type is named `{}` instead",
                    qualify(&package, hint),
                    qualify(&package, &candidate)
                ),
            });
        }
        self.taken.insert(qualify(&package, &candidate));
        candidate
    }

    fn resolve(&self, pointer: &str, from: &str) -> Result<(&'a Value, Vec<String>), ProtoError> {
        let path = definition_path(pointer).ok_or_else(|| ProtoError::UnresolvedRef {
            pointer: pointer.to_string(),
            path: from.to_string(),
        })?;
        let value = self.lookup(&path).ok_or_else(|| ProtoError::UnresolvedRef {
            pointer: pointer.to_string(),
            path: from.to_string(),
        })?;
        Ok((value, path))
    }

    fn lookup(&self, path: &[String]) -> Option<&'a Value> {
        if path == ["#"] {
            return Some(self.doc);
        }
        let mut current = self.doc.get("definitions")?;
        for segment in path {
            current = current.get(segment)?;
        }
        Some(current)
    }
}

/// A schema node resolved to a protobuf type and quantifier.
struct Resolved {
    name: String,
    rule: Rule,
}

impl Resolved {
    fn singular(name: String) -> Self {
        Self {
            name,
            rule: Rule::Singular,
        }
    }
}

// -- free functions --------------------------------------------------------

/// The primitive mapping table of §2. `None` means the name is not a primitive.
fn proto_primitive(type_name: &str) -> Option<&'static str> {
    Some(match type_name {
        "null" => "google.protobuf.NullValue",
        "boolean" => "bool",
        "string" => "string",
        "integer" | "int8" | "int16" | "int32" => "int32",
        "int64" => "int64",
        "uint8" | "uint16" | "uint32" => "uint32",
        // Unlike Avro, protobuf has a real unsigned 64-bit type.
        "uint64" => "uint64",
        // No protobuf counterpart; carried in lexical form (§2).
        "int128" | "uint128" | "decimal" => "string",
        "float8" | "float" => "float",
        "double" | "number" => "double",
        // Protobuf's Timestamp is a UTC instant with no offset (§2.1).
        "date" | "time" | "datetime" | "duration" => "string",
        "uuid" | "uri" | "jsonpointer" => "string",
        "binary" => "bytes",
        _ => return None,
    })
}

fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Numbers 19000–19999 are reserved by the protobuf implementation itself.
fn is_reserved_range(number: u32) -> bool {
    (19000..=19999).contains(&number)
}

fn qualify(package: &str, name: &str) -> String {
    if package.is_empty() {
        name.to_string()
    } else {
        format!("{package}.{name}")
    }
}

/// Distinguishes a type declaration from a namespace node under `definitions`.
fn is_type_declaration(node: &Map<String, Value>) -> bool {
    node.contains_key("type") || node.contains_key("$extends") || node.contains_key("abstract")
}

fn definition_pointer(path: &[String]) -> String {
    let mut out = "#/definitions".to_string();
    for segment in path {
        out.push('/');
        out.push_str(segment);
    }
    out
}

fn definition_path(pointer: &str) -> Option<Vec<String>> {
    let rest = pointer.strip_prefix("#/definitions/")?;
    if rest.is_empty() {
        return None;
    }
    Some(rest.split('/').map(str::to_string).collect())
}

fn pointer_list(value: &Value, path: &str) -> Result<Vec<String>, ProtoError> {
    match value {
        Value::String(s) => Ok(vec![s.clone()]),
        Value::Array(items) => items
            .iter()
            .map(|i| {
                i.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| ProtoError::Invalid {
                        message: "`$extends` entries must be JSON Pointers".to_string(),
                        path: path.to_string(),
                    })
            })
            .collect(),
        _ => Err(ProtoError::Invalid {
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
/// is present no matter which alternative holds, so it can be a `required`
/// field. A property in only some alternatives may legitimately be absent, so it
/// must stay `optional`. Taking the union instead would mark fields required
/// that the data is allowed to omit; dropping the keyword — the previous
/// behavior — quietly makes every field in the message optional.
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
         as required, and the alternatives are not enforced on the wire",
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

fn first_duplicate(values: &[String]) -> Option<&String> {
    let mut seen = HashSet::new();
    values.iter().find(|v| !seen.insert(v.as_str()))
}

/// `Order_status` → `ORDER_STATUS`, for the synthesized zero value (§4.1).
fn screaming_snake(name: &str) -> String {
    let mut out = String::new();
    let mut previous_lower = false;
    for c in name.chars() {
        if c == '_' {
            if !out.ends_with('_') && !out.is_empty() {
                out.push('_');
            }
            previous_lower = false;
            continue;
        }
        if c.is_ascii_uppercase() && previous_lower && !out.ends_with('_') {
            out.push('_');
        }
        out.push(c.to_ascii_uppercase());
        previous_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
    }
    out
}

/// `google.protobuf.Any` → `any`; used to name `oneof` branches (§3.8).
fn branch_field_stem(type_name: &str) -> String {
    let last = type_name.rsplit('.').next().unwrap_or(type_name);
    let mut out = String::new();
    let mut previous_lower = false;
    for c in last.chars() {
        if c.is_ascii_uppercase() && previous_lower {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
        previous_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
    }
    out
}
