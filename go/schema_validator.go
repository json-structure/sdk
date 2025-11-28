// Package jsonstructure provides validators for JSON Structure schemas and instances.
package jsonstructure

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// SchemaValidator validates JSON Structure schema documents.
type SchemaValidator struct {
	options       SchemaValidatorOptions
	errors        []ValidationError
	schema        map[string]interface{}
	seenRefs      map[string]bool
	sourceLocator *JsonSourceLocator
}

// NewSchemaValidator creates a new SchemaValidator with the given options.
func NewSchemaValidator(options *SchemaValidatorOptions) *SchemaValidator {
	opts := SchemaValidatorOptions{}
	if options != nil {
		opts = *options
	}
	return &SchemaValidator{
		options:       opts,
		errors:        []ValidationError{},
		seenRefs:      make(map[string]bool),
		sourceLocator: nil,
	}
}

// Validate validates a JSON Structure schema document.
func (v *SchemaValidator) Validate(schema interface{}) ValidationResult {
	v.errors = []ValidationError{}
	v.seenRefs = make(map[string]bool)

	schemaMap, ok := schema.(map[string]interface{})
	if !ok {
		v.addError("#", "Schema must be an object", SchemaInvalidType)
		return v.result()
	}

	v.schema = schemaMap
	v.validateSchemaDocument(schemaMap, "#")

	return v.result()
}

// ValidateJSON validates a JSON Structure schema from JSON bytes.
func (v *SchemaValidator) ValidateJSON(jsonData []byte) (ValidationResult, error) {
	var schema interface{}
	if err := json.Unmarshal(jsonData, &schema); err != nil {
		return ValidationResult{IsValid: false}, err
	}
	// Create source locator for the schema JSON
	v.sourceLocator = NewJsonSourceLocator(string(jsonData))
	return v.Validate(schema), nil
}

func (v *SchemaValidator) validateSchemaDocument(schema map[string]interface{}, path string) {
	// Validate definitions if present
	if defs, ok := schema["definitions"]; ok {
		v.validateDefinitions(defs, path+"/definitions")
	}
	if defs, ok := schema["$defs"]; ok {
		v.validateDefinitions(defs, path+"/$defs")
	}

	// If there's a $root, validate that the referenced type exists
	if root, ok := schema["$root"]; ok {
		rootStr, isStr := root.(string)
		if !isStr {
			v.addError(path+"/$root", "$root must be a string", SchemaKeywordInvalidType)
		} else if strings.HasPrefix(rootStr, "#/") {
			if v.resolveRef(rootStr) == nil {
				v.addError(path+"/$root", fmt.Sprintf("$root reference '%s' not found", rootStr), SchemaRefNotFound)
			}
		}
		return
	}

	// Validate the root type if present
	if _, ok := schema["type"]; ok {
		v.validateTypeDefinition(schema, path)
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
		_, hasDollarDefs := schema["$defs"]
		if !hasOnlyMeta || (!hasDefs && !hasDollarDefs) {
			v.addError(path, "Schema must have a 'type' property or '$root' reference", SchemaMissingType)
		}
	}

	// Validate conditional keywords at root level
	v.validateConditionalKeywords(schema, path)
}

func (v *SchemaValidator) validateDefinitions(defs interface{}, path string) {
	defsMap, ok := defs.(map[string]interface{})
	if !ok {
		v.addError(path, "definitions must be an object", SchemaPropertiesNotObject)
		return
	}

	for name, def := range defsMap {
		defMap, isMap := def.(map[string]interface{})
		if !isMap {
			v.addError(path+"/"+name, "Definition must be an object", SchemaInvalidType)
			continue
		}
		v.validateTypeDefinition(defMap, path+"/"+name)
	}
}

func (v *SchemaValidator) validateTypeDefinition(schema map[string]interface{}, path string) {
	// Handle $ref
	if ref, ok := schema["$ref"]; ok {
		v.validateRef(ref, path)
		return
	}

	typeVal, hasType := schema["type"]

	// Type is required unless it's a conditional-only schema or has $ref
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
				v.addError(path, "Schema must have a 'type' property", SchemaMissingType)
			}
		}
		return
	}

	// Type can be a string, array (union), or object with $ref
	switch t := typeVal.(type) {
	case string:
		v.validateSingleType(t, schema, path)
	case []interface{}:
		v.validateUnionType(t, schema, path)
	case map[string]interface{}:
		if ref, ok := t["$ref"]; ok {
			v.validateRef(ref, path+"/type")
		} else {
			v.addError(path+"/type", "type object must have $ref", SchemaTypeObjectMissingRef)
		}
	default:
		v.addError(path+"/type", "type must be a string, array, or object with $ref", SchemaKeywordInvalidType)
	}
}

