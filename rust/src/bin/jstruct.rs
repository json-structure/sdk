//! jstruct - JSON Structure CLI validator
//!
//! A command-line tool for validating JSON Structure schemas and instances.

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::Serialize;

use json_structure::{InstanceValidator, SchemaValidator, SchemaValidatorOptions, ValidationResult};

/// Exit codes
const EXIT_SUCCESS: u8 = 0;
const EXIT_INVALID: u8 = 1;
const EXIT_ERROR: u8 = 2;

/// Output format for validation results
#[derive(Debug, Clone, Copy, Default, ValueEnum)]
enum OutputFormat {
    /// Human-readable text output (default)
    #[default]
    Text,
    /// Machine-readable JSON output
    Json,
    /// Test Anything Protocol output
    Tap,
}

/// jstruct - JSON Structure schema and instance validator
#[derive(Parser)]
#[command(name = "jstruct")]
#[command(author = "JSON Structure Contributors")]
#[command(version)]
#[command(about = "JSON Structure schema and instance validator", long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check schema file(s) for validity
    #[command(alias = "c")]
    Check(CheckArgs),

    /// Validate instance file(s) against a schema
    #[command(alias = "v")]
    Validate(ValidateArgs),

    /// Compile a schema to an Apache Avro schema (.avsc)
    #[command(alias = "a")]
    Avro(AvroArgs),

    /// Generate Protocol Buffers (.proto) files from a schema
    #[command(alias = "p")]
    Proto(ProtoArgs),

    /// Resolve $import/$importdefs into a single self-contained document
    Consolidate(ConsolidateArgs),
}

#[derive(Args)]
struct CheckArgs {
    /// Schema file(s) to check. Use '-' to read from stdin.
    #[arg(required = true)]
    files: Vec<PathBuf>,

    /// Bundle file(s) containing schemas for $import resolution
    #[arg(short, long)]
    bundle: Vec<PathBuf>,

    /// Output format
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,

    /// Suppress output, use exit code only
    #[arg(short, long)]
    quiet: bool,

    /// Show detailed validation information
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Args)]
struct ValidateArgs {
    /// Schema file to validate against
    #[arg(short, long, required = true)]
    schema: PathBuf,

    /// Instance file(s) to validate. Use '-' to read from stdin.
    #[arg(required = true)]
    files: Vec<PathBuf>,

    /// Bundle file(s) containing schemas for $import resolution
    #[arg(short, long)]
    bundle: Vec<PathBuf>,

    /// Output format
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,

    /// Suppress output, use exit code only
    #[arg(short, long)]
    quiet: bool,

    /// Show detailed validation information
    #[arg(short, long)]
    verbose: bool,
}

/// How to treat `additionalProperties` on the command line.
#[derive(Debug, Clone, Copy, Default, ValueEnum)]
enum OpenRecords {
    /// Emit a closed record and warn (default)
    #[default]
    Warn,
    /// Fail compilation
    Error,
}

/// How much descriptive metadata to put in Avro output.
#[derive(Debug, Clone, Copy, Default, ValueEnum)]
enum AvroMode {
    /// Only what serialization requires (default)
    #[default]
    Compact,
    /// Also rfc3339-* logical type annotations and constraint annotations in doc
    Full,
}

#[derive(Args)]
struct AvroArgs {
    /// Schema file to compile. Use '-' to read from stdin.
    files: Vec<PathBuf>,

    /// Bundle file(s) providing schemas for $import resolution
    #[arg(short, long)]
    bundle: Vec<PathBuf>,

    /// Write output to this file instead of stdout
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Add-in from $offers to apply. Repeatable.
    #[arg(long = "use", value_name = "ADDIN")]
    uses: Vec<String>,

    /// How to treat open records (additionalProperties)
    #[arg(long, value_enum, default_value_t = OpenRecords::Warn)]
    open_records: OpenRecords,

    /// How much descriptive metadata to emit
    #[arg(long, value_enum, default_value_t = AvroMode::Compact)]
    mode: AvroMode,
    /// Omit Avro `doc` attributes derived from `description`
    #[arg(long)]
    no_doc: bool,

    /// Emit compact JSON on a single line
    #[arg(long)]
    compact: bool,

