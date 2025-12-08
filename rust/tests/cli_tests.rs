//! Integration tests for the jstruct CLI
//!
//! These tests require the cli feature to be enabled:
//! cargo test --features cli

#![cfg(feature = "cli")]

use std::fs::File;
use std::io::Write;

use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;

/// Helper to get the jstruct command
fn jstruct() -> Command {
    Command::cargo_bin("jstruct").unwrap()
}

/// Helper to create a temp directory with test files
fn create_test_files() -> TempDir {
    let dir = TempDir::new().unwrap();
    
    // Valid schema
    let schema_path = dir.path().join("valid.struct.json");
    let mut f = File::create(&schema_path).unwrap();
    writeln!(f, r#"{{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/test",
        "name": "Person",
        "type": "object",
        "properties": {{
            "name": {{ "type": "string" }},
            "age": {{ "type": "int32" }}
        }},
        "required": ["name"]
    }}"#).unwrap();
    
    // Invalid schema (missing $id)
    let invalid_schema_path = dir.path().join("invalid.struct.json");
    let mut f = File::create(&invalid_schema_path).unwrap();
    writeln!(f, r#"{{
        "name": "Test",
        "type": "string"
    }}"#).unwrap();
    
    // Valid instance
    let valid_instance_path = dir.path().join("valid.json");
    let mut f = File::create(&valid_instance_path).unwrap();
    writeln!(f, r#"{{"name": "Alice", "age": 30}}"#).unwrap();
    
    // Invalid instance
    let invalid_instance_path = dir.path().join("invalid.json");
    let mut f = File::create(&invalid_instance_path).unwrap();
    writeln!(f, r#"{{"age": "not a number"}}"#).unwrap();
    
    // Invalid JSON
    let bad_json_path = dir.path().join("bad.json");
    let mut f = File::create(&bad_json_path).unwrap();
    writeln!(f, "{{ invalid json }}").unwrap();
    
    dir
}

#[test]
fn test_version() {
    jstruct()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("jstruct"));
}

#[test]
fn test_help() {
    jstruct()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("check"))
        .stdout(predicate::str::contains("validate"));
}

#[test]
fn test_check_help() {
    jstruct()
        .args(["check", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Schema file(s)"));
}

#[test]
fn test_validate_help() {
    jstruct()
        .args(["validate", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--schema"));
}

#[test]
fn test_check_valid_schema() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    
    jstruct()
        .arg("check")
        .arg(&schema)
        .assert()
        .success()
        .stdout(predicate::str::contains("valid"));
}

#[test]
fn test_check_invalid_schema() {
    let dir = create_test_files();
    let schema = dir.path().join("invalid.struct.json");
    
    jstruct()
        .arg("check")
        .arg(&schema)
        .assert()
        .code(1)
        .stdout(predicate::str::contains("invalid"));
}

#[test]
fn test_check_json_format() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    
    jstruct()
        .args(["check", "--format", "json"])
        .arg(&schema)
        .assert()
        .success()
        .stdout(predicate::str::contains("\"valid\": true"));
}

#[test]
fn test_check_tap_format() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    
    jstruct()
        .args(["check", "--format", "tap"])
        .arg(&schema)
        .assert()
        .success()
        .stdout(predicate::str::starts_with("1..1"))
        .stdout(predicate::str::contains("ok 1"));
}

#[test]
fn test_check_quiet_mode() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    
    jstruct()
        .args(["check", "-q"])
        .arg(&schema)
        .assert()
        .success()
        .stdout(predicate::str::is_empty());
}

#[test]
fn test_validate_valid_instance() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    let instance = dir.path().join("valid.json");
    
    jstruct()
        .args(["validate", "-s"])
        .arg(&schema)
        .arg(&instance)
        .assert()
        .success()
        .stdout(predicate::str::contains("valid"));
}

#[test]
fn test_validate_invalid_instance() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    let instance = dir.path().join("invalid.json");
    
    jstruct()
        .args(["validate", "-s"])
        .arg(&schema)
        .arg(&instance)
        .assert()
        .code(1)
        .stdout(predicate::str::contains("invalid"));
}

#[test]
fn test_validate_json_format() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    let instance = dir.path().join("valid.json");
    
    jstruct()
        .args(["validate", "-s"])
        .arg(&schema)
        .args(["--format", "json"])
        .arg(&instance)
        .assert()
        .success()
        .stdout(predicate::str::contains("\"valid\": true"));
}

#[test]
fn test_validate_missing_schema_option() {
    let dir = create_test_files();
    let instance = dir.path().join("valid.json");
    
    jstruct()
        .arg("validate")
        .arg(&instance)
        .assert()
        .failure()
        .stderr(predicate::str::contains("--schema"));
}

#[test]
fn test_file_not_found() {
    jstruct()
        .args(["check", "nonexistent.json"])
        .assert()
        .code(2) // Exit code 2 for errors (file not found)
        .stdout(predicate::str::contains("nonexistent.json"));
}

#[test]
fn test_invalid_json() {
    let dir = create_test_files();
    let bad_json = dir.path().join("bad.json");
    
    jstruct()
        .arg("check")
        .arg(&bad_json)
        .assert()
        .code(1); // Invalid schema content (parse error)
}

#[test]
fn test_check_multiple_files() {
    let dir = create_test_files();
    let schema1 = dir.path().join("valid.struct.json");
    let schema2 = dir.path().join("invalid.struct.json");
    
    jstruct()
        .arg("check")
        .arg(&schema1)
        .arg(&schema2)
        .assert()
        .code(1); // One invalid = exit 1
}

#[test]
fn test_command_aliases() {
    let dir = create_test_files();
    let schema = dir.path().join("valid.struct.json");
    let instance = dir.path().join("valid.json");
    
    // 'c' is alias for 'check'
    jstruct()
        .arg("c")
        .arg(&schema)
        .assert()
        .success();
    
    // 'v' is alias for 'validate'
    jstruct()
        .args(["v", "-s"])
        .arg(&schema)
        .arg(&instance)
        .assert()
        .success();
}
