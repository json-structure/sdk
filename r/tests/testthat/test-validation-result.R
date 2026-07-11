# Mirrors ruby/spec/validation_result_spec.rb. Pure R; no binary required.

test_that("is_valid reflects the result flag", {
  expect_true(is_valid(jsonstructure:::new_validation_result(TRUE, list())))
  expect_false(is_valid(jsonstructure:::new_validation_result(FALSE, list())))
})

test_that("errors are carried on the result", {
  err <- jsonstructure:::new_validation_error(
    code = 1L, severity = 0L, message = "Test error", path = "/test"
  )
  result <- jsonstructure:::new_validation_result(FALSE, list(err))
  expect_length(result$errors, 1L)
  expect_s3_class(result$errors[[1]], "js_validation_error")
})

test_that("js_error_messages returns only error-level messages", {
  errors <- list(
    jsonstructure:::new_validation_error(1L, 0L, "Error message", "/test"),
    jsonstructure:::new_validation_error(2L, 1L, "Warning message", "/test")
  )
  result <- jsonstructure:::new_validation_result(FALSE, errors)
  expect_equal(js_error_messages(result), "Error message")
})

test_that("js_warning_messages returns only warning-level messages", {
  errors <- list(
    jsonstructure:::new_validation_error(1L, 0L, "Error message", "/test"),
    jsonstructure:::new_validation_error(2L, 1L, "Warning message", "/test")
  )
  result <- jsonstructure:::new_validation_result(FALSE, errors)
  expect_equal(js_warning_messages(result), "Warning message")
})

test_that("severity codes map to labels", {
  expect_equal(jsonstructure:::new_validation_error(1L, 0L, "x")$severity, "error")
  expect_equal(jsonstructure:::new_validation_error(1L, 1L, "x")$severity, "warning")
  expect_equal(jsonstructure:::new_validation_error(1L, 2L, "x")$severity, "info")
})

test_that("format includes the message and path when present", {
  err <- jsonstructure:::new_validation_error(1L, 0L, "Test error", "/test/path")
  out <- format(err)
  expect_true(grepl("Test error", out, fixed = TRUE))
  expect_true(grepl("/test/path", out, fixed = TRUE))
})

test_that("format works without a path", {
  err <- jsonstructure:::new_validation_error(1L, 0L, "Test error", NULL)
  out <- format(err)
  expect_true(grepl("Test error", out, fixed = TRUE))
})

test_that("as.data.frame produces one row per error", {
  errors <- list(
    jsonstructure:::new_validation_error(1L, 0L, "Error message", "/a"),
    jsonstructure:::new_validation_error(2L, 1L, "Warning message", "/b")
  )
  df <- as.data.frame(jsonstructure:::new_validation_result(FALSE, errors))
  expect_equal(nrow(df), 2L)
  expect_equal(df$severity, c("error", "warning"))
  expect_equal(df$message, c("Error message", "Warning message"))
})