    /// Suppress warnings
    #[arg(short, long)]
    quiet: bool,
}

#[derive(Args)]
struct ProtoArgs {
    /// Schema file to generate from. Use '-' to read from stdin.
    files: Vec<PathBuf>,

    /// Bundle file(s) providing schemas for $import resolution
    #[arg(short, long)]
    bundle: Vec<PathBuf>,

    /// Directory to write .proto files into. Without it, files go to stdout.
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Add-in from $offers to apply. Repeatable.
    #[arg(long = "use", value_name = "ADDIN")]
    uses: Vec<String>,

    /// Field-number lock file. Read before generating, rewritten after.
    #[arg(long, value_name = "FILE")]
    numbers: Option<PathBuf>,

    /// How to treat open records (additionalProperties)
    #[arg(long, value_enum, default_value_t = OpenRecords::Warn)]
    open_records: OpenRecords,

    /// Omit comments derived from `description`
    #[arg(long)]
    no_comments: bool,

    /// Suppress warnings
    #[arg(short, long)]
    quiet: bool,
}

#[derive(Args)]
struct ConsolidateArgs {
    /// Schema file to consolidate. Use '-' to read from stdin.
    files: Vec<PathBuf>,

    /// Bundle file(s) providing schemas for $import resolution
    #[arg(short, long)]
    bundle: Vec<PathBuf>,

    /// Write output to this file instead of stdout
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Emit compact JSON on a single line
    #[arg(long)]
    compact: bool,

    /// Suppress diagnostics
    #[arg(short, long)]
    quiet: bool,
}

/// Result for a single file validation
#[derive(Debug, Serialize)]
struct FileResult {
    file: String,
    valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    errors: Vec<ErrorInfo>,
    /// Source content for displaying excerpts (not serialized)
    #[serde(skip)]
    source_content: Option<String>,
}

/// Error information for JSON output
#[derive(Debug, Serialize)]
struct ErrorInfo {
    path: String,
    message: String,
    code: String,
    severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<usize>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let exit_code = match cli.command {
        Commands::Check(args) => cmd_check(args),
        Commands::Validate(args) => cmd_validate(args),
        Commands::Avro(args) => cmd_avro(args),
        Commands::Proto(args) => cmd_proto(args),
        Commands::Consolidate(args) => cmd_consolidate(args),
    };

    ExitCode::from(exit_code)
}

/// Check schema files for validity
fn cmd_check(args: CheckArgs) -> u8 {
    // Load bundle schemas if provided
    let external_schemas = match load_bundle_schemas(&args.bundle, args.quiet) {
        Ok(schemas) => schemas,
        Err(_) => return EXIT_ERROR,
    };

    let options = SchemaValidatorOptions {
        allow_import: !external_schemas.is_empty(),
        external_schemas,
        ..SchemaValidatorOptions::default()
    };
    let validator = SchemaValidator::with_options(options);
    let mut results = Vec::new();
    let mut has_invalid = false;
    let mut has_error = false;

    for file in &args.files {
        let result = check_schema(&validator, file);
        
        if result.error.is_some() {
            has_error = true;
        } else if !result.valid {
            has_invalid = true;
        }
        
        results.push(result);
    }

    if !args.quiet {
        output_results(&results, args.format, args.verbose);
    }

    if has_error {
        EXIT_ERROR
    } else if has_invalid {
        EXIT_INVALID
    } else {
        EXIT_SUCCESS
    }
}

