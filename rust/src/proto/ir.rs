//! The intermediate representation and its rendering.
//!
//! Generation builds this tree first and renders it in one pass, so that the
//! ordering rules of §8 live in exactly one place.

/// How a field is quantified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Rule {
    /// A plain proto3 field.
    Singular,
    /// `optional` — explicit presence, so absent is distinguishable from zero.
    Optional,
    /// `repeated`.
    Repeated,
    /// `map<K, V>`; the key type is always `string`.
    Map(String),
}

#[derive(Debug, Clone)]
pub(crate) struct Field {
    pub name: String,
    pub number: u32,
    /// An author-supplied `protoNumber` pin, honored by `finish_message`.
    pub pin: Option<u32>,
    pub rule: Rule,
    /// The value type. For `Rule::Map` this is the map's value type.
    pub ty: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Oneof {
    pub name: String,
    pub fields: Vec<Field>,
}

/// A field or a `oneof`, kept in one list so emission order is document order.
#[derive(Debug, Clone)]
pub(crate) enum Member {
    Field(Field),
    Oneof(Oneof),
}

#[derive(Debug, Clone)]
pub(crate) struct Message {
    pub name: String,
    pub comment: Option<String>,
    pub members: Vec<Member>,
    /// Numbers retired by the lock file. Rendered ascending.
    pub reserved: Vec<u32>,
}

#[derive(Debug, Clone)]
pub(crate) struct EnumValue {
    pub name: String,
    pub number: u32,
    pub comment: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Enum {
    pub name: String,
    pub comment: Option<String>,
    pub values: Vec<EnumValue>,
    /// Numbers retired by the lock file. Rendered ascending.
    pub reserved: Vec<u32>,
}

#[derive(Debug, Clone)]
pub(crate) enum Decl {
    Message(Message),
    Enum(Enum),
}

#[derive(Debug, Clone)]
pub(crate) struct File {
    pub path: String,
    pub package: String,
    /// Import paths. Insertion-ordered; sorted at render time per §8.3.
    pub imports: Vec<String>,
    pub decls: Vec<Decl>,
}

impl File {
    pub fn add_import(&mut self, path: &str) {
        if !self.imports.iter().any(|i| i == path) {
            self.imports.push(path.to_string());
        }
    }
}

const INDENT: &str = "  ";

/// Renders a file per §8.4: syntax, package, imports, then declarations.
pub(crate) fn render(file: &File) -> String {
    let mut out = String::new();
    out.push_str("syntax = \"proto3\";\n");
    if !file.package.is_empty() {
        out.push('\n');
        out.push_str(&format!("package {};\n", file.package));
    }

    let mut imports = file.imports.clone();
    // Well-known imports first, then lexicographic. Deterministic either way,
    // and it matches how hand-written .proto files are conventionally ordered.
    imports.sort_by(|a, b| {
        let a_wk = a.starts_with("google/protobuf/");
        let b_wk = b.starts_with("google/protobuf/");
        b_wk.cmp(&a_wk).then_with(|| a.cmp(b))
    });
    if !imports.is_empty() {
        out.push('\n');
        for import in &imports {
            out.push_str(&format!("import \"{import}\";\n"));
        }
    }

    for decl in &file.decls {
        out.push('\n');
        match decl {
            Decl::Message(m) => render_message(&mut out, m, 0),
            Decl::Enum(e) => render_enum(&mut out, e, 0),
        }
    }
    out
}

fn indent(depth: usize) -> String {
    INDENT.repeat(depth)
}

fn render_comment(out: &mut String, comment: &Option<String>, depth: usize) {
    let Some(comment) = comment else { return };
    let pad = indent(depth);
    for line in comment.lines() {
        out.push_str(&format!("{pad}// {line}\n"));
    }
}

fn render_message(out: &mut String, message: &Message, depth: usize) {
    let pad = indent(depth);
    render_comment(out, &message.comment, depth);
    out.push_str(&format!("{pad}message {} {{\n", message.name));

    for member in &message.members {
        match member {
            Member::Field(f) => render_field(out, f, depth + 1),
            Member::Oneof(o) => {
                out.push_str(&format!("{}oneof {} {{\n", indent(depth + 1), o.name));
                for f in &o.fields {
                    render_field(out, f, depth + 2);
                }
                out.push_str(&format!("{}}}\n", indent(depth + 1)));
            }
        }
    }

    if !message.reserved.is_empty() {
        let mut reserved = message.reserved.clone();
        reserved.sort_unstable();
        reserved.dedup();
        let list: Vec<String> = reserved.iter().map(u32::to_string).collect();
        out.push_str(&format!("{}reserved {};\n", indent(depth + 1), list.join(", ")));
    }

    out.push_str(&format!("{pad}}}\n"));
}

fn render_field(out: &mut String, field: &Field, depth: usize) {
    let pad = indent(depth);
    render_comment(out, &field.comment, depth);
    let declaration = match &field.rule {
        Rule::Singular => format!("{} {}", field.ty, field.name),
        Rule::Optional => format!("optional {} {}", field.ty, field.name),
        Rule::Repeated => format!("repeated {} {}", field.ty, field.name),
        Rule::Map(key) => format!("map<{}, {}> {}", key, field.ty, field.name),
    };
    out.push_str(&format!("{pad}{declaration} = {};\n", field.number));
}

fn render_enum(out: &mut String, decl: &Enum, depth: usize) {
    let pad = indent(depth);
    render_comment(out, &decl.comment, depth);
    out.push_str(&format!("{pad}enum {} {{\n", decl.name));
    if !decl.reserved.is_empty() {
        let list: Vec<String> = decl.reserved.iter().map(|n| n.to_string()).collect();
        out.push_str(&format!(
            "{}reserved {};\n",
            indent(depth + 1),
            list.join(", ")
        ));
    }
    for value in &decl.values {
        render_comment(out, &value.comment, depth + 1);
        out.push_str(&format!(
            "{}{} = {};\n",
            indent(depth + 1),
            value.name,
            value.number
        ));
    }
    out.push_str(&format!("{pad}}}\n"));
}
