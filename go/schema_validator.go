// Package jsonstructure provides validators for JSON Structure schemas and instances.
package jsonstructure

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// schemaValidationContext holds per-validation mutable state.
type schemaValidationContext struct {
	errors          []ValidationError
	warnings        []ValidationError
	schema          map[string]interface{}
	seenRefs        map[string]bool
	seenExtends     map[string]bool
	sourceLocator   *JsonSourceLocator
	externalSchemas map[string]interface{}
}

// SchemaValidator validates JSON Structure schema documents.
// It is safe for concurrent use from multiple goroutines after construction.
type SchemaValidator struct {
	options         SchemaValidatorOptions
	externalSchemas map[string]interface{}
}

// NewSchemaValidator creates a new SchemaValidator with the given options.
// The returned validator is safe for concurrent use from multiple goroutines.
func NewSchemaValidator(options *SchemaValidatorOptions) *SchemaValidator {
	opts := SchemaValidatorOptions{}
	if options != nil {
		opts = *options
	}
	v := &SchemaValidator{
		options:         opts,
		externalSchemas: make(map[string]interface{}),
	}

	// Build lookup for external schemas by $id and preprocess imports
	if opts.ExternalSchemas != nil {
		// Deep copy all schemas
		for uri, schema := range opts.ExternalSchemas {
			copied := deepCopySchema(schema)
			v.externalSchemas[uri] = copied
			// Also add by $id if present
			if schemaMap, ok := schema.(map[string]interface{}); ok {
				if id, ok := schemaMap["$id"].(string); ok && id != uri {
					v.externalSchemas[id] = deepCopySchema(schema)
				}
			}
		}
		// Process imports in external schemas if allowImport is enabled
		if opts.AllowImport {
			// Multiple passes to handle chained imports
			for i := 0; i < len(v.externalSchemas); i++ {
				for _, schema := range v.externalSchemas {
					if schemaMap, ok := schema.(map[string]interface{}); ok {
						processImportsInExternalSchema(schemaMap, v.externalSchemas)
					}
				}
			}
		}
	}

	return v
}

// Validate validates a JSON Structure schema document.
// This method is safe to call concurrently from multiple goroutines.
func (v *SchemaValidator) Validate(schema interface{}) ValidationResult {
	ctx := &schemaValidationContext{
		errors:          []ValidationError{},
		warnings:        []ValidationError{},
		seenRefs:        make(map[string]bool),
		seenExtends:     make(map[string]bool),
		sourceLocator:   nil,
		externalSchemas: v.externalSchemas,
	}

	schemaMap, ok := schema.(map[string]interface{})
	if !ok {
		ctx.addError("#", "Schema must be an object", SchemaInvalidType)
		return ctx.result()
	}

	ctx.schema = schemaMap

	// Process imports if enabled
	if v.options.AllowImport {
		ctx.processImports(schemaMap, "#")
	}

	ctx.validateSchemaDocument(schemaMap, "#", v.options)

	return ctx.result()
}

// ValidateJSON validates a JSON Structure schema from JSON bytes.
// This method is safe to call concurrently from multiple goroutines.
func (v *SchemaValidator) ValidateJSON(jsonData []byte) (ValidationResult, error) {
	var schema interface{}
	if err := json.Unmarshal(jsonData, &schema); err != nil {
		return ValidationResult{IsValid: false}, err
	}
	// Create source locator for the schema JSON
	ctx := &schemaValidationContext{
		errors:          []ValidationError{},
		warnings:        []ValidationError{},
		seenRefs:        make(map[string]bool),
		seenExtends:     make(map[string]bool),
		sourceLocator:   NewJsonSourceLocator(string(jsonData)),
		externalSchemas: v.externalSchemas,
	}
	
	schemaMap, ok := schema.(map[string]interface{})
	if !ok {
		ctx.addError("#", "Schema must be an object", SchemaInvalidType)
		return ctx.result(), nil
	}

	ctx.schema = schemaMap

	// Process imports if enabled
	if v.options.AllowImport {
		ctx.processImports(schemaMap, "#")
	}

	ctx.validateSchemaDocument(schemaMap, "#", v.options)

	return ctx.result(), nil
}

// Validation extension keywords that require JSONStructureValidation extension.
var validationExtensionKeywords = map[string]bool{
	"pattern": true, "format": true, "minLength": true, "maxLength": true,
	"minimum": true, "maximum": true, "exclusiveMinimum": true, "exclusiveMaximum": true, "multipleOf": true,
	"minItems": true, "maxItems": true, "uniqueItems": true, "contains": true, "minContains": true, "maxContains": true,
	"minProperties": true, "maxProperties": true, "propertyNames": true, "patternProperties": true, "dependentRequired": true,
	"minEntries": true, "maxEntries": true, "patternKeys": true, "keyNames": true,
	"contentEncoding": true, "contentMediaType": true,
	"has": true, "default": true,
}