/// Validate instance files against a schema
fn cmd_validate(args: ValidateArgs) -> u8 {
    // Load bundle schemas if provided
    let external_schemas = match load_bundle_schemas(&args.bundle, args.quiet) {
        Ok(schemas) => schemas,
        Err(_) => return EXIT_ERROR,
    };

    let has_bundle = !external_schemas.is_empty();
    let schema_options = SchemaValidatorOptions {
        allow_import: has_bundle,
        external_schemas,
        ..SchemaValidatorOptions::default()
    };

    // Load and validate the schema first
    let schema_content = match read_file(&args.schema) {
        Ok(content) => content,
        Err(e) => {
            if !args.quiet {
                eprintln!("jstruct: cannot read schema '{}': {}", args.schema.display(), e);
            }
            return EXIT_ERROR;
        }
    };

    // Parse the schema
    let schema: serde_json::Value = match serde_json::from_str(&schema_content) {
        Ok(v) => v,
        Err(e) => {
            if !args.quiet {
                eprintln!("jstruct: invalid JSON in schema '{}': {}", args.schema.display(), e);
            }
            return EXIT_ERROR;
        }
    };

    // Validate the schema first
    let schema_validator = SchemaValidator::with_options(schema_options);
    let schema_result = schema_validator.validate(&schema_content);
    if !schema_result.is_valid() {
        if !args.quiet {
            let first_error = schema_result.errors().next()
                .map(|e| e.message.as_str())
                .unwrap_or("unknown error");
            eprintln!("jstruct: invalid schema '{}': {}", args.schema.display(), first_error);
        }
        return EXIT_ERROR;
    }

    let instance_validator = InstanceValidator::new();
    let mut results = Vec::new();
    let mut has_invalid = false;
    let mut has_error = false;

    for file in &args.files {
        let result = validate_instance(&instance_validator, file, &schema);
        
        if result.error.is_some() {
            has_error = true;
        } else if !result.valid {
            has_invalid = true;
        }
        
        results.push(result);
    }

    if !args.quiet {
        output_results(&results, args.format, args.verbose);
    }

    if has_error {
        EXIT_ERROR
    } else if has_invalid {
        EXIT_INVALID
    } else {
        EXIT_SUCCESS
    }
}

/// Load schemas from bundle files for $import resolution
fn load_bundle_schemas(bundle_files: &[PathBuf], quiet: bool) -> Result<Vec<serde_json::Value>, ()> {
    let mut schemas = Vec::new();
    
    for file in bundle_files {
        let content = match read_file(file) {
            Ok(c) => c,
            Err(e) => {
                if !quiet {
                    eprintln!("jstruct: cannot read bundle file '{}': {}", file.display(), e);
                }
                return Err(());
            }
        };
        
        let schema: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                if !quiet {
                    eprintln!("jstruct: invalid JSON in bundle file '{}': {}", file.display(), e);
                }
                return Err(());
            }
        };
        
        schemas.push(schema);
    }
    
    Ok(schemas)
}

/// Check a single schema file
fn check_schema(validator: &SchemaValidator, file: &PathBuf) -> FileResult {
    let file_name = if file.as_os_str() == "-" {
        "<stdin>".to_string()
    } else {
        file.display().to_string()
    };

    let content = match read_file(file) {
        Ok(c) => c,
        Err(e) => {
            return FileResult {
                file: file_name,
                valid: false,
                error: Some(e.to_string()),
                errors: vec![],
                source_content: None,
            };
        }
    };

    let result = validator.validate(&content);
    validation_result_to_file_result(&file_name, result, Some(content))
}

/// Validate a single instance file
fn validate_instance(
    validator: &InstanceValidator,
    file: &PathBuf,
    schema: &serde_json::Value,
) -> FileResult {
    let file_name = if file.as_os_str() == "-" {
        "<stdin>".to_string()
    } else {
        file.display().to_string()
    };

    let content = match read_file(file) {
        Ok(c) => c,
        Err(e) => {
            return FileResult {
                file: file_name,
                valid: false,
                error: Some(e.to_string()),
                errors: vec![],
                source_content: None,
            };
        }
    };

    let result = validator.validate(&content, schema);
    validation_result_to_file_result(&file_name, result, Some(content))
}

/// Convert ValidationResult to FileResult
fn validation_result_to_file_result(file: &str, result: ValidationResult, source_content: Option<String>) -> FileResult {
    let errors: Vec<ErrorInfo> = result
        .all_errors()
        .iter()
        .map(|e| ErrorInfo {
            path: e.path.clone(),
            message: e.message.clone(),
            code: e.code.clone(),
            severity: e.severity.to_string(),
            line: if e.location.is_unknown() {
                None
            } else {
                Some(e.location.line)
            },
            column: if e.location.is_unknown() {
                None
            } else {
                Some(e.location.column)
            },
        })
        .collect();

    FileResult {
        file: file.to_string(),
        valid: result.is_valid(),
        error: None,
        errors,
        source_content,
    }
}

