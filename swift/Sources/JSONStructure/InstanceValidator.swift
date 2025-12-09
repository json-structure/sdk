// JSONStructure Swift SDK
// Instance Validator - validates JSON instances against JSON Structure schemas

import Foundation

/// Validates JSON instances against JSON Structure schemas.
///
/// This validator is a value type (struct) and is thread-safe and Sendable.
/// Each validation operation creates a fresh internal engine, ensuring no shared
/// mutable state between concurrent validations.
///
/// ## Thread Safety
///
/// The validator is a struct containing only immutable configuration. Each call to
/// `validate()` creates an isolated validation engine with its own mutable state,
/// making concurrent validations on the same validator instance completely safe.
///
/// ## Usage with Swift Concurrency
///
/// ```swift
/// let validator = InstanceValidator()
///
/// // Safe to use concurrently - each call gets its own engine
/// await withTaskGroup(of: ValidationResult.self) { group in
///     for (instance, schema) in validationPairs {
///         group.addTask {
///             validator.validate(instance, schema: schema)
///         }
///     }
/// }
/// ```
public struct InstanceValidator: Sendable {
    private let options: InstanceValidatorOptions
    
    /// Creates a new InstanceValidator with the given options.
    public init(options: InstanceValidatorOptions = InstanceValidatorOptions()) {
        self.options = options
    }
    
    /// Validates a JSON instance against a JSON Structure schema.
    public func validate(_ instance: Any, schema: Any) -> ValidationResult {
        let engine = ValidationEngine(options: options)
        return engine.validate(instance, schema: schema)
    }
    
    /// Validates a JSON instance from JSON data against a schema.
    public func validateJSON(_ instanceData: Data, schemaData: Data) throws -> ValidationResult {
        let engine = ValidationEngine(options: options)
        return try engine.validateJSON(instanceData, schemaData: schemaData)
    }
    
    /// Validates a JSON instance from JSON strings against a schema.
    public func validateJSONStrings(_ instanceString: String, schemaString: String) throws -> ValidationResult {
        let engine = ValidationEngine(options: options)
        return try engine.validateJSONStrings(instanceString, schemaString: schemaString)
    }
}

/// Internal validation engine - created fresh for each validation operation.
/// This class contains all the mutable state and validation logic.
private final class ValidationEngine {
    private let options: InstanceValidatorOptions
    private var errors: [ValidationError] = []
    private var rootSchema: [String: Any] = [:]
    private var enabledExtensions: Set<String> = []
    private var sourceLocator: JsonSourceLocator?
    private var loadedImports: [String: [String: Any]?] = [:]
    