func (ctx *schemaValidationContext) validateSchemaDocument(schema map[string]interface{}, path string, options SchemaValidatorOptions) {
	// Root-level validation (path is "#" for root)
	isRoot := path == "#"
	if isRoot {
		// Root schema must have $id
		if _, hasID := schema["$id"]; !hasID {
			ctx.addError("", "Missing required '$id' keyword at root", SchemaRootMissingID)
		}

		// Root schema with 'type' must have 'name'
		_, hasType := schema["type"]
		_, hasName := schema["name"]
		if hasType && !hasName {
			ctx.addError("", "Root schema with 'type' must have a 'name' property", SchemaRootMissingName)
		}
	}

	// Validate definitions if present
	if defs, ok := schema["definitions"]; ok {
		ctx.validateDefinitions(defs, path+"/definitions")
	}
	// Note: $defs is NOT a JSON Structure keyword (it's JSON Schema).
	// JSON Structure uses 'definitions' only.
	if _, ok := schema["$defs"]; ok {
		ctx.addError(path+"/$defs", "'$defs' is not a valid JSON Structure keyword. Use 'definitions' instead.", SchemaKeywordInvalidType)
	}

	// If there's a $root, validate that the referenced type exists
	if root, ok := schema["$root"]; ok {
		rootStr, isStr := root.(string)
		if !isStr {
			ctx.addError(path+"/$root", "$root must be a string", SchemaKeywordInvalidType)
		} else if strings.HasPrefix(rootStr, "#/") {
			if ctx.resolveRef(rootStr) == nil {
				ctx.addError(path+"/$root", fmt.Sprintf("$root reference '%s' not found", rootStr), SchemaRefNotFound)
			}
		}
		// Check for validation extension keywords at root level
		if isRoot {
			ctx.checkValidationExtensionKeywords(schema, options)
		}
		return
	}

	// Validate the root type if present
	if _, ok := schema["type"]; ok {
		ctx.validateTypeDefinition(schema, path)
	} else {
		// No type at root level and no $root - check for definitions-only schema
		hasOnlyMeta := true
		for k := range schema {
			if !strings.HasPrefix(k, "$") && k != "definitions" && k != "name" && k != "description" {
				hasOnlyMeta = false
				break
			}
		}
		_, hasDefs := schema["definitions"]
		if !hasOnlyMeta || !hasDefs {
			ctx.addError(path, "Schema must have a 'type' property or '$root' reference", SchemaMissingType)
		}
	}

	// Validate conditional keywords at root level
	ctx.validateConditionalKeywords(schema, path)

	// Check for validation extension keywords at root level
	if isRoot {
		ctx.checkValidationExtensionKeywords(schema, options)
	}
}

// checkValidationExtensionKeywords checks if validation extension keywords are used
// without enabling the validation extension and adds warnings.
func (ctx *schemaValidationContext) checkValidationExtensionKeywords(schema map[string]interface{}, options SchemaValidatorOptions) {
	// Check if warnings are enabled (default is true)
	if options.WarnOnUnusedExtensionKeywords != nil && !*options.WarnOnUnusedExtensionKeywords {
		return
	}

	// Check if validation extensions are enabled
	validationEnabled := false

	if uses, ok := schema["$uses"].([]interface{}); ok {
		for _, u := range uses {
			if uStr, ok := u.(string); ok && uStr == "JSONStructureValidation" {
				validationEnabled = true
				break
			}
		}
	}

	if schemaURI, ok := schema["$schema"].(string); ok {
		if strings.Contains(schemaURI, "extended") || strings.Contains(schemaURI, "validation") {
			validationEnabled = true
		}
	}

	if !validationEnabled {
		ctx.collectValidationKeywordWarnings(schema, "")
	}
}

func (ctx *schemaValidationContext) collectValidationKeywordWarnings(obj interface{}, path string) {
	objMap, ok := obj.(map[string]interface{})
	if !ok {
		return
	}

	for key, value := range objMap {
		if validationExtensionKeywords[key] {
			keyPath := key
			if path != "" {
				keyPath = path + "/" + key
			}
			ctx.addWarning(
				keyPath,
				fmt.Sprintf("Validation extension keyword '%s' is used but validation extensions are not enabled. "+
					"Add '\"$uses\": [\"JSONStructureValidation\"]' to enable validation, or this keyword will be ignored.", key),
				SchemaExtensionKeywordNotEnabled,
			)
		}

		// Recurse into nested objects and arrays
		if nestedMap, ok := value.(map[string]interface{}); ok {
			nextPath := key
			if path != "" {
				nextPath = path + "/" + key
			}
			ctx.collectValidationKeywordWarnings(nestedMap, nextPath)
		} else if nestedArray, ok := value.([]interface{}); ok {
			for i, item := range nestedArray {
				if itemMap, ok := item.(map[string]interface{}); ok {
					nextPath := fmt.Sprintf("%s/%d", key, i)
					if path != "" {
						nextPath = path + "/" + nextPath
					}
					ctx.collectValidationKeywordWarnings(itemMap, nextPath)
				}
			}
		}
	}
}