func (v *SchemaValidator) validateSingleType(typeStr string, schema map[string]interface{}, path string) {
	if !isValidType(typeStr) {
		v.addError(path+"/type", fmt.Sprintf("Unknown type '%s'", typeStr), SchemaTypeInvalid)
		return
	}

	// Validate type-specific constraints
	switch typeStr {
	case "object":
		v.validateObjectType(schema, path)
	case "array", "set":
		v.validateArrayType(schema, path)
	case "map":
		v.validateMapType(schema, path)
	case "tuple":
		v.validateTupleType(schema, path)
	case "choice":
		v.validateChoiceType(schema, path)
	default:
		v.validatePrimitiveConstraints(typeStr, schema, path)
	}
}

func (v *SchemaValidator) validateUnionType(types []interface{}, _ map[string]interface{}, path string) {
	if len(types) == 0 {
		v.addError(path+"/type", "Union type array cannot be empty", SchemaTypeArrayEmpty)
		return
	}

	for i, t := range types {
		typeStr, ok := t.(string)
		if !ok {
			v.addError(fmt.Sprintf("%s/type[%d]", path, i), "Union type elements must be strings", SchemaKeywordInvalidType)
		} else if !isValidType(typeStr) {
			v.addError(fmt.Sprintf("%s/type[%d]", path, i), fmt.Sprintf("Unknown type '%s'", typeStr), SchemaTypeInvalid)
		}
	}
}

func (v *SchemaValidator) validateObjectType(schema map[string]interface{}, path string) {
	// properties validation
	if props, ok := schema["properties"]; ok {
		propsMap, isMap := props.(map[string]interface{})
		if !isMap {
			v.addError(path+"/properties", "properties must be an object", SchemaPropertiesNotObject)
		} else if len(propsMap) == 0 {
			if _, hasExtends := schema["$extends"]; !hasExtends {
				v.addError(path+"/properties", "properties must have at least one entry", SchemaKeywordEmpty)
			}
		} else {
			for propName, propSchema := range propsMap {
				propMap, isPropMap := propSchema.(map[string]interface{})
				if !isPropMap {
					v.addError(path+"/properties/"+propName, "Property schema must be an object", SchemaInvalidType)
				} else {
					v.validateTypeDefinition(propMap, path+"/properties/"+propName)
				}
			}
		}
	}

	// required validation
	if req, ok := schema["required"]; ok {
		reqArr, isArr := req.([]interface{})
		if !isArr {
			v.addError(path+"/required", "required must be an array", SchemaRequiredNotArray)
		} else {
			propsMap, _ := schema["properties"].(map[string]interface{})
			for i, r := range reqArr {
				rStr, isStr := r.(string)
				if !isStr {
					v.addError(fmt.Sprintf("%s/required[%d]", path, i), "required elements must be strings", SchemaRequiredItemNotString)
				} else if propsMap != nil {
					if _, propExists := propsMap[rStr]; !propExists {
						if _, hasExtends := schema["$extends"]; !hasExtends {
							v.addError(fmt.Sprintf("%s/required[%d]", path, i), fmt.Sprintf("Required property '%s' not found in properties", rStr), SchemaRequiredPropertyNotDefined)
						}
					}
				}
			}
		}
	}
}

func (v *SchemaValidator) validateArrayType(schema map[string]interface{}, path string) {
	items, hasItems := schema["items"]
	if !hasItems {
		v.addError(path, "Array type must have 'items' property", SchemaArrayMissingItems)
		return
	}

	itemsMap, isMap := items.(map[string]interface{})
	if !isMap {
		v.addError(path+"/items", "items must be an object", SchemaKeywordInvalidType)
	} else {
		v.validateTypeDefinition(itemsMap, path+"/items")
	}

	v.validateArrayConstraints(schema, path)
}

func (v *SchemaValidator) validateMapType(schema map[string]interface{}, path string) {
	values, hasValues := schema["values"]
	if !hasValues {
		v.addError(path, "Map type must have 'values' property", SchemaMapMissingValues)
		return
	}

	valuesMap, isMap := values.(map[string]interface{})
	if !isMap {
		v.addError(path+"/values", "values must be an object", SchemaKeywordInvalidType)
	} else {
		v.validateTypeDefinition(valuesMap, path+"/values")
	}
}