    // Regular expressions for format validation
    private static let dateRegex = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)
    private static let datetimeRegex = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"#)
    private static let timeRegex = try! NSRegularExpression(pattern: #"^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$"#)
    private static let durationRegex = try! NSRegularExpression(pattern: #"^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$|^P\d+W$"#)
    private static let uuidRegex = try! NSRegularExpression(pattern: #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#)
    private static let jsonPtrRegex = try! NSRegularExpression(pattern: #"^(?:|(?:/(?:[^~/]|~[01])*)*)$"#)
    
    init(options: InstanceValidatorOptions) {
        self.options = options
    }
    
    /// Validates a JSON instance against a JSON Structure schema.
    public func validate(_ instance: Any, schema: Any) -> ValidationResult {
        errors = []
        enabledExtensions = []
        
        guard let schemaMap = schema as? [String: Any] else {
            addError("#", "Schema must be an object", schemaInvalidType)
            return result()
        }
        
        rootSchema = schemaMap
        loadedImports = [:]
        detectEnabledExtensions()
        
        // Handle $root
        var targetSchema = schemaMap
        if let root = schemaMap["$root"] as? String, root.hasPrefix("#/") {
            guard let resolved = resolveRef(root) else {
                addError("#", "Cannot resolve $root reference: \(root)", instanceRootUnresolved)
                return result()
            }
            targetSchema = resolved
        }
        
        validateInstance(instance, targetSchema, "#", 0)
        
        return result()
    }
    
    /// Validates a JSON instance from JSON data against a schema.
    public func validateJSON(_ instanceData: Data, schemaData: Data) throws -> ValidationResult {
        let instance = try JSONSerialization.jsonObject(with: instanceData)
        let schema = try JSONSerialization.jsonObject(with: schemaData)
        sourceLocator = JsonSourceLocator(String(data: instanceData, encoding: .utf8) ?? "")
        return validate(instance, schema: schema)
    }
    
    /// Validates a JSON instance from JSON strings against a schema.
    public func validateJSONStrings(_ instanceString: String, schemaString: String) throws -> ValidationResult {
        guard let instanceData = instanceString.data(using: .utf8),
              let schemaData = schemaString.data(using: .utf8) else {
            throw NSError(domain: "JSONStructure", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid UTF-8 string"])
        }
        return try validateJSON(instanceData, schemaData: schemaData)
    }
    
    // MARK: - Extension Detection
    
    private func detectEnabledExtensions() {
        // Check $schema URI
        if let schemaURI = rootSchema["$schema"] as? String {
            if schemaURI.contains("extended") || schemaURI.contains("validation") {
                enabledExtensions.insert("JSONStructureConditionalComposition")
                enabledExtensions.insert("JSONStructureValidation")
            }
        }
        
        // Check $uses
        if let uses = rootSchema["$uses"] as? [Any] {
            for ext in uses {
                if let extStr = ext as? String {
                    enabledExtensions.insert(extStr)
                }
            }
        }
        
        // If extended option is true, enable all
        if options.extended {
            enabledExtensions.insert("JSONStructureConditionalComposition")
            enabledExtensions.insert("JSONStructureValidation")
        }
    }
    
    // MARK: - Instance Validation
    
    private func validateInstance(_ instance: Any, _ schema: [String: Any], _ path: String, _ depth: Int = 0) {
        // Check max depth
        if depth > options.maxValidationDepth {
            addError(path, "Maximum validation depth (\(options.maxValidationDepth)) exceeded", instanceMaxDepthExceeded)
            return
        }
        
        // Handle $ref
        if let ref = schema["$ref"] as? String {
            guard let resolved = resolveRef(ref) else {
                addError(path, "Cannot resolve $ref: \(ref)", instanceRefUnresolved)
                return
            }
            validateInstance(instance, resolved, path, depth + 1)
            return
        }
        
        // Handle type with $ref
        if let typeVal = schema["type"] {
            if let typeRef = typeVal as? [String: Any], let ref = typeRef["$ref"] as? String {
                guard let resolved = resolveRef(ref) else {
                    addError(path, "Cannot resolve type $ref: \(ref)", instanceRefUnresolved)
                    return
                }
                // Merge resolved type with current schema
                var merged: [String: Any] = resolved
                for (k, v) in schema {
                    if k != "type" {
                        merged[k] = v
                    }
                }
                if let resolvedType = resolved["type"] {
                    merged["type"] = resolvedType
                }
                validateInstance(instance, merged, path, depth + 1)
                return
            }
        }
        
        // Handle $extends
        if let extendsVal = schema["$extends"] {
            var extendsRefs: [String] = []
            if let extStr = extendsVal as? String {
                extendsRefs = [extStr]
            } else if let extArr = extendsVal as? [Any] {
                for item in extArr {
                    if let s = item as? String {
                        extendsRefs.append(s)
                    }
                }
            }
            
            if !extendsRefs.isEmpty {
                var mergedProps: [String: Any] = [:]
                var mergedRequired: Set<String> = []
                
                for ref in extendsRefs {
                    guard let base = resolveRef(ref) else {
                        addError(path, "Cannot resolve $extends: \(ref)", instanceRefUnresolved)
                        return
                    }
                    
                    // Merge properties (first-wins)
                    if let baseProps = base["properties"] as? [String: Any] {
                        for (k, v) in baseProps {
                            if mergedProps[k] == nil {
                                mergedProps[k] = v
                            }
                        }
                    }
                    
                    // Merge required
                    if let baseReq = base["required"] as? [Any] {
                        for r in baseReq {
                            if let s = r as? String {
                                mergedRequired.insert(s)
                            }
                        }
                    }
                }
                
                // Merge derived schema's properties on top
                if let schemaProps = schema["properties"] as? [String: Any] {
                    for (k, v) in schemaProps {
                        mergedProps[k] = v
                    }
                }
                if let schemaReq = schema["required"] as? [Any] {
                    for r in schemaReq {
                        if let s = r as? String {
                            mergedRequired.insert(s)
                        }
                    }
                }
                
                // Create merged schema
                var merged: [String: Any] = [:]
                for (k, v) in schema {
                    if k != "$extends" {
                        merged[k] = v
                    }
                }
                if !mergedProps.isEmpty {
                    merged["properties"] = mergedProps
                }
                if !mergedRequired.isEmpty {
                    merged["required"] = Array(mergedRequired)
                }
                
                validateInstance(instance, merged, path, depth + 1)
                return
            }
        }
        
        // Handle union types
        if let typeArr = schema["type"] as? [Any] {
            var valid = false
            for t in typeArr {
                let tempValidator = ValidationEngine(options: options)
                tempValidator.rootSchema = rootSchema
                tempValidator.enabledExtensions = enabledExtensions
                var unionSchema = schema
                unionSchema["type"] = t
                tempValidator.validateInstance(instance, unionSchema, path, depth + 1)
                if tempValidator.errors.isEmpty {
                    valid = true
                    break
                }
            }
            if !valid {
                addError(path, "Instance does not match any type in union", instanceTypeMismatch)
            }
            return
        }
        
        // Get type string
        guard let typeStr = schema["type"] as? String else {
            // Type is required unless this is a conditional-only or enum/const schema
            let conditionalKeywords = ["allOf", "anyOf", "oneOf", "not", "if"]
            var hasConditional = false
            for k in conditionalKeywords {
                if schema[k] != nil {
                    hasConditional = true
                    break
                }
            }
            
            if hasConditional {
                validateConditionals(instance, schema, path)
                return
            }
            
            // Check for enum or const only
            if let enumVal = schema["enum"] as? [Any] {
                var found = false
                for e in enumVal {
                    if deepEqual(instance, e) {
                        found = true
                        break
                    }
                }
                if !found {
                    addError(path, "Value must be one of: \(enumVal)", instanceEnumMismatch)
                }
                return
            }
            
            if let constVal = schema["const"] {
                if !deepEqual(instance, constVal) {
                    addError(path, "Value must equal const: \(constVal)", instanceConstMismatch)
                }
                return
            }
            
            // Check for property constraint schema (used in allOf/anyOf/oneOf subschemas)
            if schema["properties"] != nil || schema["required"] != nil {
                if let obj = instance as? [String: Any] {
                    validateObjectConstraints(obj, schema, path)
                }
                validateConditionals(instance, schema, path)
                if enabledExtensions.contains("JSONStructureValidation") {
                    validateValidationAddins(instance, "object", schema, path)
                }
                return
            }
            
            addError(path, "Schema must have a 'type' property", schemaMissingType)
            return
        }
        
        // Validate abstract
        if let abstract = schema["abstract"] as? Bool, abstract {
            addError(path, "Cannot validate instance against abstract schema", instanceSchemaFalse)
            return
        }
        
        // Validate by type
        validateByType(instance, typeStr, schema, path)
        
        // Validate const
        if let constVal = schema["const"] {
            if !deepEqual(instance, constVal) {
                addError(path, "Value must equal const: \(constVal)", instanceConstMismatch)
            }
        }
        
        // Validate enum
        if let enumVal = schema["enum"] as? [Any] {
            var found = false
            for e in enumVal {
                if deepEqual(instance, e) {
                    found = true
                    break
                }
            }
            if !found {
                addError(path, "Value must be one of: \(enumVal)", instanceEnumMismatch)
            }
        }
        
        // Validate conditionals if enabled
        if enabledExtensions.contains("JSONStructureConditionalComposition") {
            validateConditionals(instance, schema, path)
        }
        
        // Validate validation addins if enabled
        if enabledExtensions.contains("JSONStructureValidation") {
            validateValidationAddins(instance, typeStr, schema, path)
        }
    }
    
    private func validateByType(_ instance: Any, _ typeStr: String, _ schema: [String: Any], _ path: String) {
        switch typeStr {
        case "any":
            // Any type accepts all values
            break
            
        case "null":
            if !(instance is NSNull) {
                addError(path, "Expected null, got \(type(of: instance))", instanceNullExpected)
            }
            
        case "boolean":
            if !(instance is Bool) {
                addError(path, "Expected boolean, got \(type(of: instance))", instanceBooleanExpected)
            }
            
        case "string":
            if !(instance is String) {
                addError(path, "Expected string, got \(type(of: instance))", instanceStringExpected)
            }
            
        case "number":
            if !isNumber(instance) {
                addError(path, "Expected number, got \(type(of: instance))", instanceNumberExpected)
            }
            
        case "integer", "int32":
            validateIntRange(instance, Decimal(Int32.min), Decimal(Int32.max), "int32", path)
            
        case "int8":
            validateIntRange(instance, Decimal(-128), Decimal(127), "int8", path)
            
        case "uint8":
            validateIntRange(instance, Decimal(0), Decimal(255), "uint8", path)
            
        case "int16":
            validateIntRange(instance, Decimal(-32768), Decimal(32767), "int16", path)
            
        case "uint16":
            validateIntRange(instance, Decimal(0), Decimal(65535), "uint16", path)
            
        case "uint32":
            validateIntRange(instance, Decimal(0), Decimal(4294967295), "uint32", path)
            
        case "int64":
            validateStringEncodedInt(instance, Decimal(Int64.min), Decimal(Int64.max), "int64", path)
            
        case "uint64":
            validateStringEncodedInt(instance, Decimal(0), Decimal(UInt64.max), "uint64", path)
            
        case "int128":
            let min128 = Decimal(string: "-170141183460469231731687303715884105728")!
            let max128 = Decimal(string: "170141183460469231731687303715884105727")!
            validateStringEncodedInt(instance, min128, max128, "int128", path)
            
        case "uint128":
            let maxU128 = Decimal(string: "340282366920938463463374607431768211455")!
            validateStringEncodedInt(instance, Decimal(0), maxU128, "uint128", path)
            
        case "float", "float8", "double":
            if !isNumber(instance) {
                addError(path, "Expected \(typeStr), got \(type(of: instance))", instanceNumberExpected)
            }
            
        case "decimal":
            validateStringEncodedDecimal(instance, "decimal", path)
            
        case "date":
            guard let str = instance as? String else {
                addError(path, "Expected date in YYYY-MM-DD format", instanceDateFormatInvalid)
                return
            }
            if !matchesRegex(str, ValidationEngine.dateRegex) {
                addError(path, "Expected date in YYYY-MM-DD format", instanceDateFormatInvalid)
            }
            
        case "datetime":
            guard let str = instance as? String else {
                addError(path, "Expected datetime in RFC3339 format", instanceDatetimeFormatInvalid)
                return
            }
            if !matchesRegex(str, ValidationEngine.datetimeRegex) {
                addError(path, "Expected datetime in RFC3339 format", instanceDatetimeFormatInvalid)
            }
            
        case "time":
            guard let str = instance as? String else {
                addError(path, "Expected time in HH:MM:SS format", instanceTimeFormatInvalid)
                return
            }
            if !matchesRegex(str, ValidationEngine.timeRegex) {
                addError(path, "Expected time in HH:MM:SS format", instanceTimeFormatInvalid)
            }
            
        case "duration":
            guard let str = instance as? String else {
                addError(path, "Expected duration as string", instanceDurationExpected)
                return
            }
            if !matchesRegex(str, ValidationEngine.durationRegex) {
                addError(path, "Expected duration in ISO 8601 format", instanceDurationFormatInvalid)
            }
            
        case "uuid":
            guard let str = instance as? String else {
                addError(path, "Expected uuid as string", instanceUUIDExpected)
                return
            }
            if !matchesRegex(str, ValidationEngine.uuidRegex) {
                addError(path, "Invalid uuid format", instanceUUIDFormatInvalid)
            }
            
        case "uri":
            guard let str = instance as? String else {
                addError(path, "Expected uri as string", instanceURIExpected)
                return
            }
            if URL(string: str) == nil {
                addError(path, "Invalid uri format", instanceURIFormatInvalid)
            }
            
        case "binary":
            guard let str = instance as? String else {
                addError(path, "Expected binary as base64 string", instanceBinaryExpected)
                return
            }
            if Data(base64Encoded: str) == nil {
                addError(path, "Invalid base64 encoding", instanceBinaryEncodingInvalid)
            }
            
        case "jsonpointer":
            guard let str = instance as? String else {
                addError(path, "Expected JSON pointer format", instanceJSONPointerFormatInvalid)
                return
            }
            if !matchesRegex(str, ValidationEngine.jsonPtrRegex) {
                addError(path, "Expected JSON pointer format", instanceJSONPointerFormatInvalid)
            }
            
        case "object":
            validateObject(instance, schema, path)
            
        case "array":
            validateArray(instance, schema, path)
            
        case "set":
            validateSet(instance, schema, path)
            
        case "map":
            validateMap(instance, schema, path)
            
        case "tuple":
            validateTuple(instance, schema, path)
            
        case "choice":
            validateChoice(instance, schema, path)
            
        default:
            addError(path, "Unknown type: \(typeStr)", instanceTypeUnknown)
        }
    }
    
    // MARK: - Integer Validation
    
    private func validateIntRange(_ instance: Any, _ min: Decimal, _ max: Decimal, _ typeName: String, _ path: String) {
        guard let dec = toDecimalNumeric(instance) else {
            addError(path, "Expected \(typeName)", instanceIntegerExpected)
            return
        }
        if !isIntegerDecimal(dec) {
            addError(path, "Expected \(typeName)", instanceIntegerExpected)
            return
        }
        if dec < min || dec > max {
            addError(path, "\(typeName) value out of range", instanceIntRangeInvalid)
        }
    }
    
    /// Validate string-encoded integers (int64, uint64, int128, uint128)
    /// Per spec, these types have base type "string" to preserve precision
    private func validateStringEncodedInt(_ instance: Any, _ min: Decimal, _ max: Decimal, _ typeName: String, _ path: String) {
        guard let str = instance as? String else {
            addError(path, "\(typeName) must be a string", instanceStringExpected)
            return
        }
        guard let dec = Decimal(string: str) else {
            addError(path, "Invalid \(typeName) format", instanceIntegerExpected)
            return
        }
        if !isIntegerDecimal(dec) {
            addError(path, "\(typeName) must be an integer", instanceIntegerExpected)
            return
        }
        if dec < min || dec > max {
            addError(path, "\(typeName) value out of range", instanceIntRangeInvalid)
        }
    }
    
    /// Validate string-encoded decimal
    /// Per spec, decimal type has base type "string" to preserve precision
    private func validateStringEncodedDecimal(_ instance: Any, _ typeName: String, _ path: String) {
        guard let str = instance as? String else {
            addError(path, "\(typeName) must be a string", instanceStringExpected)
            return
        }
        guard Decimal(string: str) != nil else {
            addError(path, "Invalid \(typeName) format", instanceDecimalExpected)
            return
        }
    }
    
    // MARK: - Object Validation
    
    private func validateObject(_ instance: Any, _ schema: [String: Any], _ path: String) {
        guard let obj = instance as? [String: Any] else {
            addError(path, "Expected object, got \(type(of: instance))", instanceObjectExpected)
            return
        }
        
        let properties = schema["properties"] as? [String: Any]
        let required = schema["required"] as? [Any]
        let additionalProperties = schema["additionalProperties"]
        
        // Validate required properties
        if let req = required {
            for r in req {
                if let rStr = r as? String {
                    if obj[rStr] == nil {
                        addError(path, "Missing required property: \(rStr)", instanceRequiredPropertyMissing)
                    }
                }
            }
        }
        
        // Validate properties
        if let props = properties {
            for (propName, propSchema) in props {
                if let propValue = obj[propName], let propSchemaMap = propSchema as? [String: Any] {
                    validateInstance(propValue, propSchemaMap, "\(path)/\(propName)")
                }
            }
        }
        
        // Validate additionalProperties
        if let ap = additionalProperties {
            if let apBool = ap as? Bool {
                if !apBool {
                    for key in obj.keys {
                        let isReservedAtRoot = path == "#" && (key == "$schema" || key == "$uses")
                        if (properties == nil || properties?[key] == nil) && !isReservedAtRoot {
                            addError(path, "Additional property not allowed: \(key)", instanceAdditionalPropertyNotAllowed)
                        }
                    }
                }
            } else if let apSchema = ap as? [String: Any] {
                for (key, val) in obj {
                    let isReservedAtRoot = path == "#" && (key == "$schema" || key == "$uses")
                    if (properties == nil || properties?[key] == nil) && !isReservedAtRoot {
                        validateInstance(val, apSchema, "\(path)/\(key)")
                    }
                }
            }
        }
        
        // Validate 'has' keyword - at least one property value must match the schema
        if let hasSchema = schema["has"] as? [String: Any] {
            var hasMatch = false
            for (_, val) in obj {
                let tempValidator = ValidationEngine(options: options)
                let tempResult = tempValidator.validate(val, schema: hasSchema)
                if tempResult.isValid {
                    hasMatch = true
                    break
                }
            }
            if !hasMatch {
                addError(path, "Object has no property value matching 'has' schema", instanceHasNoMatch)
            }
        }
        
        // Validate patternProperties - properties matching pattern must validate against schema
        if let patternProps = schema["patternProperties"] as? [String: Any] {
            for (pattern, patternSchema) in patternProps {
                if let regex = try? NSRegularExpression(pattern: pattern),
                   let patternSchemaMap = patternSchema as? [String: Any] {
                    for (key, val) in obj {
                        let range = NSRange(key.startIndex..., in: key)
                        if regex.firstMatch(in: key, range: range) != nil {
                            validateInstance(val, patternSchemaMap, "\(path)/\(key)")
                        }
                    }
                }
            }
        }
    }
    
    private func validateObjectConstraints(_ obj: [String: Any], _ schema: [String: Any], _ path: String) {
        let properties = schema["properties"] as? [String: Any]
        let required = schema["required"] as? [Any]
        let additionalProperties = schema["additionalProperties"]
        
        // Validate required properties
        if let req = required {
            for r in req {
                if let rStr = r as? String {
                    if obj[rStr] == nil {
                        addError(path, "Missing required property: \(rStr)", instanceRequiredPropertyMissing)
                    }
                }
            }
        }
        
        // Validate properties
        if let props = properties {
            for (propName, propSchema) in props {
                if let propValue = obj[propName], let propSchemaMap = propSchema as? [String: Any] {
                    validateInstance(propValue, propSchemaMap, "\(path)/\(propName)")
                }
            }
        }
        
        // Validate additionalProperties
        if let ap = additionalProperties {
            if let apBool = ap as? Bool {
                if !apBool {
                    for key in obj.keys {
                        let isReservedAtRoot = path == "#" && (key == "$schema" || key == "$uses")
                        if (properties == nil || properties?[key] == nil) && !isReservedAtRoot {
                            addError(path, "Additional property not allowed: \(key)", instanceAdditionalPropertyNotAllowed)
                        }
                    }
                }
            } else if let apSchema = ap as? [String: Any] {
                for (key, val) in obj {
                    let isReservedAtRoot = path == "#" && (key == "$schema" || key == "$uses")
                    if (properties == nil || properties?[key] == nil) && !isReservedAtRoot {
                        validateInstance(val, apSchema, "\(path)/\(key)")
                    }
                }
            }
        }
        
        // Validate 'has' keyword - at least one property value must match the schema
        if let hasSchema = schema["has"] as? [String: Any] {
            var hasMatch = false
            for (_, val) in obj {
                let tempValidator = ValidationEngine(options: options)
                let tempResult = tempValidator.validate(val, schema: hasSchema)
                if tempResult.isValid {
                    hasMatch = true
                    break
                }
            }
            if !hasMatch {
                addError(path, "Object has no property value matching 'has' schema", instanceHasNoMatch)
            }
        }
        
        // Validate patternProperties - properties matching pattern must validate against schema
        if let patternProps = schema["patternProperties"] as? [String: Any] {
            for (pattern, patternSchema) in patternProps {
                if let regex = try? NSRegularExpression(pattern: pattern),
                   let patternSchemaMap = patternSchema as? [String: Any] {
                    for (key, val) in obj {
                        let range = NSRange(key.startIndex..., in: key)
                        if regex.firstMatch(in: key, range: range) != nil {
                            validateInstance(val, patternSchemaMap, "\(path)/\(key)")
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Array Validation
    
    private func validateArray(_ instance: Any, _ schema: [String: Any], _ path: String) {
        guard let arr = instance as? [Any] else {
            addError(path, "Expected array, got \(type(of: instance))", instanceArrayExpected)
            return
        }
        
        if let items = schema["items"] as? [String: Any] {
            for (i, item) in arr.enumerated() {
                validateInstance(item, items, "\(path)[\(i)]")
            }
        }
    }
    
    private func validateSet(_ instance: Any, _ schema: [String: Any], _ path: String) {
        guard let arr = instance as? [Any] else {
            addError(path, "Expected set (array), got \(type(of: instance))", instanceSetExpected)
            return
        }
        
        // Check for duplicates
        var seen: Set<String> = []
        for item in arr {
            if let str = serializeValue(item) {
                if seen.contains(str) {
                    addError(path, "Set contains duplicate items", instanceSetDuplicate)
                    break
                }
                seen.insert(str)
            }
        }
        
        // Validate items
        if let items = schema["items"] as? [String: Any] {
            for (i, item) in arr.enumerated() {
                validateInstance(item, items, "\(path)[\(i)]")
            }
        }
    }
    
    // MARK: - Map Validation
    
    private func validateMap(_ instance: Any, _ schema: [String: Any], _ path: String) {
        guard let obj = instance as? [String: Any] else {
            addError(path, "Expected map (object), got \(type(of: instance))", instanceMapExpected)
            return
        }
        
        let entryCount = obj.count
        
        // minEntries validation
        if let minEntries = toInt(schema["minEntries"] as Any) {
            if entryCount < minEntries {
                addError(path, "Map has \(entryCount) entries, less than minEntries \(minEntries)", instanceMapMinEntries)
            }
        }
        
        // maxEntries validation
        if let maxEntries = toInt(schema["maxEntries"] as Any) {
            if entryCount > maxEntries {
                addError(path, "Map has \(entryCount) entries, more than maxEntries \(maxEntries)", instanceMapMaxEntries)
            }
        }
        
        // keyNames validation
        if let keyNamesSchema = schema["keyNames"] as? [String: Any] {
            for key in obj.keys {
                if !validateKeyName(key, keyNamesSchema) {
                    addError(path, "Map key '\(key)' does not match keyNames constraint", instanceMapKeyInvalid)
                }
            }
        }
        
        // patternKeys validation
        if let patternKeysSchema = schema["patternKeys"] as? [String: Any] {
            if let pattern = patternKeysSchema["pattern"] as? String {
                if let regex = try? NSRegularExpression(pattern: pattern) {
                    for key in obj.keys {
                        let range = NSRange(key.startIndex..., in: key)
                        if regex.firstMatch(in: key, range: range) == nil {
                            addError(path, "Map key '\(key)' does not match patternKeys pattern '\(pattern)'", instanceMapKeyInvalid)
                        }
                    }
                }
            }
        }
        
        // Validate values
        if let values = schema["values"] as? [String: Any] {
            for (key, val) in obj {
                validateInstance(val, values, "\(path)/\(key)")
            }
        }
    }
    
    private func validateKeyName(_ key: String, _ keyNamesSchema: [String: Any]) -> Bool {
        // Check pattern
        if let pattern = keyNamesSchema["pattern"] as? String {
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(key.startIndex..., in: key)
                if regex.firstMatch(in: key, range: range) == nil {
                    return false
                }
            } else {
                return false
            }
        }
        
        // Check minLength
        if let minLength = toInt(keyNamesSchema["minLength"] as Any) {
            if key.count < minLength {
                return false
            }
        }
        
        // Check maxLength
        if let maxLength = toInt(keyNamesSchema["maxLength"] as Any) {
            if key.count > maxLength {
                return false
            }
        }
        
        // Check enum
        if let enumArr = keyNamesSchema["enum"] as? [Any] {
            var found = false
            for e in enumArr {
                if let s = e as? String, s == key {
                    found = true
                    break
                }
            }
            if !found {
                return false
            }
        }
        
        return true
    }
    
    // MARK: - Tuple Validation
    
    private func validateTuple(_ instance: Any, _ schema: [String: Any], _ path: String) {
        guard let arr = instance as? [Any] else {
            addError(path, "Expected tuple (array), got \(type(of: instance))", instanceTupleExpected)
            return
        }
        
        guard let tupleOrder = schema["tuple"] as? [Any] else {
            addError(path, "Tuple schema must have 'tuple' array", schemaTupleMissingDefinition)
            return
        }
        
        let properties = schema["properties"] as? [String: Any]
        
        if arr.count != tupleOrder.count {
            addError(path, "Tuple length mismatch: expected \(tupleOrder.count), got \(arr.count)", instanceTupleLengthMismatch)
            return
        }
        
        if let props = properties {
            for (i, name) in tupleOrder.enumerated() {
                if let propName = name as? String,
                   let propSchema = props[propName] as? [String: Any] {
                    validateInstance(arr[i], propSchema, "\(path)/\(propName)")
                }
            }
        }
    }
    
    // MARK: - Choice Validation
    
    private func validateChoice(_ instance: Any, _ schema: [String: Any], _ path: String) {
        guard let obj = instance as? [String: Any] else {
            addError(path, "Expected choice (object), got \(type(of: instance))", instanceChoiceExpected)
            return
        }
        
        guard let choices = schema["choices"] as? [String: Any] else {
            addError(path, "Choice schema must have 'choices'", instanceChoiceMissingChoices)
            return
        }
        
        let selector = schema["selector"] as? String
        let hasExtends = schema["$extends"] != nil
        
        if hasExtends && selector != nil {
            // Inline union: use selector property
            guard let selectorValue = obj[selector!] as? String else {
                addError(path, "Selector '\(selector!)' must be a string", instanceChoiceSelectorNotString)
                return
            }
            guard let choiceSchema = choices[selectorValue] as? [String: Any] else {
                addError(path, "Selector value '\(selectorValue)' not in choices", instanceChoiceUnknown)
                return
            }
            // Validate remaining properties
            var remaining: [String: Any] = [:]
            for (k, v) in obj {
                if k != selector {
                    remaining[k] = v
                }
            }
            validateInstance(remaining, choiceSchema, path)
        } else {
            // Tagged union: exactly one property matching a choice key
            let keys = Array(obj.keys)
            if keys.count != 1 {
                addError(path, "Tagged union must have exactly one property", instanceChoiceNoMatch)
                return
            }
            let key = keys[0]
            guard let choiceSchema = choices[key] as? [String: Any] else {
                addError(path, "Property '\(key)' not in choices", instanceChoiceUnknown)
                return
            }
            validateInstance(obj[key]!, choiceSchema, "\(path)/\(key)")
        }
    }
    
    // MARK: - Conditional Validation
    
    private func validateConditionals(_ instance: Any, _ schema: [String: Any], _ path: String, _ depth: Int = 0) {
        // allOf
        if let allOf = schema["allOf"] as? [Any] {
            for (i, subSchema) in allOf.enumerated() {
                if let subSchemaMap = subSchema as? [String: Any] {
                    validateInstance(instance, subSchemaMap, "\(path)/allOf[\(i)]", depth + 1)
                }
            }
        }
        
        // anyOf
        if let anyOf = schema["anyOf"] as? [Any] {
            var valid = false
            for (i, subSchema) in anyOf.enumerated() {
                if let subSchemaMap = subSchema as? [String: Any] {
                    let tempValidator = ValidationEngine(options: options)
                    tempValidator.rootSchema = rootSchema
                    tempValidator.enabledExtensions = enabledExtensions
                    tempValidator.validateInstance(instance, subSchemaMap, "\(path)/anyOf[\(i)]", depth + 1)
                    if tempValidator.errors.isEmpty {
                        valid = true
                        break
                    }
                }
            }
            if !valid {
                addError(path, "Instance does not satisfy anyOf", instanceAnyOfNoneMatched)
            }
        }
        
        // oneOf
        if let oneOf = schema["oneOf"] as? [Any] {
            var validCount = 0
            for (i, subSchema) in oneOf.enumerated() {
                if let subSchemaMap = subSchema as? [String: Any] {
                    let tempValidator = ValidationEngine(options: options)
                    tempValidator.rootSchema = rootSchema
                    tempValidator.enabledExtensions = enabledExtensions
                    tempValidator.validateInstance(instance, subSchemaMap, "\(path)/oneOf[\(i)]", depth + 1)
                    if tempValidator.errors.isEmpty {
                        validCount += 1
                    }
                }
            }
            if validCount != 1 {
                addError(path, "Instance must match exactly one schema in oneOf, matched \(validCount)", instanceOneOfInvalidCount)
            }
        }
        
        // not
        if let not = schema["not"] as? [String: Any] {
            let tempValidator = ValidationEngine(options: options)
            tempValidator.rootSchema = rootSchema
            tempValidator.enabledExtensions = enabledExtensions
            tempValidator.validateInstance(instance, not, "\(path)/not", depth + 1)
            if tempValidator.errors.isEmpty {
                addError(path, "Instance must not match \"not\" schema", instanceNotMatched)
            }
        }
        
        // if/then/else
        if let ifSchema = schema["if"] as? [String: Any] {
            let tempValidator = ValidationEngine(options: options)
            tempValidator.rootSchema = rootSchema
            tempValidator.enabledExtensions = enabledExtensions
            tempValidator.validateInstance(instance, ifSchema, "\(path)/if", depth + 1)
            let ifValid = tempValidator.errors.isEmpty
            
            if ifValid {
                if let thenSchema = schema["then"] as? [String: Any] {
                    validateInstance(instance, thenSchema, "\(path)/then", depth + 1)
                }
            } else {
                if let elseSchema = schema["else"] as? [String: Any] {
                    validateInstance(instance, elseSchema, "\(path)/else", depth + 1)
                }
            }
        }
    }
    
    // MARK: - Validation Addins
    
    private func validateValidationAddins(_ instance: Any, _ typeStr: String, _ schema: [String: Any], _ path: String) {
        // String constraints
        if typeStr == "string" {
            if let str = instance as? String {
                if let minLen = toInt(schema["minLength"] as Any) {
                    if str.count < minLen {
                        addError(path, "String length \(str.count) is less than minLength \(minLen)", instanceStringMinLength)
                    }
                }
                if let maxLen = toInt(schema["maxLength"] as Any) {
                    if str.count > maxLen {
                        addError(path, "String length \(str.count) exceeds maxLength \(maxLen)", instanceStringMaxLength)
                    }
                }
                if let pattern = schema["pattern"] as? String {
                    if let regex = try? NSRegularExpression(pattern: pattern) {
                        let range = NSRange(str.startIndex..., in: str)
                        if regex.firstMatch(in: str, range: range) == nil {
                            addError(path, "String does not match pattern: \(pattern)", instanceStringPatternMismatch)
                        }
                    }
                }
                if let format = schema["format"] as? String {
                    switch format {
                    case "date":
                        if !matchesRegex(str, ValidationEngine.dateRegex) {
                            addError(path, "Invalid date format", instanceFormatDateInvalid)
                        }
                    case "time":
                        if !matchesRegex(str, ValidationEngine.timeRegex) {
                            addError(path, "Invalid time format", instanceFormatTimeInvalid)
                        }
                    case "datetime":
                        if !matchesRegex(str, ValidationEngine.datetimeRegex) {
                            addError(path, "Invalid datetime format", instanceFormatDatetimeInvalid)
                        }
                    case "duration":
                        if !matchesRegex(str, ValidationEngine.durationRegex) {
                            addError(path, "Invalid duration format", instanceDurationFormatInvalid)
                        }
                    case "uuid":
                        if !matchesRegex(str, ValidationEngine.uuidRegex) {
                            addError(path, "Invalid UUID format", instanceFormatUUIDInvalid)
                        }
                    case "uri":
                        if URL(string: str) == nil {
                            addError(path, "Invalid URI format", instanceFormatURIInvalid)
                        }
                    case "jsonpointer":
                        if !matchesRegex(str, ValidationEngine.jsonPtrRegex) {
                            addError(path, "Invalid JSON Pointer format", instanceJSONPointerFormatInvalid)
                        }
                    default:
                        break
                    }
                }
                if let contentEncoding = schema["contentEncoding"] as? String {
                    if contentEncoding.lowercased() == "base64" {
                        if Data(base64Encoded: str) == nil {
                            addError(path, "Invalid base64 encoding", instanceBinaryEncodingInvalid)
                        }
                    }
                }
            }
        }
        
        // Numeric constraints
        if isNumericType(typeStr) {
            if let num = toDecimal(instance) {
                if let min = toDecimal(schema["minimum"] as Any), num < min {
                    addError(path, "Value \(num) is less than minimum \(min)", instanceNumberMinimum)
                }
                if let max = toDecimal(schema["maximum"] as Any), num > max {
                    addError(path, "Value \(num) exceeds maximum \(max)", instanceNumberMaximum)
                }
                if let exMin = toDecimal(schema["exclusiveMinimum"] as Any), num <= exMin {
                    addError(path, "Value \(num) is not greater than exclusiveMinimum \(exMin)", instanceNumberExclusiveMinimum)
                }
                if let exMax = toDecimal(schema["exclusiveMaximum"] as Any), num >= exMax {
                    addError(path, "Value \(num) is not less than exclusiveMaximum \(exMax)", instanceNumberExclusiveMaximum)
                }
                if let multipleOf = toDecimal(schema["multipleOf"] as Any) {
                    if multipleOf == 0 {
                        addError(path, "multipleOf must be non-zero", instanceNumberMultipleOf)
                    } else {
                        var quotient = Decimal()
                        var lhs = num
                        var rhs = multipleOf
                        NSDecimalDivide(&quotient, &lhs, &rhs, .plain)
                        if !isIntegerDecimal(quotient) {
                            addError(path, "Value \(num) is not a multiple of \(multipleOf)", instanceNumberMultipleOf)
                        }
                    }
                }
            }
        }
        
        // Array constraints
        if typeStr == "array" || typeStr == "set" {
            if let arr = instance as? [Any] {
                if let minItems = toInt(schema["minItems"] as Any) {
                    if arr.count < minItems {
                        addError(path, "Array has \(arr.count) items, less than minItems \(minItems)", instanceMinItems)
                    }
                }
                if let maxItems = toInt(schema["maxItems"] as Any) {
                    if arr.count > maxItems {
                        addError(path, "Array has \(arr.count) items, more than maxItems \(maxItems)", instanceMaxItems)
                    }
                }
                if let uniqueItems = schema["uniqueItems"] as? Bool, uniqueItems {
                    var seen: Set<String> = []
                    for item in arr {
                        if let str = serializeValue(item) {
                            if seen.contains(str) {
                                addError(path, "Array items are not unique", instanceSetDuplicate)
                                break
                            }
                            seen.insert(str)
                        }
                    }
                }
                
                // Validate contains
                if let containsSchema = schema["contains"] as? [String: Any] {
                    var containsCount = 0
                    let savedErrors = errors
                    for item in arr {
                        errors = []
                        validateInstance(item, containsSchema, path)
                        if errors.isEmpty {
                            containsCount += 1
                        }
                    }
                    errors = savedErrors
                    
                    var minContains = 1
                    var maxContains = Int.max
                    if let mc = toInt(schema["minContains"] as Any) {
                        minContains = mc
                    }
                    if let mc = toInt(schema["maxContains"] as Any) {
                        maxContains = mc
                    }
                    
                    if containsCount < minContains {
                        addError(path, "Array must contain at least \(minContains) matching items (found \(containsCount))", instanceMinContains)
                    }
                    if containsCount > maxContains {
                        addError(path, "Array must contain at most \(maxContains) matching items (found \(containsCount))", instanceMaxContains)
                    }
                }
            }
        }
        
        // Object constraints
        if typeStr == "object" {
            if let obj = instance as? [String: Any] {
                if let minProps = toInt(schema["minProperties"] as Any) {
                    if obj.count < minProps {
                        addError(path, "Object has \(obj.count) properties, less than minProperties \(minProps)", instanceMinProperties)
                    }
                }
                if let maxProps = toInt(schema["maxProperties"] as Any) {
                    if obj.count > maxProps {
                        addError(path, "Object has \(obj.count) properties, more than maxProperties \(maxProps)", instanceMaxProperties)
                    }
                }
                
                // Validate dependentRequired
                if let depReq = schema["dependentRequired"] as? [String: Any] {
                    for (prop, required) in depReq {
                        if obj[prop] != nil {
                            if let reqArr = required as? [Any] {
                                for req in reqArr {
                                    if let reqStr = req as? String {
                                        if obj[reqStr] == nil {
                                            addError(path, "Property '\(prop)' requires property '\(reqStr)'", instanceDependentRequired)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Helper Methods

    private func isNumericType(_ type: String) -> Bool {
        let numericTypes: Set<String> = [
            "number", "integer", "int32", "int8", "uint8", "int16", "uint16", "uint32",
            "int64", "uint64", "int128", "uint128", "float", "float8", "double", "decimal"
        ]
        return numericTypes.contains(type)
    }
    
    private func resolveRef(_ ref: String) -> [String: Any]? {
        // Internal JSON Pointer
        if ref.hasPrefix("#/") {
            return resolveJsonPointer(ref, rootSchema)
        }
        // External ref via referenceResolver
        if let resolver = options.referenceResolver {
            return resolver.resolve(ref)
        }
        return nil
    }

    private func resolveJsonPointer(_ pointer: String, _ root: [String: Any]) -> [String: Any]? {
        guard !root.isEmpty else { return nil }
        let parts = pointer.dropFirst(2).split(separator: "/")
        var current: Any = root
        var index = 0
        for part in parts {
            guard let currentMap = current as? [String: Any] else {
                return nil
            }

            // Unescape JSON Pointer
            var unescaped = String(part)
            unescaped = unescaped.replacingOccurrences(of: "~1", with: "/")
            unescaped = unescaped.replacingOccurrences(of: "~0", with: "~")

            if let val = currentMap[unescaped] {
                current = val
            } else if options.allowImport {
                // Check for $import/$importdefs
                if let importUri = currentMap["$import"] as? String ?? currentMap["$importdefs"] as? String {
                    if let imported = loadImport(importUri) {
                        let hasImportDefs = currentMap["$importdefs"] != nil
                        let remaining = Array(parts.dropFirst(index))
                        let remainingPath = "#/" + remaining.joined(separator: "/")
                        if hasImportDefs {
                            if let defs = imported["definitions"] as? [String: Any] {
                                return resolveJsonPointer(remainingPath, defs)
                            }
                        } else {
                            return resolveJsonPointer(remainingPath, imported)
                        }
                    }
                }
                return nil
            } else {
                return nil
            }
            index += 1
        }
        return current as? [String: Any]
    }

    private func loadImport(_ uri: String) -> [String: Any]? {
        if let cached = loadedImports[uri] {
            return cached
        }
        var loaded: [String: Any]? = nil
        if let loader = options.importLoader {
            loaded = loader.load(uri)
        } else if let ext = options.externalSchemas, let schema = ext[uri] as? [String: Any] {
            loaded = schema
        }
        loadedImports[uri] = loaded
        return loaded
    }
    
    private func deepEqual(_ a: Any, _ b: Any) -> Bool {
        if a is NSNull && b is NSNull {
            return true
        }
        if let aStr = a as? String, let bStr = b as? String {
            return aStr == bStr
        }
        if let aBool = a as? Bool, let bBool = b as? Bool {
            return aBool == bBool
        }
        if let aDec = toDecimal(a), let bDec = toDecimal(b) {
            return aDec == bDec
        }
        let aWrapped: [String: Any] = ["value": a]
        let bWrapped: [String: Any] = ["value": b]
        guard let aData = try? JSONSerialization.data(withJSONObject: aWrapped, options: .sortedKeys),
              let bData = try? JSONSerialization.data(withJSONObject: bWrapped, options: .sortedKeys) else {
            return false
        }
        return aData == bData
    }

    private func isNumber(_ value: Any) -> Bool {
        if value is String { return false }
        return toDecimal(value) != nil
    }

    /// Serializes any value to a comparable string for uniqueness checks.
    private func serializeValue(_ value: Any) -> String? {
        if value is NSNull { return "null" }
        if let str = value as? String { return "\"\(str)\"" }
        if let bool = value as? Bool { return bool ? "true" : "false" }
        if let dec = toDecimal(value) { return dec.description }

        let wrapped: [String: Any] = ["v": value]
        if let data = try? JSONSerialization.data(withJSONObject: wrapped, options: .sortedKeys),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return nil
    }

    private func matchesRegex(_ str: String, _ regex: NSRegularExpression) -> Bool {
        let range = NSRange(str.startIndex..., in: str)
        return regex.firstMatch(in: str, range: range) != nil
    }

    /// Checks if a value is actually a boolean (not just an NSNumber that could bridge to Bool).
    /// On Linux, NSNumber bridges to all compatible types, so `value is Bool` returns true for integers too.
    private func isBoolValue(_ value: Any) -> Bool {
        // Check for Swift Bool first
        if type(of: value) == Bool.self {
            return true
        }
        // For NSNumber, check the objCType - 'c' or 'B' indicates a boolean
        if let num = value as? NSNumber {
            let objCType = String(cString: num.objCType)
            return objCType == "c" || objCType == "B"
        }
        return false
    }
    
    /// Converts numeric values to Decimal (NOT strings). Used for numeric type validation.
    private func toDecimalNumeric(_ value: Any) -> Decimal? {
        if value is NSNull { return nil }
        if isBoolValue(value) { return nil }
        if let dec = value as? Decimal { return dec }
        if let d = value as? Double {
            return Decimal(d)
        }
        if let i = value as? Int {
            return Decimal(i)
        }
        if let f = value as? Float {
            return Decimal(Double(f))
        }
        if let num = value as? NSNumber {
            // Only accept if it's not a boolean
            return num.decimalValue
        }
        // Do NOT accept strings for numeric types
        return nil
    }
    
    /// Converts to Decimal if possible (string or number). Used for numeric constraints.
    private func toDecimal(_ value: Any) -> Decimal? {
        if value is NSNull { return nil }
        if isBoolValue(value) { return nil }
        if let dec = value as? Decimal { return dec }
        if let d = value as? Double {
            return Decimal(d)
        }
        if let i = value as? Int {
            return Decimal(i)
        }
        if let f = value as? Float {
            return Decimal(Double(f))
        }
        if let num = value as? NSNumber {
            return num.decimalValue
        }
        if let str = value as? String {
            return Decimal(string: str)
        }
        return nil
    }

    private func isIntegerDecimal(_ dec: Decimal) -> Bool {
        var value = dec
        var rounded = Decimal()
        NSDecimalRound(&rounded, &value, 0, .plain)
        return rounded == dec
    }

    private func toInt(_ value: Any) -> Int? {
        guard let dec = toDecimal(value), isIntegerDecimal(dec) else { return nil }
        return NSDecimalNumber(decimal: dec).intValue
    }
    
    // MARK: - Error Handling
    
    private func addError(_ path: String, _ message: String, _ code: String = schemaError) {
        var location = JsonLocation.unknown()
        if let locator = sourceLocator {
            location = locator.getLocation(path)
        }
        
        errors.append(ValidationError(
            code: code,
            message: message,
            path: path,
            severity: .error,
            location: location
        ))
    }
    
    private func result() -> ValidationResult {
        return ValidationResult(
            isValid: errors.isEmpty,
            errors: errors,
            warnings: []
        )
    }
}