func (ctx *schemaValidationContext) validateDefinitions(defs interface{}, path string) {
	defsMap, ok := defs.(map[string]interface{})
	if !ok {
		ctx.addError(path, "definitions must be an object", SchemaPropertiesNotObject)
		return
	}

	for name, def := range defsMap {
		defMap, isMap := def.(map[string]interface{})
		if !isMap {
			ctx.addError(path+"/"+name, "Definition must be an object", SchemaInvalidType)
			continue
		}
		// Check if this is a type definition or a namespace
		if ctx.isTypeDefinition(defMap) {
			ctx.validateTypeDefinition(defMap, path+"/"+name)
		} else {
			// This is a namespace - validate its contents as definitions
			ctx.validateDefinitions(defMap, path+"/"+name)
		}
	}
}

func (ctx *schemaValidationContext) isTypeDefinition(schema map[string]interface{}) bool {
	if _, hasType := schema["type"]; hasType {
		return true
	}
	// Note: bare $ref is NOT a valid type definition per spec Section 3.4.1
	// $ref is only permitted inside the 'type' attribute
	conditionalKeywords := []string{"allOf", "anyOf", "oneOf", "not", "if"}
	for _, k := range conditionalKeywords {
		if _, ok := schema[k]; ok {
			return true
		}
	}
	return false
}

func (ctx *schemaValidationContext) validateTypeDefinition(schema map[string]interface{}, path string) {
	// Check for bare $ref - this is NOT permitted per spec Section 3.4.1
	// $ref is ONLY permitted inside the 'type' attribute value
	if _, hasRef := schema["$ref"]; hasRef {
		ctx.addError(path+"/$ref", "'$ref' is only permitted inside the 'type' attribute. Use { \"type\": { \"$ref\": \"...\" } } instead of { \"$ref\": \"...\" }", SchemaRefNotInType)
		return
	}

	// Validate $extends if present
	if extendsVal, hasExtends := schema["$extends"]; hasExtends {
		ctx.validateExtends(extendsVal, path+"/$extends")
	}

	typeVal, hasType := schema["type"]

	// Type is required unless it's a conditional-only schema
	if !hasType {
		conditionalKeywords := []string{"allOf", "anyOf", "oneOf", "not", "if"}
		hasConditional := false
		for _, k := range conditionalKeywords {
			if _, ok := schema[k]; ok {
				hasConditional = true
				break
			}
		}
		if !hasConditional {
			if _, hasDollarRoot := schema["$root"]; !hasDollarRoot {
				ctx.addError(path, "Schema must have a 'type' property", SchemaMissingType)
			}
		}
		return
	}

	// Type can be a string, array (union), or object with $ref
	switch t := typeVal.(type) {
	case string:
		ctx.validateSingleType(t, schema, path)
	case []interface{}:
		ctx.validateUnionType(t, schema, path)
	case map[string]interface{}:
		if ref, ok := t["$ref"]; ok {
			ctx.validateRef(ref, path+"/type")
		} else {
			ctx.addError(path+"/type", "type object must have $ref", SchemaTypeObjectMissingRef)
		}
	default:
		ctx.addError(path+"/type", "type must be a string, array, or object with $ref", SchemaKeywordInvalidType)
	}
}

func (ctx *schemaValidationContext) validateSingleType(typeStr string, schema map[string]interface{}, path string) {
	if !isValidType(typeStr) {
		ctx.addError(path+"/type", fmt.Sprintf("Unknown type '%s'", typeStr), SchemaTypeInvalid)
		return
	}

	// Validate type-specific constraints
	switch typeStr {
	case "object":
		ctx.validateObjectType(schema, path)
	case "array", "set":
		ctx.validateArrayType(schema, path)
	case "map":
		ctx.validateMapType(schema, path)
	case "tuple":
		ctx.validateTupleType(schema, path)
	case "choice":
		ctx.validateChoiceType(schema, path)
	default:
		ctx.validatePrimitiveConstraints(typeStr, schema, path)
	}
}

func (ctx *schemaValidationContext) validateUnionType(types []interface{}, _ map[string]interface{}, path string) {
	if len(types) == 0 {
		ctx.addError(path+"/type", "Union type array cannot be empty", SchemaTypeArrayEmpty)
		return
	}

	for i, t := range types {
		if typeStr, ok := t.(string); ok {
			// String type name
			if !isValidType(typeStr) {
				ctx.addError(fmt.Sprintf("%s/type[%d]", path, i), fmt.Sprintf("Unknown type '%s'", typeStr), SchemaTypeInvalid)
			}
		} else if typeMap, ok := t.(map[string]interface{}); ok {
			// Type reference object with $ref
			if ref, hasRef := typeMap["$ref"]; hasRef {
				ctx.validateRef(ref, fmt.Sprintf("%s/type[%d]", path, i))
			} else {
				ctx.addError(fmt.Sprintf("%s/type[%d]", path, i), "Union type object must have $ref", SchemaTypeObjectMissingRef)
			}
		} else {
			ctx.addError(fmt.Sprintf("%s/type[%d]", path, i), "Union type elements must be strings or $ref objects", SchemaKeywordInvalidType)
		}
	}
}