/// Read file contents, handling stdin ("-")
fn read_file(path: &PathBuf) -> io::Result<String> {
    if path.as_os_str() == "-" {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer)?;
        Ok(buffer)
    } else {
        fs::read_to_string(path)
    }
}

/// Output results in the specified format
fn output_results(results: &[FileResult], format: OutputFormat, verbose: bool) {
    match format {
        OutputFormat::Text => output_text(results, verbose),
        OutputFormat::Json => output_json(results),
        OutputFormat::Tap => output_tap(results, verbose),
    }
}

/// Output results as human-readable text
fn output_text(results: &[FileResult], verbose: bool) {
    // Pre-compute source lines for all results that have source content
    let source_lines: Vec<Option<Vec<&str>>> = results
        .iter()
        .map(|r| r.source_content.as_ref().map(|s| s.lines().collect()))
        .collect();

    for (idx, result) in results.iter().enumerate() {
        if let Some(ref error) = result.error {
            println!("\u{2717} {}: {}", result.file, error);
        } else if result.valid {
            println!("\u{2713} {}: valid", result.file);
        } else {
            println!("\u{2717} {}: invalid", result.file);
            let lines = source_lines[idx].as_ref();
            for error in &result.errors {
                let path = if error.path.is_empty() { "/" } else { &error.path };
                let severity_icon = if error.severity == "warning" { "\u{26A0}" } else { "\u{2717}" };
                
                // Always show line/column when available
                let loc = error.line.map(|l| {
                    format!(" (line {}, col {})", l, error.column.unwrap_or(0))
                }).unwrap_or_default();
                
                println!("  {} [{}] {}: {}{}", severity_icon, error.code, path, error.message, loc);
                
                // In verbose mode, show source excerpt with caret marker
                if verbose {
                    if let (Some(line_num), Some(col), Some(src_lines)) = (error.line, error.column, lines) {
                        if line_num > 0 && line_num <= src_lines.len() {
                            let source_line = src_lines[line_num - 1];
                            println!("    |");
                            println!("  {} | {}", line_num, source_line);
                            // Create caret marker at the column position
                            let line_num_width = line_num.to_string().len();
                            let padding = " ".repeat(line_num_width + col);
                            println!("    |{}^", padding);
                        }
                    }
                }
            }
        }
    }
}

/// Output results as JSON
fn output_json(results: &[FileResult]) {
    let output = if results.len() == 1 {
        serde_json::to_string_pretty(&results[0]).unwrap()
    } else {
        serde_json::to_string_pretty(results).unwrap()
    };
    println!("{}", output);
}

/// Output results in TAP format
fn output_tap(results: &[FileResult], verbose: bool) {
    println!("1..{}", results.len());
    
    // Pre-compute source lines for all results that have source content
    let source_lines: Vec<Option<Vec<&str>>> = results
        .iter()
        .map(|r| r.source_content.as_ref().map(|s| s.lines().collect()))
        .collect();
    
    for (i, result) in results.iter().enumerate() {
        let n = i + 1;
        
        if let Some(ref error) = result.error {
            println!("not ok {} - {}", n, result.file);
            println!("  # {}", error);
        } else if result.valid {
            println!("ok {} - {}", n, result.file);
        } else {
            println!("not ok {} - {}", n, result.file);
            let lines = source_lines[i].as_ref();
            for error in &result.errors {
                let path = if error.path.is_empty() { "/" } else { &error.path };
                let severity = if error.severity == "warning" { "warning" } else { "error" };
                
                // Always show line/column when available
                let loc = error.line.map(|l| {
                    format!(" (line {}, col {})", l, error.column.unwrap_or(0))
                }).unwrap_or_default();
                
                println!("  # [{}] {} {}: {}{}", error.code, severity, path, error.message, loc);
                
                // In verbose mode, show source excerpt
                if verbose {
                    if let (Some(line_num), Some(src_lines)) = (error.line, lines) {
                        if line_num > 0 && line_num <= src_lines.len() {
                            let source_line = src_lines[line_num - 1];
                            println!("  #   > {}", source_line);
                            if let Some(col) = error.column {
                                let padding = " ".repeat(col.saturating_sub(1));
                                println!("  #   > {}^", padding);
                            }
                        }
                    }
                }
            }
        }
    }
}


