# R-side schema augmentation checks.
#
# Faithful port of the extension-keyword validation performed in
# ruby/lib/jsonstructure/schema_validator.rb (augment_extension_validation and
# helpers). These checks supplement the C engine with extra diagnostics for
# JSON Structure extension keywords ($id/name identifiers, $uses gating, units,
# relations, $extends targets, tuple $ref resolution, enum value typing).
#
# The whole augmentation is wrapped in tryCatch by the callers so it can never
# turn a successful base validation into a failure due to an internal error.

.js_identifier_pattern <- "^[A-Za-z_$][A-Za-z0-9_$]*$"
.js_uri_scheme_pattern <- "^[a-zA-Z][a-zA-Z0-9+.-]*:"

.js_ucum_numeric_types <- c("number", "integer", "float", "double", "decimal",
                            "int32", "uint32", "int64", "uint64", "int128",
                            "uint128")
.js_enum_numeric_types <- c("integer", "int8", "int16", "int32", "int64",
                            "uint8", "uint16", "uint32", "uint64", "float",
                            "double", "decimal")
.js_relation_container_types <- c("object", "tuple")
.js_validation_keywords <- c("pattern", "format", "minLength", "maxLength",
                             "minimum", "maximum", "exclusiveMinimum",
                             "exclusiveMaximum", "multipleOf", "minItems",
                             "maxItems", "uniqueItems", "contains",
                             "minContains", "maxContains", "minProperties",
                             "maxProperties", "propertyNames",
                             "patternProperties", "dependentRequired",
                             "minEntries", "maxEntries", "patternKeys",
                             "keyNames", "contentEncoding", "contentMediaType",
                             "has", "default")
.js_units_keywords <- c("unit", "currency", "symbols")

# --- JSON structural predicates (parsed with simplifyVector = FALSE) --------

.js_is_object <- function(x) {
  is.list(x) && (length(x) == 0 || !is.null(names(x)))
}

.js_is_array <- function(x) {
  is.list(x) && (length(x) == 0 || is.null(names(x)))
}

.js_is_string <- function(x) {
  is.character(x) && length(x) == 1 && !is.na(x)
}

.js_is_number <- function(x) {
  is.numeric(x) && length(x) == 1 && !is.na(x)
}

.js_is_bool <- function(x) {
  is.logical(x) && length(x) == 1 && !is.na(x)
}

.js_has_key <- function(node, key) {
  !is.null(names(node)) && key %in% names(node)
}

.js_escape_pointer <- function(segment) {
  gsub("/", "~1", gsub("~", "~0", segment, fixed = TRUE), fixed = TRUE)
}

# --- Mutable error accumulator ----------------------------------------------

.js_new_error_sink <- function() {
  e <- new.env(parent = emptyenv())
  e$errors <- list()
  e
}

.js_add_error <- function(sink, message, path, code = 0L) {
  sink$errors[[length(sink$errors) + 1L]] <-
    new_validation_error(code = code, severity = 0L, message = message,
                         path = path)
  invisible()
}

.js_add_warning <- function(sink, message, path, code = 0L) {
  sink$errors[[length(sink$errors) + 1L]] <-
    new_validation_error(code = code, severity = 1L, message = message,
                         path = path)
  invisible()
}

# --- Reference resolution ----------------------------------------------------

.js_resolve_ref <- function(root_schema, ref) {
  if (!.js_is_string(ref) || !startsWith(ref, "#/")) {
    return(NULL)
  }
  remainder <- sub("^#/", "", ref)
  if (identical(remainder, "")) {
    return(root_schema)
  }
  segments <- strsplit(remainder, "/", fixed = TRUE)[[1]]
  current <- root_schema
  for (segment in segments) {
    segment <- gsub("~1", "/", segment, fixed = TRUE)
    segment <- gsub("~0", "~", segment, fixed = TRUE)
    if (!(.js_is_object(current) && .js_has_key(current, segment))) {
      return(NULL)
    }
    current <- current[[segment]]
  }
  current
}

.js_extension_enabled <- function(root_schema, extension) {
  uses <- root_schema[["$uses"]]
  if (!.js_is_array(uses)) {
    return(FALSE)
  }
  any(vapply(uses, function(u) .js_is_string(u) && identical(u, extension),
             logical(1)))
}

# --- Root-level checks -------------------------------------------------------

.js_validate_root_id <- function(node, path, sink) {
  if (!.js_has_key(node, "$id")) return(invisible())
  id <- node[["$id"]]
  if (!.js_is_string(id)) return(invisible())
  if (trimws(id) == "") {
    .js_add_error(sink, "$id must not be empty", paste0(path, "/$id"),
                  "SCHEMA_KEYWORD_EMPTY")
  } else if (!grepl(.js_uri_scheme_pattern, id)) {
    .js_add_error(sink, "$id must be a URI with a scheme", paste0(path, "/$id"),
                  "SCHEMA_CONSTRAINT_VALUE_INVALID")
  }
  invisible()
}

