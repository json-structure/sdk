//! jstruct - JSON Structure CLI validator
//!
//! A command-line tool for validating JSON Structure schemas and instances.

use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;
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

/// Result for a single file validation
#[derive(Debug, Serialize)]
struct FileResult {
    file: String,
    valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    errors: Vec<ErrorInfo>,
}

/// Error information for JSON output
#[derive(Debug, Serialize)]
struct ErrorInfo {
    path: String,
    message: String,
    code: String,
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
            };
        }
    };

    let result = validator.validate(&content);
    validation_result_to_file_result(&file_name, result)
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
            };
        }
    };

    let result = validator.validate(&content, schema);
    validation_result_to_file_result(&file_name, result)
}

/// Convert ValidationResult to FileResult
fn validation_result_to_file_result(file: &str, result: ValidationResult) -> FileResult {
    let errors: Vec<ErrorInfo> = result
        .errors()
        .map(|e| ErrorInfo {
            path: e.path.clone(),
            message: e.message.clone(),
            code: e.code.clone(),
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
    for result in results {
        if let Some(ref error) = result.error {
            println!("\u{2717} {}: {}", result.file, error);
        } else if result.valid {
            println!("\u{2713} {}: valid", result.file);
        } else {
            println!("\u{2717} {}: invalid", result.file);
            for error in &result.errors {
                let path = if error.path.is_empty() { "/" } else { &error.path };
                let loc = if verbose {
                    error.line.map(|l| {
                        format!(" (line {}, col {})", l, error.column.unwrap_or(0))
                    }).unwrap_or_default()
                } else {
                    String::new()
                };
                println!("  - {}: {}{}", path, error.message, loc);
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
    
    for (i, result) in results.iter().enumerate() {
        let n = i + 1;
        
        if let Some(ref error) = result.error {
            println!("not ok {} - {}", n, result.file);
            println!("  # {}", error);
        } else if result.valid {
            println!("ok {} - {}", n, result.file);
        } else {
            println!("not ok {} - {}", n, result.file);
            for error in &result.errors {
                let path = if error.path.is_empty() { "/" } else { &error.path };
                let loc = if verbose {
                    error.line.map(|l| {
                        format!(" (line {}, col {})", l, error.column.unwrap_or(0))
                    }).unwrap_or_default()
                } else {
                    String::new()
                };
                println!("  # {}: {}{}", path, error.message, loc);
            }
        }
    }
}
