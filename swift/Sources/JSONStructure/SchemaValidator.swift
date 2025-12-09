// JSONStructure Swift SDK
// Schema Validator - validates JSON Structure schema documents

import Foundation

/// Validates JSON Structure schema documents.
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
/// let validator = SchemaValidator()
///
/// // Safe to use concurrently - each call gets its own engine
/// await withTaskGroup(of: ValidationResult.self) { group in
///     for schema in schemas {
///         group.addTask {
///             validator.validate(schema)
///         }
///     }
/// }
/// ```
public struct SchemaValidator: Sendable {
    private let options: SchemaValidatorOptions
    
    /// Creates a new SchemaValidator with the given options.
    public init(options: SchemaValidatorOptions = SchemaValidatorOptions()) {
        self.options = options
    }
    
    /// Validates a JSON Structure schema document.
    public func validate(_ schema: Any) -> ValidationResult {
        let engine = ValidationEngine(options: options)
        return engine.validate(schema)
    }
    
    /// Validates a JSON Structure schema from JSON data.
    public func validateJSON(_ jsonData: Data) throws -> ValidationResult {
        let engine = ValidationEngine(options: options)
        return try engine.validateJSON(jsonData)
    }
    
    /// Validates a JSON Structure schema from a JSON string.
    public func validateJSONString(_ jsonString: String) throws -> ValidationResult {
        let engine = ValidationEngine(options: options)
        return try engine.validateJSONString(jsonString)
    }
}

/// Internal validation engine - created fresh for each validation operation.
/// This class contains all the mutable state and validation logic.
private final class ValidationEngine {
    private let options: SchemaValidatorOptions
    private var errors: [ValidationError] = []
    private var warnings: [ValidationError] = []
    private var schema: [String: Any] = [:]
    private var seenRefs: Set<String> = []
    private var seenExtends: Set<String> = []
    private var sourceLocator: JsonSourceLocator?
    
    /// Validation extension keywords that require JSONStructureValidation extension.
    private static let validationExtensionKeywords: Set<String> = [
        "pattern", "format", "minLength", "maxLength",
        "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
        "minItems", "maxItems", "uniqueItems", "contains", "minContains", "maxContains",
        "minProperties", "maxProperties", "propertyNames", "patternProperties", "dependentRequired",
        "minEntries", "maxEntries", "patternKeys", "keyNames",
        "contentEncoding", "contentMediaType", "contentCompression",
        "has", "default"
    ]
    
    init(options: SchemaValidatorOptions) {
        self.options = options
    }
    
    /// Validates a JSON Structure schema document.
    public func validate(_ schema: Any) -> ValidationResult {
        errors = []
        warnings = []
        seenRefs = []
        seenExtends = []
        
        guard let schemaMap = schema as? [String: Any] else {
            addError("#", "Schema must be an object", schemaInvalidType)
            return result()
        }
        
        self.schema = schemaMap
        validateSchemaDocument(schemaMap, "#")
        
        return result()
    }
    
    /// Validates a JSON Structure schema from JSON data.
    public func validateJSON(_ jsonData: Data) throws -> ValidationResult {
        let schema = try JSONSerialization.jsonObject(with: jsonData)
        sourceLocator = JsonSourceLocator(String(data: jsonData, encoding: .utf8) ?? "")
        return validate(schema)
    }
    