.js_validate_root_name <- function(node, path, sink) {
  if (!.js_has_key(node, "name")) return(invisible())
  name <- node[["name"]]
  if (!.js_is_string(name)) return(invisible())
  if (grepl(.js_identifier_pattern, name)) return(invisible())
  .js_add_error(sink, "name must be a valid identifier",
                paste0(path, "/name"), "SCHEMA_NAME_INVALID")
  invisible()
}

.js_validate_root_keywords <- function(node, path, sink) {
  .js_validate_root_id(node, path, sink)
  .js_validate_root_name(node, path, sink)
  invisible()
}

# --- Validation-keyword gating ----------------------------------------------

.js_validate_validation_gating <- function(root_schema, node, path, sink) {
  if (.js_extension_enabled(root_schema, "JSONStructureValidation")) {
    return(invisible())
  }
  for (keyword in .js_validation_keywords) {
    if (!.js_has_key(node, keyword)) next
    .js_add_warning(
      sink,
      sprintf("'%s' requires JSONStructureValidation extension.", keyword),
      paste0(path, "/", .js_escape_pointer(keyword))
    )
  }
  invisible()
}

# --- Units keywords ----------------------------------------------------------

.js_validate_ucum_unit <- function(root_schema, node, type, path, sink) {
  if (!.js_has_key(node, "ucumUnit")) return(invisible())
  if (!.js_extension_enabled(root_schema, "JSONStructureUnits")) {
    .js_add_error(sink, "'ucumUnit' requires JSONStructureUnits extension.",
                  paste0(path, "/ucumUnit"))
  }
  if (!.js_is_string(node[["ucumUnit"]])) {
    .js_add_error(sink, "'ucumUnit' must be a string.",
                  paste0(path, "/ucumUnit"))
  }
  if (.js_is_string(type) && type %in% .js_ucum_numeric_types) {
    return(invisible())
  }
  .js_add_error(sink, "'ucumUnit' can only appear in numeric schemas.",
                paste0(path, "/ucumUnit"))
  invisible()
}

.js_validate_units_keywords <- function(root_schema, node, type, path, sink) {
  for (keyword in .js_units_keywords) {
    if (!.js_has_key(node, keyword)) next
    if (!.js_extension_enabled(root_schema, "JSONStructureUnits")) {
      .js_add_error(
        sink,
        sprintf("'%s' requires JSONStructureUnits extension.", keyword),
        paste0(path, "/", .js_escape_pointer(keyword))
      )
    }
  }
  if (!.js_has_key(node, "unit")) return(invisible())
  if (!.js_is_string(node[["unit"]])) {
    .js_add_error(sink, "'unit' must be a string.", paste0(path, "/unit"))
  }
  if (.js_is_string(type) && type %in% .js_ucum_numeric_types) {
    return(invisible())
  }
  .js_add_error(sink, "'unit' can only appear in numeric schemas.",
                paste0(path, "/unit"))
  invisible()
}

# --- Relations ---------------------------------------------------------------

.js_validate_identity <- function(node, path, supports_relations, sink) {
  identity <- node[["identity"]]
  if (!supports_relations) {
    .js_add_error(sink, "'identity' can only appear in object or tuple schemas.",
                  paste0(path, "/identity"))
  }
  if (!.js_is_array(identity)) {
    .js_add_error(sink, "'identity' must be an array of strings.",
                  paste0(path, "/identity"))
    return(invisible())
  }
  properties <- node[["properties"]]
  prop_names <- if (.js_is_object(properties)) names(properties) else character(0)
  for (idx in seq_along(identity)) {
    item <- identity[[idx]]
    item_path <- sprintf("%s/identity[%d]", path, idx - 1L)
    if (!.js_is_string(item)) {
      .js_add_error(sink, sprintf("'identity[%d]' must be a string.", idx - 1L),
                    item_path)
      next
    }
    if (!(item %in% prop_names)) {
      .js_add_error(
        sink,
        sprintf("'identity' references property '%s' that is not in 'properties'.",
                item),
        item_path
      )
    }
  }
  invisible()
}

.js_validate_relation_scope <- function(scope, relation_path, sink) {
  if (.js_is_string(scope)) return(invisible())
  if (.js_is_array(scope)) {
    for (idx in seq_along(scope)) {
      if (.js_is_string(scope[[idx]])) next
      .js_add_error(sink, "'scope' array items must be strings.",
                    sprintf("%s/scope[%d]", relation_path, idx - 1L))
    }
    return(invisible())
  }
  .js_add_error(sink, "'scope' must be a string or an array of strings.",
                paste0(relation_path, "/scope"))
  invisible()
}