// ---------------------------------------------------------------------------
// Avro and consolidation
// ---------------------------------------------------------------------------

/// Tries each resolver in order. Bundle entries win over files on disk.
struct ChainResolver {
    map: json_structure::MapResolver,
    files: json_structure::FileResolver,
}

impl json_structure::SchemaResolver for ChainResolver {
    fn resolve(
        &self,
        uri: &str,
    ) -> Result<Option<serde_json::Value>, json_structure::ConsolidateError> {
        if let Some(found) = self.map.resolve(uri)? {
            return Ok(Some(found));
        }
        self.files.resolve(uri)
    }
}

/// Reads the single input document a generator command operates on, and builds
/// a resolver rooted at that document's directory.
fn load_source(
    files: &[PathBuf],
    bundle: &[PathBuf],
    quiet: bool,
) -> Result<(serde_json::Value, ChainResolver), u8> {
    let file = match files {
        [] => PathBuf::from("-"),
        [one] => one.clone(),
        _ => {
            if !quiet {
                eprintln!("jstruct: expected a single schema file, got {}", files.len());
            }
            return Err(EXIT_ERROR);
        }
    };

    let content = read_file(&file).map_err(|e| {
        if !quiet {
            eprintln!("jstruct: cannot read '{}': {}", file.display(), e);
        }
        EXIT_ERROR
    })?;

    let document: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        if !quiet {
            eprintln!("jstruct: invalid JSON in '{}': {}", file.display(), e);
        }
        EXIT_ERROR
    })?;

    let bundles = load_bundle_schemas(bundle, quiet).map_err(|_| EXIT_ERROR)?;
    let base = if file.as_os_str() == "-" {
        PathBuf::from(".")
    } else {
        file.parent().unwrap_or(Path::new(".")).to_path_buf()
    };

    Ok((
        document,
        ChainResolver {
            map: json_structure::MapResolver::new(bundles),
            files: json_structure::FileResolver::new(base),
        },
    ))
}

/// Writes a JSON document to a file or to stdout.
fn emit_json(value: &serde_json::Value, output: &Option<PathBuf>, compact: bool, quiet: bool) -> u8 {
    let text = if compact {
        serde_json::to_string(value)
    } else {
        serde_json::to_string_pretty(value)
    };
    let mut text = match text {
        Ok(t) => t,
        Err(e) => {
            if !quiet {
                eprintln!("jstruct: cannot serialize output: {}", e);
            }
            return EXIT_ERROR;
        }
    };
    text.push('\n');

    match output {
        Some(path) => match fs::write(path, text) {
            Ok(()) => EXIT_SUCCESS,
            Err(e) => {
                if !quiet {
                    eprintln!("jstruct: cannot write '{}': {}", path.display(), e);
                }
                EXIT_ERROR
            }
        },
        None => {
            print!("{}", text);
            EXIT_SUCCESS
        }
    }
}

/// Compile a schema to an Avro schema
fn cmd_avro(args: AvroArgs) -> u8 {
    let (document, resolver) = match load_source(&args.files, &args.bundle, args.quiet) {
        Ok(v) => v,
        Err(code) => return code,
    };

    let consolidated = if json_structure::consolidate::has_imports(&document) {
        match json_structure::consolidate::consolidate(&document, &resolver) {
            Ok(v) => v,
            Err(e) => {
                if !args.quiet {
                    eprintln!("jstruct: {}", e);
                }
                return EXIT_INVALID;
            }
        }
    } else {
        document
    };

    let options = json_structure::avro::AvroOptions {
        mode: match args.mode {
            AvroMode::Compact => json_structure::avro::Mode::Compact,
            AvroMode::Full => json_structure::avro::Mode::Full,
        },
        uses: args.uses.clone(),
        additional_properties: match args.open_records {
            OpenRecords::Warn => json_structure::avro::AdditionalProperties::Ignore,
            OpenRecords::Error => json_structure::avro::AdditionalProperties::Error,
        },
        emit_doc: !args.no_doc,
    };

    let output = match json_structure::avro::compile_with(&consolidated, &options) {
        Ok(o) => o,
        Err(e) => {
            if !args.quiet {
                eprintln!("jstruct: {}", e);
            }
            return EXIT_INVALID;
        }
    };

    if !args.quiet {
        for warning in &output.warnings {
            eprintln!("jstruct: warning: {}: {}", warning.path, warning.message);
        }
    }

    emit_json(&output.schema, &args.output, args.compact, args.quiet)
}