func (v *SchemaValidator) validateTupleType(schema map[string]interface{}, path string) {
	tuple, hasTuple := schema["tuple"]
	if !hasTuple {
		v.addError(path, "Tuple type must have 'tuple' property defining element order", SchemaTupleMissingPrefixItems)
		return
	}

	tupleArr, isArr := tuple.([]interface{})
	if !isArr {
		v.addError(path+"/tuple", "tuple must be an array", SchemaPrefixItemsNotArray)
		return
	}

	propsMap, _ := schema["properties"].(map[string]interface{})
	for i, elem := range tupleArr {
		name, isStr := elem.(string)
		if !isStr {
			v.addError(fmt.Sprintf("%s/tuple[%d]", path, i), "tuple elements must be strings", SchemaKeywordInvalidType)
		} else if propsMap != nil {
			if _, exists := propsMap[name]; !exists {
				v.addError(fmt.Sprintf("%s/tuple[%d]", path, i), fmt.Sprintf("Tuple element '%s' not found in properties", name), SchemaRequiredPropertyNotDefined)
			}
		}
	}
}

func (v *SchemaValidator) validateChoiceType(schema map[string]interface{}, path string) {
	choices, hasChoices := schema["choices"]
	if !hasChoices {
		v.addError(path, "Choice type must have 'choices' property", SchemaChoiceMissingOptions)
		return
	}

	choicesMap, isMap := choices.(map[string]interface{})
	if !isMap {
		v.addError(path+"/choices", "choices must be an object", SchemaChoicesNotObject)
	} else {
		for choiceName, choiceSchema := range choicesMap {
			choiceMap, isChoiceMap := choiceSchema.(map[string]interface{})
			if !isChoiceMap {
				v.addError(path+"/choices/"+choiceName, "Choice schema must be an object", SchemaInvalidType)
			} else {
				v.validateTypeDefinition(choiceMap, path+"/choices/"+choiceName)
			}
		}
	}
}

func (v *SchemaValidator) validatePrimitiveConstraints(typeStr string, schema map[string]interface{}, path string) {
	// Validate enum
	if enumVal, ok := schema["enum"]; ok {
		enumArr, isArr := enumVal.([]interface{})
		if !isArr {
			v.addError(path+"/enum", "enum must be an array", SchemaEnumNotArray)
		} else if len(enumArr) == 0 {
			v.addError(path+"/enum", "enum must have at least one value", SchemaEnumEmpty)
		} else {
			// Check for duplicates
			seen := make(map[string]bool)
			for i := 0; i < len(enumArr); i++ {
				serialized, _ := json.Marshal(enumArr[i])
				if seen[string(serialized)] {
					v.addError(path+"/enum", "enum values must be unique", SchemaEnumDuplicates)
					break
				}
				seen[string(serialized)] = true
			}
		}
	}

	// Validate constraint type matching
	v.validateConstraintTypeMatch(typeStr, schema, path)

	// Validate string constraints
	if typeStr == "string" {
		v.validateStringConstraints(schema, path)
	}

	// Validate numeric constraints
	if isNumericType(typeStr) {
		v.validateNumericConstraints(schema, path)
	}
}

