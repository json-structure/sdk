// JSONStructure Swift SDK
// Types and data structures for validation

import Foundation

/// Represents the severity of a validation message.
public enum ValidationSeverity: String, Codable, Sendable {
    case error = "error"
    case warning = "warning"
}

/// Represents a location in a JSON document with line and column information.
public struct JsonLocation: Codable, Sendable, Equatable {
    /// 1-based line number.
    public let line: Int
    /// 1-based column number.
    public let column: Int
    
    public init(line: Int, column: Int) {
        self.line = line
        self.column = column
    }
    
    /// Returns an unknown location (line 0, column 0).
    public static func unknown() -> JsonLocation {
        return JsonLocation(line: 0, column: 0)
    }
    
    /// Returns true if the location is known (non-zero).
    public var isKnown: Bool {
        return line > 0 && column > 0
    }
}

/// Represents a single validation error.
public struct ValidationError: Codable, Sendable {
    /// The error code for programmatic handling.
    public let code: String
    /// A human-readable error description.
    public let message: String
    /// The JSON Pointer path to the error location.
    public let path: String
    /// The severity of the validation message.
    public let severity: ValidationSeverity
    /// The source location (line/column) of the error.
    public let location: JsonLocation
    /// The path in the schema that caused the error (optional).
    public let schemaPath: String?
    
    public init(
        code: String,
        message: String,
        path: String,
        severity: ValidationSeverity = .error,
        location: JsonLocation = .unknown(),
        schemaPath: String? = nil
    ) {
        self.code = code
        self.message = message
        self.path = path
        self.severity = severity
        self.location = location
        self.schemaPath = schemaPath
    }
    
    /// Returns a formatted string representation of the error.
    public var description: String {
        var result = ""
        if !path.isEmpty {
            result += "\(path) "
        }
        if location.isKnown {
            result += "(\(location.line):\(location.column)) "
        }
        result += "[\(code)] \(message)"
        if let schemaPath = schemaPath {
            result += " (schema: \(schemaPath))"
        }
        return result
    }
}

/// Represents the result of a validation operation.
public struct ValidationResult: Sendable {
    /// Indicates whether the validation passed.
    public let isValid: Bool
    /// Validation errors (empty if valid).
    public let errors: [ValidationError]
    /// Validation warnings (non-fatal issues).
    public let warnings: [ValidationError]
    
    public init(isValid: Bool, errors: [ValidationError] = [], warnings: [ValidationError] = []) {
        self.isValid = isValid
        self.errors = errors
        self.warnings = warnings
    }
}

/// Options for schema validation.
public struct SchemaValidatorOptions {
    /// Enables extended validation features.
    public var extended: Bool
    /// Allows $ in property names (required for validating metaschemas).
    public var allowDollar: Bool
    /// Enables processing of $import/$importdefs.
    public var allowImport: Bool
    /// Maps URIs to schema objects for import resolution.
    public var externalSchemas: [String: Any]?
    /// Maximum depth for validation recursion. Default is 64.
    public var maxValidationDepth: Int
    /// Controls whether to emit warnings when extension keywords are used without being enabled.
    public var warnOnUnusedExtensionKeywords: Bool
    
    public init(
        extended: Bool = false,
        allowDollar: Bool = false,
        allowImport: Bool = false,
        externalSchemas: [String: Any]? = nil,
        maxValidationDepth: Int = 64,
        warnOnUnusedExtensionKeywords: Bool = true
    ) {
        self.extended = extended
        self.allowDollar = allowDollar
        self.allowImport = allowImport
        self.externalSchemas = externalSchemas
        self.maxValidationDepth = maxValidationDepth
        self.warnOnUnusedExtensionKeywords = warnOnUnusedExtensionKeywords
    }
}

/// Options for instance validation.
public struct InstanceValidatorOptions {
    /// Enables extended validation features (minLength, pattern, etc.).
    public var extended: Bool
    /// Enables processing of $import/$importdefs.
    public var allowImport: Bool
    /// Maximum depth for validation recursion. Default is 64.
    public var maxValidationDepth: Int
    /// Maps URIs to schema objects for import resolution.
    public var externalSchemas: [String: Any]?
    /// Optional function to resolve external schema references.
    public var referenceResolver: ((String) -> [String: Any]?)?
    /// Optional function to load imported schemas.
    public var importLoader: ((String) -> [String: Any]?)?

    public init(
        extended: Bool = false,
        allowImport: Bool = false,
        maxValidationDepth: Int = 64,
        externalSchemas: [String: Any]? = nil,
        referenceResolver: ((String) -> [String: Any]?)? = nil,
        importLoader: ((String) -> [String: Any]?)? = nil
    ) {
        self.extended = extended
        self.allowImport = allowImport
        self.maxValidationDepth = maxValidationDepth
        self.externalSchemas = externalSchemas
        self.referenceResolver = referenceResolver
        self.importLoader = importLoader
    }
}

// MARK: - Type System

/// All primitive types supported by JSON Structure Core.
public let primitiveTypes: Set<String> = [
    "string", "boolean", "null",
    "int8", "uint8", "int16", "uint16", "int32", "uint32",
    "int64", "uint64", "int128", "uint128",
    "float", "float8", "double", "decimal",
    "number", "integer",
    "date", "datetime", "time", "duration",
    "uuid", "uri", "binary", "jsonpointer"
]

/// All compound types supported by JSON Structure Core.
public let compoundTypes: Set<String> = [
    "object", "array", "set", "map", "tuple", "choice", "any"
]

/// All valid JSON Structure types.
public let allTypes: Set<String> = primitiveTypes.union(compoundTypes)

/// All numeric types.
public let numericTypes: Set<String> = [
    "number", "integer", "float", "double", "decimal", "float8",
    "int8", "uint8", "int16", "uint16", "int32", "uint32",
    "int64", "uint64", "int128", "uint128"
]

/// Checks if a type name is valid.
public func isValidType(_ typeName: String) -> Bool {
    return allTypes.contains(typeName)
}

/// Checks if a type is numeric.
public func isNumericType(_ typeName: String) -> Bool {
    return numericTypes.contains(typeName)
}