    /// Validates a JSON Structure schema from a JSON string.
    public func validateJSONString(_ jsonString: String) throws -> ValidationResult {
        guard let data = jsonString.data(using: .utf8) else {
            throw NSError(domain: "JSONStructure", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid UTF-8 string"])
        }
        return try validateJSON(data)
    }
    
    // MARK: - Schema Validation
    
    private func validateSchemaDocument(_ schema: [String: Any], _ path: String) {
        let isRoot = path == "#"
        
        if isRoot {
            // Root schema must have $id
            if schema["$id"] == nil {
                addError("", "Missing required '$id' keyword at root", schemaRootMissingID)
            }
            
            // Root schema with 'type' must have 'name'
            if schema["type"] != nil && schema["name"] == nil {
                addError("", "Root schema with 'type' must have a 'name' property", schemaRootMissingName)
            }
        }
        
        // Validate definitions if present
        if let defs = schema["definitions"] {
            validateDefinitions(defs, "\(path)/definitions")
        }
        
        // $defs is NOT a JSON Structure keyword
        if schema["$defs"] != nil {
            addError("\(path)/$defs", "'$defs' is not a valid JSON Structure keyword. Use 'definitions' instead.", schemaKeywordInvalidType)
        }
        
        // If there's a $root, validate that the referenced type exists
        if let root = schema["$root"] {
            if let rootStr = root as? String {
                if rootStr.hasPrefix("#/") {
                    if resolveRef(rootStr) == nil {
                        addError("\(path)/$root", "$root reference '\(rootStr)' not found", schemaRefNotFound)
                    }
                }
            } else {
                addError("\(path)/$root", "$root must be a string", schemaKeywordInvalidType)
            }
            
            // Check for validation extension keywords at root level
            if isRoot {
                checkValidationExtensionKeywords(schema)
            }
            return
        }
        
        // Validate the root type if present
        if schema["type"] != nil {
            validateTypeDefinition(schema, path)
        } else {
            // No type at root level and no $root - check for definitions-only schema
            var hasOnlyMeta = true
            for key in schema.keys {
                if !key.hasPrefix("$") && key != "definitions" && key != "name" && key != "description" {
                    hasOnlyMeta = false
                    break
                }
            }
            
            if !hasOnlyMeta || schema["definitions"] == nil {
                addError(path, "Schema must have a 'type' property or '$root' reference", schemaMissingType)
            }
        }
        
        // Validate conditional keywords at root level
        validateConditionalKeywords(schema, path)
        
        // Check for validation extension keywords at root level
        if isRoot {
            checkValidationExtensionKeywords(schema)
        }
    }
    
    private func checkValidationExtensionKeywords(_ schema: [String: Any]) {
        // Check if warnings are enabled (default is true)
        if !options.warnOnUnusedExtensionKeywords {
            return
        }
        
        // Check if validation extensions are enabled
        var validationEnabled = false
        
        if let uses = schema["$uses"] as? [Any] {
            for u in uses {
                if let uStr = u as? String, uStr == "JSONStructureValidation" {
                    validationEnabled = true
                    break
                }
            }
        }
        
        if let schemaURI = schema["$schema"] as? String {
            if schemaURI.contains("extended") || schemaURI.contains("validation") {
                validationEnabled = true
            }
        }
        
        if !validationEnabled {
            collectValidationKeywordWarnings(schema, "")
        }
    }
    
    private func collectValidationKeywordWarnings(_ obj: Any, _ path: String) {
        guard let objMap = obj as? [String: Any] else { return }
        
        for (key, value) in objMap {
            if ValidationEngine.validationExtensionKeywords.contains(key) {
                let keyPath = path.isEmpty ? key : "\(path)/\(key)"
                addWarning(
                    keyPath,
                    "Validation extension keyword '\(key)' is used but validation extensions are not enabled. " +
                    "Add '\"$uses\": [\"JSONStructureValidation\"]' to enable validation, or this keyword will be ignored.",
                    schemaExtensionKeywordNotEnabled
                )
            }
            
            // Recurse into nested objects and arrays
            if let nestedMap = value as? [String: Any] {
                let nextPath = path.isEmpty ? key : "\(path)/\(key)"
                collectValidationKeywordWarnings(nestedMap, nextPath)
            } else if let nestedArray = value as? [Any] {
                for (i, item) in nestedArray.enumerated() {
                    if let itemMap = item as? [String: Any] {
                        let nextPath = path.isEmpty ? "\(key)/\(i)" : "\(path)/\(key)/\(i)"
                        collectValidationKeywordWarnings(itemMap, nextPath)
                    }
                }
            }
        }
    }
    
    private func validateDefinitions(_ defs: Any, _ path: String) {
        guard let defsMap = defs as? [String: Any] else {
            addError(path, "definitions must be an object", schemaPropertiesNotObject)
            return
        }
        
        for (name, def) in defsMap {
            guard let defMap = def as? [String: Any] else {
                addError("\(path)/\(name)", "Definition must be an object", schemaInvalidType)
                continue
            }
            
            // Check if this is a type definition or a namespace
            if isTypeDefinition(defMap) {
                validateTypeDefinition(defMap, "\(path)/\(name)")
            } else {
                // This is a namespace - validate its contents as definitions
                validateDefinitions(defMap, "\(path)/\(name)")
            }
        }
    }
    
    private func isTypeDefinition(_ schema: [String: Any]) -> Bool {
        if schema["type"] != nil {
            return true
        }
        // Note: bare $ref is NOT a valid type definition per spec Section 3.4.1
        let conditionalKeywords = ["allOf", "anyOf", "oneOf", "not", "if"]
        for k in conditionalKeywords {
            if schema[k] != nil {
                return true
            }
        }
        return false
    }
    
    private func validateTypeDefinition(_ schema: [String: Any], _ path: String) {
        // Check for bare $ref - this is NOT permitted per spec Section 3.4.1
        if schema["$ref"] != nil {
            addError("\(path)/$ref", "'$ref' is only permitted inside the 'type' attribute. Use { \"type\": { \"$ref\": \"...\" } } instead of { \"$ref\": \"...\" }", schemaRefNotInType)
            return
        }
        
        // Validate $extends if present
        if let extendsVal = schema["$extends"] {
            validateExtends(extendsVal, "\(path)/$extends")
        }

        // Validate alternate names
        if let altnames = schema["altnames"] {
            validateAltnames(altnames, path)
        }
        
        guard let typeVal = schema["type"] else {
            // Type is required unless it's a conditional-only schema
            let conditionalKeywords = ["allOf", "anyOf", "oneOf", "not", "if"]
            var hasConditional = false
            for k in conditionalKeywords {
                if schema[k] != nil {
                    hasConditional = true
                    break
                }
            }
            
            if !hasConditional {
                if schema["$root"] == nil {
                    addError(path, "Schema must have a 'type' property", schemaMissingType)
                }
            }
            return
        }
        
        // Type can be a string, array (union), or object with $ref
        if let typeStr = typeVal as? String {
            validateSingleType(typeStr, schema, path)
        } else if let typeArr = typeVal as? [Any] {
            validateUnionType(typeArr, schema, path)
        } else if let typeRef = typeVal as? [String: Any] {
            if let ref = typeRef["$ref"] {
                validateRef(ref, "\(path)/type")
            } else {
                addError("\(path)/type", "type object must have $ref", schemaTypeObjectMissingRef)
            }
        } else {
            addError("\(path)/type", "type must be a string, array, or object with $ref", schemaKeywordInvalidType)
        }
    }
    
    private func validateSingleType(_ typeStr: String, _ schema: [String: Any], _ path: String) {
        if !isValidType(typeStr) {
            addError("\(path)/type", "Unknown type '\(typeStr)'", schemaTypeInvalid)
            return
        }
        
        // Validate type-specific constraints
        switch typeStr {
        case "object":
            validateObjectType(schema, path)
        case "array", "set":
            validateArrayType(schema, path)
        case "map":
            validateMapType(schema, path)
        case "tuple":
            validateTupleType(schema, path)
        case "choice":
            validateChoiceType(schema, path)
        default:
            validatePrimitiveConstraints(typeStr, schema, path)
        }
    }
    
    private func validateUnionType(_ types: [Any], _ schema: [String: Any], _ path: String) {
        if types.isEmpty {
            addError("\(path)/type", "Union type array cannot be empty", schemaTypeArrayEmpty)
            return
        }
        
        for (i, t) in types.enumerated() {
            if let typeStr = t as? String {
                if !isValidType(typeStr) {
                    addError("\(path)/type[\(i)]", "Unknown type '\(typeStr)'", schemaTypeInvalid)
                }
            } else if let typeMap = t as? [String: Any] {
                if let ref = typeMap["$ref"] {
                    validateRef(ref, "\(path)/type[\(i)]")
                } else {
                    addError("\(path)/type[\(i)]", "Union type object must have $ref", schemaTypeObjectMissingRef)
                }
            } else {
                addError("\(path)/type[\(i)]", "Union type elements must be strings or $ref objects", schemaKeywordInvalidType)
            }
        }
    }
    
    private func validateObjectType(_ schema: [String: Any], _ path: String) {
        // properties validation
        if let props = schema["properties"] {
            guard let propsMap = props as? [String: Any] else {
                addError("\(path)/properties", "properties must be an object", schemaPropertiesNotObject)
                return
            }
            
            if propsMap.isEmpty {
                if schema["$extends"] == nil {
                    addError("\(path)/properties", "properties must have at least one entry", schemaKeywordEmpty)
                }
            } else {
                for (propName, propSchema) in propsMap {
                    guard let propMap = propSchema as? [String: Any] else {
                        addError("\(path)/properties/\(propName)", "Property schema must be an object", schemaInvalidType)
                        continue
                    }
                    validateTypeDefinition(propMap, "\(path)/properties/\(propName)")
                }
            }
        }
        
        // required validation
        if let req = schema["required"] {
            guard let reqArr = req as? [Any] else {
                addError("\(path)/required", "required must be an array", schemaRequiredNotArray)
                return
            }
            
            let propsMap = schema["properties"] as? [String: Any]
            
            for (i, r) in reqArr.enumerated() {
                guard let rStr = r as? String else {
                    addError("\(path)/required[\(i)]", "required elements must be strings", schemaRequiredItemNotString)
                    continue
                }
                
                if let props = propsMap {
                    if props[rStr] == nil {
                        if schema["$extends"] == nil {
                            addError("\(path)/required[\(i)]", "Required property '\(rStr)' not found in properties", schemaRequiredPropertyNotDefined)
                        }
                    }
                }
            }
        }
    }
    
    private func validateArrayType(_ schema: [String: Any], _ path: String) {
        guard let items = schema["items"] else {
            addError(path, "Array type must have 'items' property", schemaArrayMissingItems)
            return
        }
        
        guard let itemsMap = items as? [String: Any] else {
            addError("\(path)/items", "items must be an object", schemaKeywordInvalidType)
            return
        }
        
        validateTypeDefinition(itemsMap, "\(path)/items")
        validateArrayConstraints(schema, path)
    }
    
    private func validateMapType(_ schema: [String: Any], _ path: String) {
        guard let values = schema["values"] else {
            addError(path, "Map type must have 'values' property", schemaMapMissingValues)
            return
        }
        
        guard let valuesMap = values as? [String: Any] else {
            addError("\(path)/values", "values must be an object", schemaKeywordInvalidType)
            return
        }
        
        validateTypeDefinition(valuesMap, "\(path)/values")
    }
    
    private func validateTupleType(_ schema: [String: Any], _ path: String) {
        guard let tuple = schema["tuple"] else {
            addError(path, "Tuple type must have 'tuple' property defining element order", schemaTupleMissingDefinition)
            return
        }
        
        guard let tupleArr = tuple as? [Any] else {
            addError("\(path)/tuple", "tuple must be an array", schemaTupleOrderNotArray)
            return
        }
        
        let propsMap = schema["properties"] as? [String: Any]
        
        for (i, elem) in tupleArr.enumerated() {
            guard let name = elem as? String else {
                addError("\(path)/tuple[\(i)]", "tuple elements must be strings", schemaKeywordInvalidType)
                continue
            }
            
            if let props = propsMap {
                if props[name] == nil {
                    addError("\(path)/tuple[\(i)]", "Tuple element '\(name)' not found in properties", schemaRequiredPropertyNotDefined)
                }
            }
        }
    }
    
    private func validateChoiceType(_ schema: [String: Any], _ path: String) {
        guard let choices = schema["choices"] else {
            addError(path, "Choice type must have 'choices' property", schemaChoiceMissingChoices)
            return
        }
        
        guard let choicesMap = choices as? [String: Any] else {
            addError("\(path)/choices", "choices must be an object", schemaChoicesNotObject)
            return
        }
        
        for (choiceName, choiceSchema) in choicesMap {
            guard let choiceMap = choiceSchema as? [String: Any] else {
                addError("\(path)/choices/\(choiceName)", "Choice schema must be an object", schemaInvalidType)
                continue
            }
            validateTypeDefinition(choiceMap, "\(path)/choices/\(choiceName)")
        }
    }
    
    private func validatePrimitiveConstraints(_ typeStr: String, _ schema: [String: Any], _ path: String) {
        // Validate enum
        if let enumVal = schema["enum"] {
            guard let enumArr = enumVal as? [Any] else {
                addError("\(path)/enum", "enum must be an array", schemaEnumNotArray)
                return
            }
            
            if enumArr.isEmpty {
                addError("\(path)/enum", "enum must have at least one value", schemaEnumEmpty)
            } else {
                // Check for duplicates
                var seen: Set<String> = []
                for item in enumArr {
                    if let str = serializeValue(item) {
                        if seen.contains(str) {
                            addError("\(path)/enum", "enum values must be unique", schemaEnumDuplicates)
                            break
                        }
                        seen.insert(str)
                    }
                }
            }
        }
        
        // Validate constraint type matching
        validateConstraintTypeMatch(typeStr, schema, path)
        
        // Validate string constraints
        if typeStr == "string" {
            validateStringConstraints(schema, path)
        }
        
        // Validate numeric constraints
        if isNumericType(typeStr) {
            validateNumericConstraints(schema, path)
        }
    }
    
    private func validateStringConstraints(_ schema: [String: Any], _ path: String) {
        if let minLen = schema["minLength"] {
            if let minLenNum = toInt(minLen) {
                if minLenNum < 0 {
                    addError("\(path)/minLength", "minLength must be a non-negative integer", schemaIntegerConstraintInvalid)
                }
            } else {
                addError("\(path)/minLength", "minLength must be an integer", schemaIntegerConstraintInvalid)
            }
        }
        
        if let maxLen = schema["maxLength"] {
            if let maxLenNum = toInt(maxLen) {
                if maxLenNum < 0 {
                    addError("\(path)/maxLength", "maxLength must be a non-negative integer", schemaIntegerConstraintInvalid)
                }
            } else {
                addError("\(path)/maxLength", "maxLength must be an integer", schemaIntegerConstraintInvalid)
            }
        }
        
        // Check minLength <= maxLength
        if let minLen = toInt(schema["minLength"] as Any),
           let maxLen = toInt(schema["maxLength"] as Any) {
            if minLen > maxLen {
                addError(path, "minLength cannot exceed maxLength", schemaMinGreaterThanMax)
            }
        }
        
        if let pattern = schema["pattern"] {
            guard let patternStr = pattern as? String else {
                addError("\(path)/pattern", "pattern must be a string", schemaPatternNotString)
                return
            }
            
            do {
                _ = try NSRegularExpression(pattern: patternStr)
            } catch {
                addError("\(path)/pattern", "Invalid regular expression: \(patternStr)", schemaPatternInvalid)
            }
        }
    }
    
    private func validateNumericConstraints(_ schema: [String: Any], _ path: String) {
        if let min = schema["minimum"] {
            if toDouble(min) == nil {
                addError("\(path)/minimum", "minimum must be a number", schemaNumberConstraintInvalid)
            }
        }
        
        if let max = schema["maximum"] {
            if toDouble(max) == nil {
                addError("\(path)/maximum", "maximum must be a number", schemaNumberConstraintInvalid)
            }
        }
        
        // Check minimum <= maximum
        if let minVal = schema["minimum"], let maxVal = schema["maximum"] {
            if let minNum = toDouble(minVal), let maxNum = toDouble(maxVal) {
                if minNum > maxNum {
                    addError(path, "minimum cannot exceed maximum", schemaMinGreaterThanMax)
                }
            }
        }
        
        if let multipleOf = schema["multipleOf"] {
            if let multipleOfNum = toDouble(multipleOf) {
                if multipleOfNum <= 0 {
                    addError("\(path)/multipleOf", "multipleOf must be greater than 0", schemaPositiveNumberConstraintInvalid)
                }
            } else {
                addError("\(path)/multipleOf", "multipleOf must be a number", schemaNumberConstraintInvalid)
            }
        }
    }
    
    private func validateArrayConstraints(_ schema: [String: Any], _ path: String) {
        if let minItems = schema["minItems"] {
            if let minItemsNum = toInt(minItems) {
                if minItemsNum < 0 {
                    addError("\(path)/minItems", "minItems must be a non-negative integer", schemaIntegerConstraintInvalid)
                }
            } else {
                addError("\(path)/minItems", "minItems must be an integer", schemaIntegerConstraintInvalid)
            }
        }
        
        if let maxItems = schema["maxItems"] {
            if let maxItemsNum = toInt(maxItems) {
                if maxItemsNum < 0 {
                    addError("\(path)/maxItems", "maxItems must be a non-negative integer", schemaIntegerConstraintInvalid)
                }
            } else {
                addError("\(path)/maxItems", "maxItems must be an integer", schemaIntegerConstraintInvalid)
            }
        }
        
        // Check minItems <= maxItems
        if let minItems = toInt(schema["minItems"] as Any),
           let maxItems = toInt(schema["maxItems"] as Any) {
            if minItems > maxItems {
                addError(path, "minItems cannot exceed maxItems", schemaMinGreaterThanMax)
            }
        }
    }
    
    private func validateConditionalKeywords(_ schema: [String: Any], _ path: String) {
        // Validate allOf
        if let allOf = schema["allOf"] {
            guard let allOfArr = allOf as? [Any] else {
                addError("\(path)/allOf", "allOf must be an array", schemaCompositionNotArray)
                return
            }
            
            for (i, item) in allOfArr.enumerated() {
                if let itemMap = item as? [String: Any] {
                    validateTypeDefinition(itemMap, "\(path)/allOf[\(i)]")
                }
            }
        }
        
        // Validate anyOf
        if let anyOf = schema["anyOf"] {
            guard let anyOfArr = anyOf as? [Any] else {
                addError("\(path)/anyOf", "anyOf must be an array", schemaCompositionNotArray)
                return
            }
            
            for (i, item) in anyOfArr.enumerated() {
                if let itemMap = item as? [String: Any] {
                    validateTypeDefinition(itemMap, "\(path)/anyOf[\(i)]")
                }
            }
        }
        
        // Validate oneOf
        if let oneOf = schema["oneOf"] {
            guard let oneOfArr = oneOf as? [Any] else {
                addError("\(path)/oneOf", "oneOf must be an array", schemaCompositionNotArray)
                return
            }
            
            for (i, item) in oneOfArr.enumerated() {
                if let itemMap = item as? [String: Any] {
                    validateTypeDefinition(itemMap, "\(path)/oneOf[\(i)]")
                }
            }
        }
        
        // Validate not
        if let not = schema["not"] {
            guard let notMap = not as? [String: Any] else {
                addError("\(path)/not", "not must be an object", schemaKeywordInvalidType)
                return
            }
            validateTypeDefinition(notMap, "\(path)/not")
        }
        
        // Validate if/then/else
        if let ifSchema = schema["if"] {
            guard let ifMap = ifSchema as? [String: Any] else {
                addError("\(path)/if", "if must be an object", schemaKeywordInvalidType)
                return
            }
            validateTypeDefinition(ifMap, "\(path)/if")
        }
        
        if let thenSchema = schema["then"] {
            guard let thenMap = thenSchema as? [String: Any] else {
                addError("\(path)/then", "then must be an object", schemaKeywordInvalidType)
                return
            }
            validateTypeDefinition(thenMap, "\(path)/then")
        }
        
        if let elseSchema = schema["else"] {
            guard let elseMap = elseSchema as? [String: Any] else {
                addError("\(path)/else", "else must be an object", schemaKeywordInvalidType)
                return
            }
            validateTypeDefinition(elseMap, "\(path)/else")
        }
    }
    
    private func validateConstraintTypeMatch(_ typeStr: String, _ schema: [String: Any], _ path: String) {
        let stringOnlyConstraints = ["minLength", "maxLength", "pattern"]
        let numericOnlyConstraints = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]
        
        // Check string constraints on non-string types
        for constraint in stringOnlyConstraints {
            if schema[constraint] != nil && typeStr != "string" {
                addError("\(path)/\(constraint)", "\(constraint) constraint is only valid for string type, not \(typeStr)", schemaConstraintInvalidForType)
            }
        }
        
        // Check numeric constraints on non-numeric types
        for constraint in numericOnlyConstraints {
            if schema[constraint] != nil && !isNumericType(typeStr) {
                addError("\(path)/\(constraint)", "\(constraint) constraint is only valid for numeric types, not \(typeStr)", schemaConstraintInvalidForType)
            }
        }
    }
    