.js_validate_relation_ref <- function(root_schema, value, relation_path,
                                      keyword, sink) {
  keyword_path <- paste0(relation_path, "/", keyword)
  if (!(.js_is_object(value) && .js_is_string(value[["$ref"]]))) {
    .js_add_error(sink, sprintf("'%s' must be an object with '$ref'.", keyword),
                  keyword_path)
    return(invisible())
  }
  ref <- value[["$ref"]]
  if (!startsWith(ref, "#/")) return(invisible())
  if (!is.null(.js_resolve_ref(root_schema, ref))) return(invisible())
  .js_add_error(sink, sprintf("$ref '%s' not found", ref),
                paste0(keyword_path, "/$ref"))
  invisible()
}

.js_validate_relations_object <- function(root_schema, node, path,
                                          supports_relations, sink) {
  relations <- node[["relations"]]
  if (!supports_relations) {
    .js_add_error(sink, "'relations' can only appear in object or tuple schemas.",
                  paste0(path, "/relations"))
  }
  if (!.js_is_object(relations)) {
    .js_add_error(sink, "'relations' must be an object.",
                  paste0(path, "/relations"))
    return(invisible())
  }
  for (relation_name in names(relations)) {
    relation <- relations[[relation_name]]
    relation_path <- sprintf("%s/relations/%s", path,
                             .js_escape_pointer(relation_name))
    if (!.js_is_object(relation)) {
      .js_add_error(sink, "Relation declaration must be an object.",
                    relation_path)
      next
    }
    if (.js_has_key(relation, "targettype")) {
      .js_validate_relation_ref(root_schema, relation[["targettype"]],
                                relation_path, "targettype", sink)
    } else {
      .js_add_error(sink, "Relation declaration must have 'targettype'.",
                    paste0(relation_path, "/targettype"))
    }
    if (.js_has_key(relation, "cardinality")) {
      cardinality <- relation[["cardinality"]]
      if (!(.js_is_string(cardinality) &&
            cardinality %in% c("single", "multiple"))) {
        .js_add_error(sink, "'cardinality' must be 'single' or 'multiple'.",
                      paste0(relation_path, "/cardinality"))
      }
    } else {
      .js_add_error(sink, "Relation declaration must have 'cardinality'.",
                    paste0(relation_path, "/cardinality"))
    }
    if (.js_has_key(relation, "scope")) {
      .js_validate_relation_scope(relation[["scope"]], relation_path, sink)
    }
    if (.js_has_key(relation, "qualifiertype")) {
      .js_validate_relation_ref(root_schema, relation[["qualifiertype"]],
                                relation_path, "qualifiertype", sink)
    }
  }
  invisible()
}

.js_validate_relations_keywords <- function(root_schema, node, type, path, sink) {
  has_identity <- .js_has_key(node, "identity")
  has_relations <- .js_has_key(node, "relations")
  if (!has_identity && !has_relations) return(invisible())

  if (!.js_extension_enabled(root_schema, "JSONStructureRelations")) {
    if (has_identity) {
      .js_add_error(sink, "'identity' requires JSONStructureRelations extension.",
                    paste0(path, "/identity"))
    }
    if (has_relations) {
      .js_add_error(sink, "'relations' requires JSONStructureRelations extension.",
                    paste0(path, "/relations"))
    }
  }

  supports_relations <- .js_is_string(type) &&
    type %in% .js_relation_container_types
  if (has_identity) {
    .js_validate_identity(node, path, supports_relations, sink)
  }
  if (has_relations) {
    .js_validate_relations_object(root_schema, node, path, supports_relations,
                                  sink)
  }
  invisible()
}

# --- $extends ----------------------------------------------------------------

.js_normalized_extends_refs <- function(extends_value, path) {
  if (.js_is_string(extends_value)) {
    return(list(list(ref = extends_value, path = paste0(path, "/$extends"))))
  }
  if (.js_is_array(extends_value)) {
    out <- list()
    for (idx in seq_along(extends_value)) {
      item <- extends_value[[idx]]
      if (.js_is_string(item)) {
        out[[length(out) + 1L]] <- list(
          ref = item,
          path = sprintf("%s/$extends[%d]", path, idx - 1L)
        )
      }
    }
    return(out)
  }
  list()
}