func (v *SchemaValidator) validateStringConstraints(schema map[string]interface{}, path string) {
	if minLen, ok := schema["minLength"]; ok {
		minLenNum, isNum := minLen.(float64)
		if !isNum || minLenNum != float64(int(minLenNum)) {
			v.addError(path+"/minLength", "minLength must be an integer", SchemaIntegerConstraintInvalid)
		} else if minLenNum < 0 {
			v.addError(path+"/minLength", "minLength must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	if maxLen, ok := schema["maxLength"]; ok {
		maxLenNum, isNum := maxLen.(float64)
		if !isNum || maxLenNum != float64(int(maxLenNum)) {
			v.addError(path+"/maxLength", "maxLength must be an integer", SchemaIntegerConstraintInvalid)
		} else if maxLenNum < 0 {
			v.addError(path+"/maxLength", "maxLength must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	// Check minLength <= maxLength
	if minLen, hasMin := schema["minLength"]; hasMin {
		if maxLen, hasMax := schema["maxLength"]; hasMax {
			minNum, minOk := minLen.(float64)
			maxNum, maxOk := maxLen.(float64)
			if minOk && maxOk && minNum > maxNum {
				v.addError(path, "minLength cannot exceed maxLength", SchemaMinGreaterThanMax)
			}
		}
	}

	if pattern, ok := schema["pattern"]; ok {
		patternStr, isStr := pattern.(string)
		if !isStr {
			v.addError(path+"/pattern", "pattern must be a string", SchemaPatternNotString)
		} else {
			if _, err := regexp.Compile(patternStr); err != nil {
				v.addError(path+"/pattern", fmt.Sprintf("Invalid regular expression: %s", patternStr), SchemaPatternInvalid)
			}
		}
	}
}

func (v *SchemaValidator) validateNumericConstraints(schema map[string]interface{}, path string) {
	if min, ok := schema["minimum"]; ok {
		if _, isNum := min.(float64); !isNum {
			v.addError(path+"/minimum", "minimum must be a number", SchemaNumberConstraintInvalid)
		}
	}

	if max, ok := schema["maximum"]; ok {
		if _, isNum := max.(float64); !isNum {
			v.addError(path+"/maximum", "maximum must be a number", SchemaNumberConstraintInvalid)
		}
	}

	// Check minimum <= maximum
	if min, hasMin := schema["minimum"]; hasMin {
		if max, hasMax := schema["maximum"]; hasMax {
			minNum, minOk := min.(float64)
			maxNum, maxOk := max.(float64)
			if minOk && maxOk && minNum > maxNum {
				v.addError(path, "minimum cannot exceed maximum", SchemaMinGreaterThanMax)
			}
		}
	}

	if multipleOf, ok := schema["multipleOf"]; ok {
		multipleOfNum, isNum := multipleOf.(float64)
		if !isNum {
			v.addError(path+"/multipleOf", "multipleOf must be a number", SchemaNumberConstraintInvalid)
		} else if multipleOfNum <= 0 {
			v.addError(path+"/multipleOf", "multipleOf must be greater than 0", SchemaPositiveNumberConstraintInvalid)
		}
	}
}

func (v *SchemaValidator) validateArrayConstraints(schema map[string]interface{}, path string) {
	if minItems, ok := schema["minItems"]; ok {
		minItemsNum, isNum := minItems.(float64)
		if !isNum || minItemsNum != float64(int(minItemsNum)) {
			v.addError(path+"/minItems", "minItems must be an integer", SchemaIntegerConstraintInvalid)
		} else if minItemsNum < 0 {
			v.addError(path+"/minItems", "minItems must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	if maxItems, ok := schema["maxItems"]; ok {
		maxItemsNum, isNum := maxItems.(float64)
		if !isNum || maxItemsNum != float64(int(maxItemsNum)) {
			v.addError(path+"/maxItems", "maxItems must be an integer", SchemaIntegerConstraintInvalid)
		} else if maxItemsNum < 0 {
			v.addError(path+"/maxItems", "maxItems must be non-negative", SchemaIntegerConstraintInvalid)
		}
	}

	// Check minItems <= maxItems
	if minItems, hasMin := schema["minItems"]; hasMin {
		if maxItems, hasMax := schema["maxItems"]; hasMax {
			minNum, minOk := minItems.(float64)
			maxNum, maxOk := maxItems.(float64)
			if minOk && maxOk && minNum > maxNum {
				v.addError(path, "minItems cannot exceed maxItems", SchemaMinGreaterThanMax)
			}
		}
	}
}

func (v *SchemaValidator) validateConditionalKeywords(schema map[string]interface{}, path string) {
	// Validate allOf
	if allOf, ok := schema["allOf"]; ok {
		allOfArr, isArr := allOf.([]interface{})
		if !isArr {
			v.addError(path+"/allOf", "allOf must be an array", SchemaCompositionNotArray)
		} else {
			for i, item := range allOfArr {
				if itemMap, isMap := item.(map[string]interface{}); isMap {
					v.validateTypeDefinition(itemMap, fmt.Sprintf("%s/allOf[%d]", path, i))
				}
			}
		}
	}

	// Validate anyOf
	if anyOf, ok := schema["anyOf"]; ok {
		anyOfArr, isArr := anyOf.([]interface{})
		if !isArr {
			v.addError(path+"/anyOf", "anyOf must be an array", SchemaCompositionNotArray)
		} else {
			for i, item := range anyOfArr {
				if itemMap, isMap := item.(map[string]interface{}); isMap {
					v.validateTypeDefinition(itemMap, fmt.Sprintf("%s/anyOf[%d]", path, i))
				}
			}
		}
	}

	// Validate oneOf
	if oneOf, ok := schema["oneOf"]; ok {
		oneOfArr, isArr := oneOf.([]interface{})
		if !isArr {
			v.addError(path+"/oneOf", "oneOf must be an array", SchemaCompositionNotArray)
		} else {
			for i, item := range oneOfArr {
				if itemMap, isMap := item.(map[string]interface{}); isMap {
					v.validateTypeDefinition(itemMap, fmt.Sprintf("%s/oneOf[%d]", path, i))
				}
			}
		}
	}

	// Validate not
	if not, ok := schema["not"]; ok {
		notMap, isMap := not.(map[string]interface{})
		if !isMap {
			v.addError(path+"/not", "not must be an object", SchemaKeywordInvalidType)
		} else {
			v.validateTypeDefinition(notMap, path+"/not")
		}
	}

	// Validate if/then/else
	if ifSchema, ok := schema["if"]; ok {
		ifMap, isMap := ifSchema.(map[string]interface{})
		if !isMap {
			v.addError(path+"/if", "if must be an object", SchemaKeywordInvalidType)
		} else {
			v.validateTypeDefinition(ifMap, path+"/if")
		}
	}
	if thenSchema, ok := schema["then"]; ok {
		thenMap, isMap := thenSchema.(map[string]interface{})
		if !isMap {
			v.addError(path+"/then", "then must be an object", SchemaKeywordInvalidType)
		} else {
			v.validateTypeDefinition(thenMap, path+"/then")
		}
	}
	if elseSchema, ok := schema["else"]; ok {
		elseMap, isMap := elseSchema.(map[string]interface{})
		if !isMap {
			v.addError(path+"/else", "else must be an object", SchemaKeywordInvalidType)
		} else {
			v.validateTypeDefinition(elseMap, path+"/else")
		}
	}
}

func (v *SchemaValidator) validateConstraintTypeMatch(typeStr string, schema map[string]interface{}, path string) {
	stringOnlyConstraints := []string{"minLength", "maxLength", "pattern"}
	numericOnlyConstraints := []string{"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"}

	// Check string constraints on non-string types
	for _, constraint := range stringOnlyConstraints {
		if _, ok := schema[constraint]; ok && typeStr != "string" {
			v.addError(path+"/"+constraint, fmt.Sprintf("%s constraint is only valid for string type, not %s", constraint, typeStr), SchemaConstraintInvalidForType)
		}
	}

	// Check numeric constraints on non-numeric types
	for _, constraint := range numericOnlyConstraints {
		if _, ok := schema[constraint]; ok && !isNumericType(typeStr) {
			v.addError(path+"/"+constraint, fmt.Sprintf("%s constraint is only valid for numeric types, not %s", constraint, typeStr), SchemaConstraintInvalidForType)
		}
	}
}

func (v *SchemaValidator) validateRef(ref interface{}, path string) {
	refStr, ok := ref.(string)
	if !ok {
		v.addError(path, "$ref must be a string", SchemaKeywordInvalidType)
		return
	}

	if strings.HasPrefix(refStr, "#/") {
		// Check for circular reference
		if v.seenRefs[refStr] {
			v.addError(path, fmt.Sprintf("Circular reference detected: %s", refStr), SchemaRefCircular)
			return
		}

		v.seenRefs[refStr] = true
		resolved := v.resolveRef(refStr)
		if resolved == nil {
			v.addError(path, fmt.Sprintf("$ref '%s' not found", refStr), SchemaRefNotFound)
		} else {
			v.validateTypeDefinition(resolved, path)
		}
		delete(v.seenRefs, refStr)
	}
}

func (v *SchemaValidator) resolveRef(ref string) map[string]interface{} {
	if v.schema == nil || !strings.HasPrefix(ref, "#/") {
		return nil
	}

	parts := strings.Split(ref[2:], "/")
	var current interface{} = v.schema

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

func (v *SchemaValidator) addError(path, message string, codes ...string) {
	code := "SCHEMA_ERROR"
	if len(codes) > 0 {
		code = codes[0]
	}
	
	// Get source location if locator is available
	var location JsonLocation
	if v.sourceLocator != nil {
		location = v.sourceLocator.GetLocation(path)
	}
	
	v.errors = append(v.errors, ValidationError{
		Code:     code,
		Path:     path,
		Message:  message,
		Severity: SeverityError,
		Location: location,
	})
}

func (v *SchemaValidator) result() ValidationResult {
	return ValidationResult{
		IsValid: len(v.errors) == 0,
		Errors:  append([]ValidationError{}, v.errors...),
	}
}