/// Resolve imports into a single self-contained document
fn cmd_consolidate(args: ConsolidateArgs) -> u8 {
    let (document, resolver) = match load_source(&args.files, &args.bundle, args.quiet) {
        Ok(v) => v,
        Err(code) => return code,
    };

    match json_structure::consolidate::consolidate(&document, &resolver) {
        Ok(v) => emit_json(&v, &args.output, args.compact, args.quiet),
        Err(e) => {
            if !args.quiet {
                eprintln!("jstruct: {}", e);
            }
            EXIT_INVALID
        }
    }
}

/// Generate .proto files from a schema
fn cmd_proto(args: ProtoArgs) -> u8 {
    let (document, resolver) = match load_source(&args.files, &args.bundle, args.quiet) {
        Ok(v) => v,
        Err(code) => return code,
    };

    let consolidated = if json_structure::consolidate::has_imports(&document) {
        match json_structure::consolidate::consolidate(&document, &resolver) {
            Ok(v) => v,
            Err(e) => {
                if !args.quiet {
                    eprintln!("jstruct: {}", e);
                }
                return EXIT_INVALID;
            }
        }
    } else {
        document
    };

    // A missing lock file is the first run, not an error.
    let numbers = match &args.numbers {
        Some(path) if path.is_file() => match fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str(&text) {
                Ok(v) => Some(v),
                Err(e) => {
                    if !args.quiet {
                        eprintln!("jstruct: invalid JSON in '{}': {}", path.display(), e);
                    }
                    return EXIT_ERROR;
                }
            },
            Err(e) => {
                if !args.quiet {
                    eprintln!("jstruct: cannot read '{}': {}", path.display(), e);
                }
                return EXIT_ERROR;
            }
        },
        _ => None,
    };

    let options = json_structure::proto::ProtoOptions {
        uses: args.uses.clone(),
        additional_properties: match args.open_records {
            OpenRecords::Warn => json_structure::proto::AdditionalProperties::Ignore,
            OpenRecords::Error => json_structure::proto::AdditionalProperties::Error,
        },
        emit_comments: !args.no_comments,
        numbers,
    };

    let output = match json_structure::proto::generate_with(&consolidated, &options) {
        Ok(o) => o,
        Err(e) => {
            if !args.quiet {
                eprintln!("jstruct: {}", e);
            }
            return EXIT_INVALID;
        }
    };

    if !args.quiet {
        for warning in &output.warnings {
            eprintln!("jstruct: warning: {}: {}", warning.path, warning.message);
        }
    }

    match &args.output {
        Some(root) => {
            for file in &output.files {
                let path = root.join(&file.path);
                if let Some(parent) = path.parent() {
                    if let Err(e) = fs::create_dir_all(parent) {
                        if !args.quiet {
                            eprintln!("jstruct: cannot create '{}': {}", parent.display(), e);
                        }
                        return EXIT_ERROR;
                    }
                }
                if let Err(e) = fs::write(&path, &file.contents) {
                    if !args.quiet {
                        eprintln!("jstruct: cannot write '{}': {}", path.display(), e);
                    }
                    return EXIT_ERROR;
                }
                if !args.quiet {
                    eprintln!("jstruct: wrote {}", path.display());
                }
            }
        }
        None => {
            for file in &output.files {
                println!("// ===== {}", file.path);
                print!("{}", file.contents);
            }
        }
    }

    if let Some(path) = &args.numbers {
        let mut text = match serde_json::to_string_pretty(&output.numbers) {
            Ok(t) => t,
            Err(e) => {
                if !args.quiet {
                    eprintln!("jstruct: cannot serialize the number lock: {}", e);
                }
                return EXIT_ERROR;
            }
        };
        text.push('\n');
        if let Err(e) = fs::write(path, text) {
            if !args.quiet {
                eprintln!("jstruct: cannot write '{}': {}", path.display(), e);
            }
            return EXIT_ERROR;
        }
    }

    EXIT_SUCCESS
}