.js_validate_extends <- function(root_schema, node, path, sink) {
  if (!.js_has_key(node, "$extends")) return(invisible())
  refs <- .js_normalized_extends_refs(node[["$extends"]], path)
  container_types <- c("object", "tuple", "map", "array", "set", "choice")
  for (entry in refs) {
    ref <- entry$ref
    ref_path <- entry$path
    if (!startsWith(ref, "#/")) next
    resolved <- .js_resolve_ref(root_schema, ref)
    if (is.null(resolved)) next
    resolved_type <- if (.js_is_object(resolved)) resolved[["type"]] else NULL
    ok <- .js_is_object(resolved) &&
      (!.js_has_key(resolved, "type") ||
         (.js_is_string(resolved_type) && resolved_type %in% container_types))
    if (ok) next
    .js_add_error(
      sink,
      sprintf("$extends target '%s' must not resolve to a primitive type", ref),
      ref_path, "SCHEMA_CONSTRAINT_TYPE_MISMATCH"
    )
  }
  invisible()
}

# --- Tuple $ref entries ------------------------------------------------------

.js_validate_tuple_refs <- function(root_schema, node, type, path, sink) {
  if (!(.js_is_string(type) && type == "tuple")) return(invisible())
  tuple <- node[["tuple"]]
  if (!.js_is_array(tuple)) return(invisible())
  for (idx in seq_along(tuple)) {
    entry <- tuple[[idx]]
    if (!(.js_is_object(entry) && .js_is_string(entry[["$ref"]]))) next
    ref <- entry[["$ref"]]
    if (!startsWith(ref, "#/")) next
    if (!is.null(.js_resolve_ref(root_schema, ref))) next
    .js_add_error(sink, sprintf("$ref '%s' not found", ref),
                  sprintf("%s/tuple[%d]/$ref", path, idx - 1L),
                  "SCHEMA_REF_NOT_FOUND")
  }
  invisible()
}

# --- Enum value typing -------------------------------------------------------

.js_enum_value_valid <- function(type, value) {
  if (identical(type, "string")) {
    .js_is_string(value)
  } else if (type %in% .js_enum_numeric_types) {
    .js_is_number(value)
  } else if (identical(type, "boolean")) {
    .js_is_bool(value)
  } else if (identical(type, "null")) {
    is.null(value)
  } else {
    TRUE
  }
}

.js_validate_enum_values <- function(type, node, path, sink) {
  enum <- node[["enum"]]
  if (!.js_is_array(enum)) return(invisible())
  if (!.js_is_string(type)) return(invisible())
  for (idx in seq_along(enum)) {
    value <- enum[[idx]]
    if (.js_enum_value_valid(type, value)) next
    .js_add_error(sink, sprintf("enum value is not valid for type '%s'", type),
                  sprintf("%s/enum[%d]", path, idx - 1L),
                  "SCHEMA_CONSTRAINT_TYPE_MISMATCH")
  }
  invisible()
}

# --- Recursive walker --------------------------------------------------------

.js_walk_extension_keywords <- function(root_schema, node, path, sink) {
  if (!.js_is_object(node)) return(invisible())

  type <- node[["type"]]

  if (identical(path, "#")) {
    .js_validate_root_keywords(node, path, sink)
  }
  .js_validate_validation_gating(root_schema, node, path, sink)
  .js_validate_ucum_unit(root_schema, node, type, path, sink)
  .js_validate_units_keywords(root_schema, node, type, path, sink)
  .js_validate_relations_keywords(root_schema, node, type, path, sink)
  .js_validate_extends(root_schema, node, path, sink)
  .js_validate_tuple_refs(root_schema, node, type, path, sink)
  .js_validate_enum_values(type, node, path, sink)

  keys <- names(node)
  for (i in seq_along(node)) {
    key <- keys[[i]]
    value <- node[[i]]
    child_path <- if (identical(path, "#")) {
      paste0("#/", .js_escape_pointer(key))
    } else {
      paste0(path, "/", .js_escape_pointer(key))
    }
    if (.js_is_object(value)) {
      .js_walk_extension_keywords(root_schema, value, child_path, sink)
    } else if (.js_is_array(value) && length(value) > 0) {
      for (idx in seq_along(value)) {
        .js_walk_extension_keywords(root_schema, value[[idx]],
                                    sprintf("%s[%d]", child_path, idx - 1L),
                                    sink)
      }
    }
  }
  invisible()
}

# Entry point: augment a base result with extension-keyword diagnostics.
# Never raises; on any internal error it returns the base result unchanged.
.js_augment_schema_result <- function(base_result, schema_json) {
  tryCatch({
    schema <- jsonlite::fromJSON(schema_json, simplifyVector = FALSE)
    if (!.js_is_object(schema)) {
      return(base_result)
    }
    sink <- .js_new_error_sink()
    .js_walk_extension_keywords(schema, schema, "#", sink)
    if (length(sink$errors) == 0) {
      return(base_result)
    }
    all_errors <- c(base_result$errors, sink$errors)
    valid <- !any(vapply(all_errors, .js_error_is_error, logical(1)))
    new_validation_result(valid, all_errors)
  }, error = function(e) base_result)
}