func (ctx *schemaValidationContext) validateObjectType(schema map[string]interface{}, path string) {
	// properties validation
	if props, ok := schema["properties"]; ok {
		propsMap, isMap := props.(map[string]interface{})
		if !isMap {
			ctx.addError(path+"/properties", "properties must be an object", SchemaPropertiesNotObject)
		} else if len(propsMap) == 0 {
			if _, hasExtends := schema["$extends"]; !hasExtends {
				ctx.addError(path+"/properties", "properties must have at least one entry", SchemaKeywordEmpty)
			}
		} else {
			for propName, propSchema := range propsMap {
				propMap, isPropMap := propSchema.(map[string]interface{})
				if !isPropMap {
					ctx.addError(path+"/properties/"+propName, "Property schema must be an object", SchemaInvalidType)
				} else {
					ctx.validateTypeDefinition(propMap, path+"/properties/"+propName)
				}
			}
		}
	}

	// required validation
	if req, ok := schema["required"]; ok {
		reqArr, isArr := req.([]interface{})
		if !isArr {
			ctx.addError(path+"/required", "required must be an array", SchemaRequiredNotArray)
		} else {
			propsMap, _ := schema["properties"].(map[string]interface{})
			for i, r := range reqArr {
				rStr, isStr := r.(string)
				if !isStr {
					ctx.addError(fmt.Sprintf("%s/required[%d]", path, i), "required elements must be strings", SchemaRequiredItemNotString)
				} else if propsMap != nil {
					if _, propExists := propsMap[rStr]; !propExists {
						if _, hasExtends := schema["$extends"]; !hasExtends {
							ctx.addError(fmt.Sprintf("%s/required[%d]", path, i), fmt.Sprintf("Required property '%s' not found in properties", rStr), SchemaRequiredPropertyNotDefined)
						}
					}
				}
			}
		}
	}
}

func (ctx *schemaValidationContext) validateArrayType(schema map[string]interface{}, path string) {
	items, hasItems := schema["items"]
	if !hasItems {
		ctx.addError(path, "Array type must have 'items' property", SchemaArrayMissingItems)
		return
	}

	itemsMap, isMap := items.(map[string]interface{})
	if !isMap {
		ctx.addError(path+"/items", "items must be an object", SchemaKeywordInvalidType)
	} else {
		ctx.validateTypeDefinition(itemsMap, path+"/items")
	}

	ctx.validateArrayConstraints(schema, path)
}

func (ctx *schemaValidationContext) validateMapType(schema map[string]interface{}, path string) {
	values, hasValues := schema["values"]
	if !hasValues {
		ctx.addError(path, "Map type must have 'values' property", SchemaMapMissingValues)
		return
	}

	valuesMap, isMap := values.(map[string]interface{})
	if !isMap {
		ctx.addError(path+"/values", "values must be an object", SchemaKeywordInvalidType)
	} else {
		ctx.validateTypeDefinition(valuesMap, path+"/values")
	}
}

func (ctx *schemaValidationContext) validateTupleType(schema map[string]interface{}, path string) {
	tuple, hasTuple := schema["tuple"]
	if !hasTuple {
		ctx.addError(path, "Tuple type must have 'tuple' property defining element order", SchemaTupleMissingDefinition)
		return
	}

	tupleArr, isArr := tuple.([]interface{})
	if !isArr {
		ctx.addError(path+"/tuple", "tuple must be an array", SchemaTupleOrderNotArray)
		return
	}

	propsMap, _ := schema["properties"].(map[string]interface{})
	for i, elem := range tupleArr {
		name, isStr := elem.(string)
		if !isStr {
			ctx.addError(fmt.Sprintf("%s/tuple[%d]", path, i), "tuple elements must be strings", SchemaKeywordInvalidType)
		} else if propsMap != nil {
			if _, exists := propsMap[name]; !exists {
				ctx.addError(fmt.Sprintf("%s/tuple[%d]", path, i), fmt.Sprintf("Tuple element '%s' not found in properties", name), SchemaRequiredPropertyNotDefined)
			}
		}
	}
}

func (ctx *schemaValidationContext) validateChoiceType(schema map[string]interface{}, path string) {
	choices, hasChoices := schema["choices"]
	if !hasChoices {
		ctx.addError(path, "Choice type must have 'choices' property", SchemaChoiceMissingChoices)
		return
	}

	choicesMap, isMap := choices.(map[string]interface{})
	if !isMap {
		ctx.addError(path+"/choices", "choices must be an object", SchemaChoicesNotObject)
	} else {
		for choiceName, choiceSchema := range choicesMap {
			choiceMap, isChoiceMap := choiceSchema.(map[string]interface{})
			if !isChoiceMap {
				ctx.addError(path+"/choices/"+choiceName, "Choice schema must be an object", SchemaInvalidType)
			} else {
				ctx.validateTypeDefinition(choiceMap, path+"/choices/"+choiceName)
			}
		}
	}
}

func (ctx *schemaValidationContext) validatePrimitiveConstraints(typeStr string, schema map[string]interface{}, path string) {
	// Validate enum
	if enumVal, ok := schema["enum"]; ok {
		enumArr, isArr := enumVal.([]interface{})
		if !isArr {
			ctx.addError(path+"/enum", "enum must be an array", SchemaEnumNotArray)
		} else if len(enumArr) == 0 {
			ctx.addError(path+"/enum", "enum must have at least one value", SchemaEnumEmpty)
		} else {
			// Check for duplicates
			seen := make(map[string]bool)
			for i := 0; i < len(enumArr); i++ {
				serialized, _ := json.Marshal(enumArr[i])
				if seen[string(serialized)] {
					ctx.addError(path+"/enum", "enum values must be unique", SchemaEnumDuplicates)
					break
				}
				seen[string(serialized)] = true
			}
		}
	}

	// Validate constraint type matching
	ctx.validateConstraintTypeMatch(typeStr, schema, path)

	// Validate string constraints
	if typeStr == "string" {
		ctx.validateStringConstraints(schema, path)
	}

	// Validate numeric constraints
	if isNumericType(typeStr) {
		ctx.validateNumericConstraints(schema, path)
	}
}