    private func validateExtends(_ extendsVal: Any, _ path: String) {
        var refs: [String] = []
        var refPaths: [String] = []
        
        if let ev = extendsVal as? String {
            refs.append(ev)
            refPaths.append(path)
        } else if let evArr = extendsVal as? [Any] {
            for (i, item) in evArr.enumerated() {
                if let refStr = item as? String {
                    refs.append(refStr)
                    refPaths.append("\(path)[\(i)]")
                } else {
                    addError("\(path)[\(i)]", "$extends array items must be strings", schemaKeywordInvalidType)
                }
            }
        } else {
            addError(path, "$extends must be a string or array of strings", schemaKeywordInvalidType)
            return
        }
        
        for (i, ref) in refs.enumerated() {
            let refPath = refPaths[i]
            
            if !ref.hasPrefix("#/") {
                continue // External references handled elsewhere
            }
            
            // Check for circular $extends
            if seenExtends.contains(ref) {
                addError(refPath, "Circular $extends reference detected: \(ref)", schemaExtendsCircular)
                continue
            }
            
            seenExtends.insert(ref)
            
            if let resolved = resolveRef(ref) {
                if let extendsVal = resolved["$extends"] {
                    validateExtends(extendsVal, refPath)
                }
            } else {
                addError(refPath, "$extends reference '\(ref)' not found", schemaExtendsNotFound)
            }
            
            seenExtends.remove(ref)
        }
    }
    
