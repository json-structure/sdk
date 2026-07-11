# Mirrors ruby/spec/instance_validator_spec.rb (end-to-end). Requires the binary.

test_that("valid instances are accepted", {
  skip_if_no_binding()
  expect_true(is_valid(js_validate_instance('"hello"', '{"type": "string"}')))
  expect_true(is_valid(js_validate_instance('42', '{"type": "integer"}')))
  expect_true(is_valid(js_validate_instance(
    '{"name": "Alice"}',
    '{"type": "object", "properties": {"name": {"type": "string"}}}')))
  expect_true(is_valid(js_validate_instance(
    '[1, 2, 3]', '{"type": "array", "items": {"type": "integer"}}')))
})

test_that("wrong types are rejected", {
  skip_if_no_binding()
  expect_false(is_valid(js_validate_instance('123', '{"type": "string"}')))
})

test_that("string too short is rejected", {
  skip_if_no_binding()
  res <- js_validate_instance('"hi"', '{"type": "string", "minLength": 5}')
  expect_false(is_valid(res))
})

test_that("number out of range is rejected", {
  skip_if_no_binding()
  res <- js_validate_instance('5', '{"type": "integer", "minimum": 10}')
  expect_false(is_valid(res))
})

test_that("R objects are serialised for instance and schema", {
  skip_if_no_binding()
  res <- js_validate_instance(list(name = "Alice"),
                              list(type = "object",
                                   properties = list(name = list(type = "string"))))
  expect_true(is_valid(res))
})

test_that("js_validate_instance_strict raises when invalid", {
  skip_if_no_binding()
  err <- tryCatch(js_validate_instance_strict('123', '{"type": "string"}'),
                  js_validation_error_condition = function(e) e)
  expect_s3_class(err, "js_validation_error_condition")
  expect_false(is_valid(err$result))
})
