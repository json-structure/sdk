# Pure-R tests for the extension-keyword augmentation, mirroring the
# augmentation cases in ruby/spec/schema_validator_spec.rb. These exercise
# .js_augment_schema_result directly against a valid base result, so they run
# without the prebuilt binary.

test_that("ucumUnit is accepted on numeric types", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "urn:example:ucum-number",
    "name": "Length",
    "$uses": ["JSONStructureUnits"],
    "type": "number",
    "ucumUnit": "m"
  }'
  res <- augment(schema)
  expect_true(is_valid(res))
  expect_length(js_error_messages(res), 0L)
})

test_that("ucumUnit is accepted on extended numeric types", {
  for (type in c("int32", "float", "double", "decimal")) {
    schema <- sprintf('{
      "$schema": "https://json-structure.org/meta/extended/v0/#",
      "$id": "urn:example:ucum-%s",
      "name": "N",
      "$uses": ["JSONStructureUnits"],
      "type": "%s",
      "ucumUnit": "m"
    }', type, type)
    res <- augment(schema)
    expect_length(js_error_messages(res), 0L)
  }
})

test_that("ucumUnit is rejected on non-numeric types", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "urn:example:ucum-string",
    "name": "BadUcumType",
    "$uses": ["JSONStructureUnits"],
    "type": "string",
    "ucumUnit": "m"
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true("'ucumUnit' can only appear in numeric schemas." %in% js_error_messages(res))
})

test_that("non-string ucumUnit values are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "urn:example:ucum-non-string",
    "name": "BadUcumValue",
    "$uses": ["JSONStructureUnits"],
    "type": "number",
    "ucumUnit": 5
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true("'ucumUnit' must be a string." %in% js_error_messages(res))
})

test_that("empty $id values are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "   ",
    "name": "BadId",
    "type": "object"
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  codes <- vapply(res$errors, function(e) as.character(e$code), character(1))
  expect_true("SCHEMA_KEYWORD_EMPTY" %in% codes)
  expect_true("$id must not be empty" %in% js_error_messages(res))
})

test_that("$id values without a URI scheme are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "example.com/no-scheme",
    "name": "BadId",
    "type": "object"
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true("$id must be a URI with a scheme" %in% js_error_messages(res))
})

test_that("invalid root names are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/bad-name-id",
    "name": "123invalid",
    "type": "object"
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true("name must be a valid identifier" %in% js_error_messages(res))
})

test_that("enum values that do not match the declared type are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/enum-type-mismatch",
    "name": "EnumTypeMismatch",
    "type": "boolean",
    "enum": [true, "false"]
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true("enum value is not valid for type 'boolean'" %in% js_error_messages(res))
})

test_that("$extends targets that are not object/tuple are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/bad-extends-target",
    "name": "Derived",
    "type": "object",
    "$extends": "#/definitions/Base",
    "definitions": { "Base": { "name": "Base", "type": "string" } }
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true(
    "$extends target '#/definitions/Base' must not resolve to a primitive type" %in%
      js_error_messages(res)
  )
})

test_that("unresolvable tuple refs are rejected", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/tuple-ref",
    "name": "TupleRef",
    "type": "tuple",
    "properties": { "name": { "type": "string" } },
    "tuple": [{ "$ref": "#/definitions/Missing" }]
  }'
  res <- augment(schema)
  expect_false(is_valid(res))
  expect_true("$ref '#/definitions/Missing' not found" %in% js_error_messages(res))
})

test_that("valid Relations identity arrays are accepted", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "urn:example:relations-identity",
    "name": "OrderIdentity",
    "$uses": ["JSONStructureRelations"],
    "type": "object",
    "properties": { "id": { "type": "string" }, "tenantId": { "type": "string" } },
    "identity": ["id", "tenantId"]
  }'
  res <- augment(schema)
  expect_length(js_error_messages(res), 0L)
})

test_that("invalid Relations schemas raise the expected diagnostics", {
  schema <- '{
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "urn:example:relations-invalid",
    "name": "BadRelations",
    "$uses": ["JSONStructureRelations"],
    "type": "string",
    "identity": ["id"],
    "relations": {
      "customer": {
        "cardinality": "many",
        "targettype": { "type": "object" },
        "scope": ["ok", 3],
        "qualifiertype": { "type": "string" }
      }
    }
  }'
  res <- augment(schema)
  msgs <- js_error_messages(res)
  expect_false(is_valid(res))
  expect_true("'identity' can only appear in object or tuple schemas." %in% msgs)
  expect_true("'identity' references property 'id' that is not in 'properties'." %in% msgs)
  expect_true("'relations' can only appear in object or tuple schemas." %in% msgs)
  expect_true("'targettype' must be an object with '$ref'." %in% msgs)
  expect_true("'cardinality' must be 'single' or 'multiple'." %in% msgs)
  expect_true("'scope' array items must be strings." %in% msgs)
  expect_true("'qualifiertype' must be an object with '$ref'." %in% msgs)
})

test_that("augmentation never turns a valid base into a failure on bad JSON", {
  # Malformed JSON must not raise from the augmentation layer; it returns base.
  res <- augment('{ not valid json')
  expect_true(is_valid(res))
})