    private func validateRef(_ ref: Any, _ path: String) {
        guard let refStr = ref as? String else {
            addError(path, "$ref must be a string", schemaKeywordInvalidType)
            return
        }
        
        if refStr.hasPrefix("#/") {
            // Check for circular reference
            if seenRefs.contains(refStr) {
                // Check if it's a direct circular reference with no content
                if let resolved = resolveRef(refStr) {
                    if resolved.count == 1 {
                        if resolved["$ref"] != nil {
                            addError(path, "Circular reference detected: \(refStr)", schemaRefCircular)
                        } else if let typeVal = resolved["type"] as? [String: Any] {
                            if typeVal.count == 1 && typeVal["$ref"] != nil {
                                addError(path, "Circular reference detected: \(refStr)", schemaRefCircular)
                            }
                        }
                    }
                }
                return
            }
            
            seenRefs.insert(refStr)
            
            if let resolved = resolveRef(refStr) {
                validateTypeDefinition(resolved, path)
            } else {
                addError(path, "$ref '\(refStr)' not found", schemaRefNotFound)
            }
            
            seenRefs.remove(refStr)
        }
    }

    private func validateAltnames(_ value: Any, _ path: String) {
        guard let obj = value as? [String: Any] else {
            addError("\(path)/altnames", "altnames must be an object", schemaAltnamesNotObject)
            return
        }
        for (key, val) in obj {
            if !(val is String) {
                addError("\(path)/altnames/\(key)", "altnames values must be strings", schemaAltnamesValueNotString)
            }
        }
    }
    