func (ctx *schemaValidationContext) validateStringConstraints(schema map[string]interface{}, path string) {
	if minLen, ok := schema["minLength"]; ok {
		minLenNum, isNum := minLen.(float64)
		if !isNum || minLenNum != float64(int(minLenNum)) {
			ctx.addError(path+"/minLength", "minLength must be an integer", SchemaIntegerConstraintInvalid)
		} else if minLenNum < 0 {
			ctx.addError(path+"/minLength", "minLength must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	if maxLen, ok := schema["maxLength"]; ok {
		maxLenNum, isNum := maxLen.(float64)
		if !isNum || maxLenNum != float64(int(maxLenNum)) {
			ctx.addError(path+"/maxLength", "maxLength must be an integer", SchemaIntegerConstraintInvalid)
		} else if maxLenNum < 0 {
			ctx.addError(path+"/maxLength", "maxLength must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	// Check minLength <= maxLength
	if minLen, hasMin := schema["minLength"]; hasMin {
		if maxLen, hasMax := schema["maxLength"]; hasMax {
			minNum, minOk := minLen.(float64)
			maxNum, maxOk := maxLen.(float64)
			if minOk && maxOk && minNum > maxNum {
				ctx.addError(path, "minLength cannot exceed maxLength", SchemaMinGreaterThanMax)
			}
		}
	}

	if pattern, ok := schema["pattern"]; ok {
		patternStr, isStr := pattern.(string)
		if !isStr {
			ctx.addError(path+"/pattern", "pattern must be a string", SchemaPatternNotString)
		} else {
			if _, err := regexp.Compile(patternStr); err != nil {
				ctx.addError(path+"/pattern", fmt.Sprintf("Invalid regular expression: %s", patternStr), SchemaPatternInvalid)
			}
		}
	}
}

func (ctx *schemaValidationContext) validateNumericConstraints(schema map[string]interface{}, path string) {
	if min, ok := schema["minimum"]; ok {
		if _, isNum := min.(float64); !isNum {
			ctx.addError(path+"/minimum", "minimum must be a number", SchemaNumberConstraintInvalid)
		}
	}

	if max, ok := schema["maximum"]; ok {
		if _, isNum := max.(float64); !isNum {
			ctx.addError(path+"/maximum", "maximum must be a number", SchemaNumberConstraintInvalid)
		}
	}

	// Check minimum <= maximum
	if min, hasMin := schema["minimum"]; hasMin {
		if max, hasMax := schema["maximum"]; hasMax {
			minNum, minOk := min.(float64)
			maxNum, maxOk := max.(float64)
			if minOk && maxOk && minNum > maxNum {
				ctx.addError(path, "minimum cannot exceed maximum", SchemaMinGreaterThanMax)
			}
		}
	}

	if multipleOf, ok := schema["multipleOf"]; ok {
		multipleOfNum, isNum := multipleOf.(float64)
		if !isNum {
			ctx.addError(path+"/multipleOf", "multipleOf must be a number", SchemaNumberConstraintInvalid)
		} else if multipleOfNum <= 0 {
			ctx.addError(path+"/multipleOf", "multipleOf must be greater than 0", SchemaPositiveNumberConstraintInvalid)
		}
	}
}

func (ctx *schemaValidationContext) validateArrayConstraints(schema map[string]interface{}, path string) {
	if minItems, ok := schema["minItems"]; ok {
		minItemsNum, isNum := minItems.(float64)
		if !isNum || minItemsNum != float64(int(minItemsNum)) {
			ctx.addError(path+"/minItems", "minItems must be an integer", SchemaIntegerConstraintInvalid)
		} else if minItemsNum < 0 {
			ctx.addError(path+"/minItems", "minItems must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	if maxItems, ok := schema["maxItems"]; ok {
		maxItemsNum, isNum := maxItems.(float64)
		if !isNum || maxItemsNum != float64(int(maxItemsNum)) {
			ctx.addError(path+"/maxItems", "maxItems must be an integer", SchemaIntegerConstraintInvalid)
		} else if maxItemsNum < 0 {
			ctx.addError(path+"/maxItems", "maxItems must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	// Check minItems <= maxItems
	if minItems, hasMin := schema["minItems"]; hasMin {
		if maxItems, hasMax := schema["maxItems"]; hasMax {
			minNum, minOk := minItems.(float64)
			maxNum, maxOk := maxItems.(float64)
			if minOk && maxOk && minNum > maxNum {
				ctx.addError(path, "minItems cannot exceed maxItems", SchemaMinGreaterThanMax)
			}
		}
	}
}

func (ctx *schemaValidationContext) validateConditionalKeywords(schema map[string]interface{}, path string) {
	// Validate allOf
	if allOf, ok := schema["allOf"]; ok {
		allOfArr, isArr := allOf.([]interface{})
		if !isArr {
			ctx.addError(path+"/allOf", "allOf must be an array", SchemaCompositionNotArray)
		} else {
			for i, item := range allOfArr {
				if itemMap, isMap := item.(map[string]interface{}); isMap {
					ctx.validateTypeDefinition(itemMap, fmt.Sprintf("%s/allOf[%d]", path, i))
				}
			}
		}
	}

	// Validate anyOf
	if anyOf, ok := schema["anyOf"]; ok {
		anyOfArr, isArr := anyOf.([]interface{})
		if !isArr {
			ctx.addError(path+"/anyOf", "anyOf must be an array", SchemaCompositionNotArray)
		} else {
			for i, item := range anyOfArr {
				if itemMap, isMap := item.(map[string]interface{}); isMap {
					ctx.validateTypeDefinition(itemMap, fmt.Sprintf("%s/anyOf[%d]", path, i))
				}
			}
		}
	}

	// Validate oneOf
	if oneOf, ok := schema["oneOf"]; ok {
		oneOfArr, isArr := oneOf.([]interface{})
		if !isArr {
			ctx.addError(path+"/oneOf", "oneOf must be an array", SchemaCompositionNotArray)
		} else {
			for i, item := range oneOfArr {
				if itemMap, isMap := item.(map[string]interface{}); isMap {
					ctx.validateTypeDefinition(itemMap, fmt.Sprintf("%s/oneOf[%d]", path, i))
				}
			}
		}
	}

	// Validate not
	if not, ok := schema["not"]; ok {
		notMap, isMap := not.(map[string]interface{})
		if !isMap {
			ctx.addError(path+"/not", "not must be an object", SchemaKeywordInvalidType)
		} else {
			ctx.validateTypeDefinition(notMap, path+"/not")
		}
	}

	// Validate if/then/else
	if ifSchema, ok := schema["if"]; ok {
		ifMap, isMap := ifSchema.(map[string]interface{})
		if !isMap {
			ctx.addError(path+"/if", "if must be an object", SchemaKeywordInvalidType)
		} else {
			ctx.validateTypeDefinition(ifMap, path+"/if")
		}
	}
	if thenSchema, ok := schema["then"]; ok {
		thenMap, isMap := thenSchema.(map[string]interface{})
		if !isMap {
			ctx.addError(path+"/then", "then must be an object", SchemaKeywordInvalidType)
		} else {
			ctx.validateTypeDefinition(thenMap, path+"/then")
		}
	}
	if elseSchema, ok := schema["else"]; ok {
		elseMap, isMap := elseSchema.(map[string]interface{})
		if !isMap {
			ctx.addError(path+"/else", "else must be an object", SchemaKeywordInvalidType)
		} else {
			ctx.validateTypeDefinition(elseMap, path+"/else")
		}
	}
}

func (ctx *schemaValidationContext) validateConstraintTypeMatch(typeStr string, schema map[string]interface{}, path string) {
	stringOnlyConstraints := []string{"minLength", "maxLength", "pattern"}
	numericOnlyConstraints := []string{"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"}

	// Check string constraints on non-string types
	for _, constraint := range stringOnlyConstraints {
		if _, ok := schema[constraint]; ok && typeStr != "string" {
			ctx.addError(path+"/"+constraint, fmt.Sprintf("%s constraint is only valid for string type, not %s", constraint, typeStr), SchemaConstraintInvalidForType)
		}
	}

	// Check numeric constraints on non-numeric types
	for _, constraint := range numericOnlyConstraints {
		if _, ok := schema[constraint]; ok && !isNumericType(typeStr) {
			ctx.addError(path+"/"+constraint, fmt.Sprintf("%s constraint is only valid for numeric types, not %s", constraint, typeStr), SchemaConstraintInvalidForType)
		}
	}
}

func (ctx *schemaValidationContext) validateExtends(extendsVal interface{}, path string) {
	var refs []string
	var refPaths []string

	switch ev := extendsVal.(type) {
	case string:
		refs = append(refs, ev)
		refPaths = append(refPaths, path)
	case []interface{}:
		for i, item := range ev {
			if refStr, ok := item.(string); ok {
				refs = append(refs, refStr)
				refPaths = append(refPaths, fmt.Sprintf("%s[%d]", path, i))
			} else {
				ctx.addError(fmt.Sprintf("%s[%d]", path, i), "$extends array items must be strings", SchemaKeywordInvalidType)
			}
		}
	default:
		ctx.addError(path, "$extends must be a string or array of strings", SchemaKeywordInvalidType)
		return
	}

	for i, ref := range refs {
		refPath := refPaths[i]

		if !strings.HasPrefix(ref, "#/") {
			continue // External references handled elsewhere
		}

		// Check for circular $extends
		if ctx.seenExtends[ref] {
			ctx.addError(refPath, fmt.Sprintf("Circular $extends reference detected: %s", ref), SchemaExtendsCircular)
			continue
		}

		ctx.seenExtends[ref] = true
		resolved := ctx.resolveRef(ref)
		if resolved == nil {
			ctx.addError(refPath, fmt.Sprintf("$extends reference '%s' not found", ref), SchemaExtendsNotFound)
		} else if extendsVal, hasExtends := resolved["$extends"]; hasExtends {
			// Recursively validate the extended schema's $extends
			ctx.validateExtends(extendsVal, refPath)
		}
		delete(ctx.seenExtends, ref)
	}
}

func (ctx *schemaValidationContext) validateRef(ref interface{}, path string) {
	refStr, ok := ref.(string)
	if !ok {
		ctx.addError(path, "$ref must be a string", SchemaKeywordInvalidType)
		return
	}

	if strings.HasPrefix(refStr, "#/") {
		// Check for circular reference
		if ctx.seenRefs[refStr] {
			// Circular references to properly defined types are valid in JSON Structure
			// (e.g., ObjectType -> Property -> Type -> ObjectType in metaschemas)
			// However, a direct self-reference with no content is invalid
			resolved := ctx.resolveRef(refStr)
			if len(resolved) == 1 {
				// Check for bare $ref: { "$ref": "..." }
				if _, hasRef := resolved["$ref"]; hasRef {
					// This is a definition that's only a $ref - direct circular with no content
					ctx.addError(path, fmt.Sprintf("Circular reference detected: %s", refStr), SchemaRefCircular)
				}
				// Check for type-wrapped ref only: { "type": { "$ref": "..." } }
				if typeVal, hasType := resolved["type"]; hasType {
					if typeObj, isMap := typeVal.(map[string]interface{}); isMap {
						if len(typeObj) == 1 {
							if _, hasRef := typeObj["$ref"]; hasRef {
								ctx.addError(path, fmt.Sprintf("Circular reference detected: %s", refStr), SchemaRefCircular)
							}
						}
					}
				}
			}
			// For other circular refs, just stop recursing to prevent infinite loops
			return
		}

		ctx.seenRefs[refStr] = true
		resolved := ctx.resolveRef(refStr)
		if resolved == nil {
			ctx.addError(path, fmt.Sprintf("$ref '%s' not found", refStr), SchemaRefNotFound)
		} else {
			ctx.validateTypeDefinition(resolved, path)
		}
		delete(ctx.seenRefs, refStr)
	}
}

func (ctx *schemaValidationContext) resolveRef(ref string) map[string]interface{} {
	if ctx.schema == nil || !strings.HasPrefix(ref, "#/") {
		return nil
	}

	parts := strings.Split(ref[2:], "/")
	var current interface{} = ctx.schema

	for _, part := range parts {
		currentMap, ok := current.(map[string]interface{})
		if !ok {
			return nil
		}
		// Unescape JSON Pointer
		unescaped := strings.ReplaceAll(part, "~1", "/")
		unescaped = strings.ReplaceAll(unescaped, "~0", "~")
		if val, exists := currentMap[unescaped]; exists {
			current = val
		} else {
			return nil
		}
	}

	if result, ok := current.(map[string]interface{}); ok {
		return result
	}
	return nil
}

func (ctx *schemaValidationContext) addError(path, message string, codes ...string) {
	code := "SCHEMA_ERROR"
	if len(codes) > 0 {
		code = codes[0]
	}
	
	// Get source location if locator is available
	var location JsonLocation
	if ctx.sourceLocator != nil {
		location = ctx.sourceLocator.GetLocation(path)
	}
	
	ctx.errors = append(ctx.errors, ValidationError{
		Code:     code,
		Path:     path,
		Message:  message,
		Severity: SeverityError,
		Location: location,
	})
}

func (ctx *schemaValidationContext) addWarning(path, message, code string) {
	location := UnknownLocation()
	if ctx.sourceLocator != nil {
		location = ctx.sourceLocator.GetLocation(path)
	}
	ctx.warnings = append(ctx.warnings, ValidationError{
		Code:     code,
		Path:     path,
		Message:  message,
		Severity: SeverityWarning,
		Location: location,
	})
}

func (ctx *schemaValidationContext) result() ValidationResult {
	return ValidationResult{
		IsValid:  len(ctx.errors) == 0,
		Errors:   append([]ValidationError{}, ctx.errors...),
		Warnings: append([]ValidationError{}, ctx.warnings...),
	}
}

// deepCopySchema creates a deep copy of a schema.
// deepCopySchema creates a deep copy of a schema.
func deepCopySchema(schema interface{}) interface{} {
	data, err := json.Marshal(schema)
	if err != nil {
		return schema
	}
	var copied interface{}
	if err := json.Unmarshal(data, &copied); err != nil {
		return schema
	}
	return copied
}

// processImportsInExternalSchema processes $import and $importdefs in an external schema.
func processImportsInExternalSchema(obj map[string]interface{}, externalSchemas map[string]interface{}) {
	importKeys := []string{"$import", "$importdefs"}

	for _, key := range importKeys {
		if uri, ok := obj[key].(string); ok {
			external, exists := externalSchemas[uri]
			if !exists {
				continue
			}

			externalMap, ok := external.(map[string]interface{})
			if !ok {
				continue
			}

			importedDefs := make(map[string]interface{})

			if key == "$import" {
				// Import root type if available
				if typeName, ok := externalMap["name"].(string); ok {
					if _, hasType := externalMap["type"]; hasType {
						importedDefs[typeName] = externalMap
					}
				}
				// Also import definitions
				if defs, ok := externalMap["definitions"].(map[string]interface{}); ok {
					for k, def := range defs {
						importedDefs[k] = def
					}
				}
			} else {
				// $importdefs - only import definitions
				if defs, ok := externalMap["definitions"].(map[string]interface{}); ok {
					for k, def := range defs {
						importedDefs[k] = def
					}
				}
			}

			// Merge into definitions at root level
			if obj["definitions"] == nil {
				obj["definitions"] = make(map[string]interface{})
			}
			mergeTarget, _ := obj["definitions"].(map[string]interface{})

			// Deep copy and rewrite refs
			for k, def := range importedDefs {
				if _, exists := mergeTarget[k]; !exists {
					copied := deepCopySchema(def)
					if copiedMap, ok := copied.(map[string]interface{}); ok {
						rewriteRefs(copiedMap, "#/definitions")
					}
					mergeTarget[k] = copied
				}
			}

			delete(obj, key)
		}
	}
}

// processImports processes $import and $importdefs keywords recursively.
func (ctx *schemaValidationContext) processImports(obj map[string]interface{}, path string) {
	importKeys := []string{"$import", "$importdefs"}

	for _, key := range importKeys {
		if uri, ok := obj[key].(string); ok {
			external, exists := ctx.externalSchemas[uri]
			if !exists {
				ctx.addError(path+"/"+key, fmt.Sprintf("Unable to resolve import URI: %s", uri))
				continue
			}

			externalMap, ok := external.(map[string]interface{})
			if !ok {
				ctx.addError(path+"/"+key, fmt.Sprintf("External schema is not an object: %s", uri))
				continue
			}

			importedDefs := make(map[string]interface{})

			if key == "$import" {
				// Import root type if available
				if typeName, ok := externalMap["name"].(string); ok {
					if _, hasType := externalMap["type"]; hasType {
						importedDefs[typeName] = externalMap
					}
				}
				// Also import definitions
				if defs, ok := externalMap["definitions"].(map[string]interface{}); ok {
					for k, def := range defs {
						importedDefs[k] = def
					}
				}
			} else {
				// $importdefs - only import definitions
				if defs, ok := externalMap["definitions"].(map[string]interface{}); ok {
					for k, def := range defs {
						importedDefs[k] = def
					}
				}
			}

			// Determine where to merge
			isRootLevel := path == "#"
			targetPath := "#/definitions"
			if !isRootLevel {
				targetPath = path
			}

			if isRootLevel {
				if obj["definitions"] == nil {
					obj["definitions"] = make(map[string]interface{})
				}
			}

			var mergeTarget map[string]interface{}
			if isRootLevel {
				mergeTarget, _ = obj["definitions"].(map[string]interface{})
			} else {
				mergeTarget = obj
			}

			// Deep copy and rewrite refs
			for k, def := range importedDefs {
				if _, exists := mergeTarget[k]; !exists {
					copied := deepCopySchema(def)
					if copiedMap, ok := copied.(map[string]interface{}); ok {
						rewriteRefs(copiedMap, targetPath)
					}
					mergeTarget[k] = copied
				}
			}

			delete(obj, key)
		}
	}

	// Recurse into child objects (but not into 'properties')
	for key, value := range obj {
		if key == "properties" {
			continue
		}
		if childMap, ok := value.(map[string]interface{}); ok {
			ctx.processImports(childMap, path+"/"+key)
		} else if childArray, ok := value.([]interface{}); ok {
			for idx, item := range childArray {
				if itemMap, ok := item.(map[string]interface{}); ok {
					ctx.processImports(itemMap, fmt.Sprintf("%s/%s[%d]", path, key, idx))
				}
			}
		}
	}
}

// rewriteRefs rewrites $ref pointers in imported content to point to their new location.
// rewriteRefs rewrites $ref pointers in imported content to point to their new location.
func rewriteRefs(obj map[string]interface{}, targetPath string) {
	for key, value := range obj {
		if (key == "$ref" || key == "$extends") {
			if refStr, ok := value.(string); ok && strings.HasPrefix(refStr, "#") {
				// Rewrite the reference
				refParts := strings.Split(strings.TrimPrefix(strings.TrimPrefix(refStr, "#"), "/"), "/")
				if len(refParts) > 0 && refParts[0] != "" {
					if refParts[0] == "definitions" && len(refParts) > 1 {
						remaining := strings.Join(refParts[1:], "/")
						obj[key] = targetPath + "/" + remaining
					} else {
						remaining := strings.Join(refParts, "/")
						obj[key] = targetPath + "/" + remaining
					}
				}
			}
		} else if childMap, ok := value.(map[string]interface{}); ok {
			rewriteRefs(childMap, targetPath)
		} else if childArray, ok := value.([]interface{}); ok {
			for _, item := range childArray {
				if itemMap, ok := item.(map[string]interface{}); ok {
					rewriteRefs(itemMap, targetPath)
				}
			}
		}
	}
}
