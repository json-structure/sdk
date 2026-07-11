# Mirrors ruby/spec/schema_validator_spec.rb (end-to-end). Requires the binary.

test_that("valid schemas are accepted", {
  skip_if_no_binding()
  expect_true(is_valid(js_validate_schema('{"type": "string"}')))
  expect_true(is_valid(js_validate_schema(
    '{"type": "object", "properties": {"name": {"type": "string"}}}')))
  expect_true(is_valid(js_validate_schema(
    '{"type": "array", "items": {"type": "integer"}}')))
})

test_that("error messages are empty for valid schemas", {
  skip_if_no_binding()
  expect_length(js_error_messages(js_validate_schema('{"type": "string"}')), 0L)
})

test_that("malformed JSON is rejected", {
  skip_if_no_binding()
  res <- js_validate_schema('{invalid json}')
  expect_false(is_valid(res))
  expect_gt(length(res$errors), 0L)
})

test_that("invalid type is rejected", {
  skip_if_no_binding()
  res <- js_validate_schema('{"type": "not_a_type"}')
  expect_false(is_valid(res))
  expect_gt(length(res$errors), 0L)
})

test_that("an R list schema is serialised and accepted", {
  skip_if_no_binding()
  expect_true(is_valid(js_validate_schema(list(type = "string"))))
})

test_that("js_validate_schema_strict returns invisibly when valid", {
  skip_if_no_binding()
  expect_silent(res <- js_validate_schema_strict('{"type": "string"}'))
  expect_true(is_valid(res))
})

test_that("js_validate_schema_strict raises when invalid", {
  skip_if_no_binding()
  err <- tryCatch(js_validate_schema_strict('{invalid json}'),
                  js_validation_error_condition = function(e) e)
  expect_s3_class(err, "js_validation_error_condition")
  expect_false(is_valid(err$result))
})