    private func resolveRef(_ ref: String) -> [String: Any]? {
        guard !schema.isEmpty, ref.hasPrefix("#/") else {
            return nil
        }
        
        let parts = ref.dropFirst(2).split(separator: "/")
        var current: Any = schema
        
        for part in parts {
            guard let currentMap = current as? [String: Any] else {
                return nil
            }
            
            // Unescape JSON Pointer
            var unescaped = String(part)
            unescaped = unescaped.replacingOccurrences(of: "~1", with: "/")
            unescaped = unescaped.replacingOccurrences(of: "~0", with: "~")
            
            guard let val = currentMap[unescaped] else {
                return nil
            }
            current = val
        }
        
        return current as? [String: Any]
    }
    
    /// Serializes any value to a comparable string for uniqueness checks.
    private func serializeValue(_ value: Any) -> String? {
        if value is NSNull {
            return "null"
        }
        if let str = value as? String {
            return "\"\(str)\""
        }
        if let bool = value as? Bool {
            return bool ? "true" : "false"
        }
        if let num = value as? Double {
            return String(num)
        }
        if let num = value as? Int {
            return String(num)
        }
        // For arrays and objects, wrap in a container
        let wrapped: [String: Any] = ["v": value]
        if let data = try? JSONSerialization.data(withJSONObject: wrapped, options: .sortedKeys),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return nil
    }
    
    /// Converts any numeric value to Double.
    private func toDouble(_ value: Any) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let f = value as? Float { return Double(f) }
        return nil
    }
    
    /// Converts any numeric value to Int.
    private func toInt(_ value: Any) -> Int? {
        if let i = value as? Int { return i }
        if let d = value as? Double { return Int(d) }
        if let f = value as? Float { return Int(f) }
        return nil
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
    
    private func addWarning(_ path: String, _ message: String, _ code: String) {
        var location = JsonLocation.unknown()
        if let locator = sourceLocator {
            location = locator.getLocation(path)
        }
        
        warnings.append(ValidationError(
            code: code,
            message: message,
            path: path,
            severity: .warning,
            location: location
        ))
    }
    
    private func result() -> ValidationResult {
        return ValidationResult(
            isValid: errors.isEmpty,
            errors: errors,
            warnings: warnings
        )
    }
}
