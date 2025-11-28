// Package jsonstructure provides validators for JSON Structure schemas and instances.
package jsonstructure

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Regular expressions for format validation
var (
	dateRegex     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	datetimeRegex = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$`)
	timeRegex     = regexp.MustCompile(`^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$`)
	durationRegex = regexp.MustCompile(`^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$|^P\d+W$`)
	uuidRegex     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	jsonPtrRegex  = regexp.MustCompile(`^(?:|(?:/(?:[^~/]|~[01])*)*)$`)
)

// InstanceValidator validates JSON instances against JSON Structure schemas.
type InstanceValidator struct {
	options           InstanceValidatorOptions
	errors            []ValidationError
	rootSchema        map[string]interface{}
	enabledExtensions map[string]bool
	sourceLocator     *JsonSourceLocator
}

// NewInstanceValidator creates a new InstanceValidator with the given options.
func NewInstanceValidator(options *InstanceValidatorOptions) *InstanceValidator {
	opts := InstanceValidatorOptions{}
	if options != nil {
		opts = *options
	}
	return &InstanceValidator{
		options:           opts,
		errors:            []ValidationError{},
		enabledExtensions: make(map[string]bool),
		sourceLocator:     nil,
	}
}

// Validate validates a JSON instance against a JSON Structure schema.
func (v *InstanceValidator) Validate(instance interface{}, schema interface{}) ValidationResult {
	v.errors = []ValidationError{}
	v.enabledExtensions = make(map[string]bool)

	schemaMap, ok := schema.(map[string]interface{})
	if !ok {
		v.addError("#", "Schema must be an object", SchemaInvalidType)
		return v.result()
	}

	v.rootSchema = schemaMap
	v.detectEnabledExtensions()

	// Handle $root
	targetSchema := schemaMap
	if root, ok := schemaMap["$root"]; ok {
		if rootStr, ok := root.(string); ok && strings.HasPrefix(rootStr, "#/") {
			resolved := v.resolveRef(rootStr)
			if resolved == nil {
				v.addError("#", fmt.Sprintf("Cannot resolve $root reference: %s", rootStr), InstanceRootUnresolved)
				return v.result()
			}
			targetSchema = resolved
		}
	}

	v.validateInstance(instance, targetSchema, "#")

	return v.result()
}

// ValidateJSON validates a JSON instance from JSON bytes against a schema.
func (v *InstanceValidator) ValidateJSON(instanceData, schemaData []byte) (ValidationResult, error) {
	var instance, schema interface{}
	if err := json.Unmarshal(instanceData, &instance); err != nil {
		return ValidationResult{IsValid: false}, fmt.Errorf("failed to parse instance: %w", err)
	}
	if err := json.Unmarshal(schemaData, &schema); err != nil {
		return ValidationResult{IsValid: false}, fmt.Errorf("failed to parse schema: %w", err)
	}
	// Create source locator for the instance JSON
	v.sourceLocator = NewJsonSourceLocator(string(instanceData))
	return v.Validate(instance, schema), nil
}

func (v *InstanceValidator) detectEnabledExtensions() {
	if v.rootSchema == nil {
		return
	}

	// Check $schema URI
	if schemaURI, ok := v.rootSchema["$schema"].(string); ok {
		if strings.Contains(schemaURI, "extended") || strings.Contains(schemaURI, "validation") {
			v.enabledExtensions["JSONStructureConditionalComposition"] = true
			v.enabledExtensions["JSONStructureValidation"] = true
		}
	}

	// Check $uses
	if uses, ok := v.rootSchema["$uses"].([]interface{}); ok {
		for _, ext := range uses {
			if extStr, ok := ext.(string); ok {
				v.enabledExtensions[extStr] = true
			}
		}
	}

	// If extended option is true, enable all
	if v.options.Extended {
		v.enabledExtensions["JSONStructureConditionalComposition"] = true
		v.enabledExtensions["JSONStructureValidation"] = true
	}
}

func (v *InstanceValidator) validateInstance(instance interface{}, schema map[string]interface{}, path string) {
	// Handle $ref
	if ref, ok := schema["$ref"].(string); ok {
		resolved := v.resolveRef(ref)
		if resolved == nil {
			v.addError(path, fmt.Sprintf("Cannot resolve $ref: %s", ref), InstanceRefUnresolved)
			return
		}
		v.validateInstance(instance, resolved, path)
		return
	}

	// Handle type with $ref
	if typeVal, ok := schema["type"]; ok {
		if typeRef, ok := typeVal.(map[string]interface{}); ok {
			if ref, ok := typeRef["$ref"].(string); ok {
				resolved := v.resolveRef(ref)
				if resolved == nil {
					v.addError(path, fmt.Sprintf("Cannot resolve type $ref: %s", ref), InstanceRefUnresolved)
					return
				}
				// Merge resolved type with current schema
				merged := make(map[string]interface{})
				for k, val := range resolved {
					merged[k] = val
				}
				for k, val := range schema {
					if k != "type" {
						merged[k] = val
					}
				}
				merged["type"] = resolved["type"]
				v.validateInstance(instance, merged, path)
				return
			}
		}
	}

	// Handle $extends
	if extends, ok := schema["$extends"].(string); ok {
		base := v.resolveRef(extends)
		if base == nil {
			v.addError(path, fmt.Sprintf("Cannot resolve $extends: %s", extends), InstanceRefUnresolved)
			return
		}
		// Merge base with derived
		merged := make(map[string]interface{})
		for k, val := range base {
			merged[k] = val
		}
		for k, val := range schema {
			if k != "$extends" {
				merged[k] = val
			}
		}
		// Merge properties
		if baseProps, ok := base["properties"].(map[string]interface{}); ok {
			if schemaProps, ok := schema["properties"].(map[string]interface{}); ok {
				mergedProps := make(map[string]interface{})
				for k, val := range baseProps {
					mergedProps[k] = val
				}
				for k, val := range schemaProps {
					mergedProps[k] = val
				}
				merged["properties"] = mergedProps
			}
		}
		v.validateInstance(instance, merged, path)
		return
	}

	// Handle union types
	if typeArr, ok := schema["type"].([]interface{}); ok {
		valid := false
		for _, t := range typeArr {
			tempValidator := &InstanceValidator{
				options:           v.options,
				errors:            []ValidationError{},
				rootSchema:        v.rootSchema,
				enabledExtensions: v.enabledExtensions,
			}
			unionSchema := make(map[string]interface{})
			for k, val := range schema {
				unionSchema[k] = val
			}
			unionSchema["type"] = t
			tempValidator.validateInstance(instance, unionSchema, path)
			if len(tempValidator.errors) == 0 {
				valid = true
				break
			}
		}
		if !valid {
			v.addError(path, "Instance does not match any type in union", InstanceTypeMismatch)
		}
		return
	}

	// Get type string
	typeStr, hasType := schema["type"].(string)

	// Type is required unless this is a conditional-only or enum/const schema
	if !hasType {
		conditionalKeywords := []string{"allOf", "anyOf", "oneOf", "not", "if"}
		hasConditional := false
		for _, k := range conditionalKeywords {
			if _, ok := schema[k]; ok {
				hasConditional = true
				break
			}
		}
		if hasConditional {
			v.validateConditionals(instance, schema, path)
			return
		}

		// Check for enum or const only
		_, hasEnum := schema["enum"]
		_, hasConst := schema["const"]
		if hasEnum || hasConst {
			if hasEnum {
				if enumArr, ok := schema["enum"].([]interface{}); ok {
					found := false
					for _, e := range enumArr {
						if v.deepEqual(instance, e) {
							found = true
							break
						}
					}
					if !found {
						v.addError(path, fmt.Sprintf("Value must be one of: %v", schema["enum"]), InstanceEnumMismatch)
					}
				}
			}
			if hasConst {
				if !v.deepEqual(instance, schema["const"]) {
					v.addError(path, fmt.Sprintf("Value must equal const: %v", schema["const"]))
				}
			}
			return
		}

		// Check for property constraint schema (used in allOf/anyOf/oneOf subschemas)
		_, hasProperties := schema["properties"]
		_, hasRequired := schema["required"]
		if hasProperties || hasRequired {
			// Validate as object constraints without requiring type
			if obj, ok := instance.(map[string]interface{}); ok {
				v.validateObjectConstraints(obj, schema, path)
			}
			// Validate conditionals if present
			v.validateConditionals(instance, schema, path)
			// Validate extended constraints
			if v.enabledExtensions["JSONStructureValidation"] {
				v.validateValidationAddins(instance, "object", schema, path)
			}
			return
		}

		v.addError(path, "Schema must have a 'type' property", SchemaMissingType)
		return
	}

	// Validate abstract
	if abstract, ok := schema["abstract"].(bool); ok && abstract {
		v.addError(path, "Cannot validate instance against abstract schema", InstanceSchemaFalse)
		return
	}

	// Validate by type
	v.validateByType(instance, typeStr, schema, path)

	// Validate const
	if constVal, ok := schema["const"]; ok {
		if !v.deepEqual(instance, constVal) {
			v.addError(path, fmt.Sprintf("Value must equal const: %v", constVal), InstanceConstMismatch)
		}
	}

	// Validate enum
	if enumVal, ok := schema["enum"].([]interface{}); ok {
		found := false
		for _, e := range enumVal {
			if v.deepEqual(instance, e) {
				found = true
				break
			}
		}
		if !found {
			v.addError(path, fmt.Sprintf("Value must be one of: %v", enumVal), InstanceEnumMismatch)
		}
	}

	// Validate conditionals if enabled
	if v.enabledExtensions["JSONStructureConditionalComposition"] {
		v.validateConditionals(instance, schema, path)
	}

	// Validate validation addins if enabled
	if v.enabledExtensions["JSONStructureValidation"] {
		v.validateValidationAddins(instance, typeStr, schema, path)
	}
}

func (v *InstanceValidator) validateByType(instance interface{}, typeStr string, schema map[string]interface{}, path string) {
	switch typeStr {
	case "any":
		// Any type accepts all values

	case "null":
		if instance != nil {
			v.addError(path, fmt.Sprintf("Expected null, got %T", instance), InstanceNullExpected)
		}

	case "boolean":
		if _, ok := instance.(bool); !ok {
			v.addError(path, fmt.Sprintf("Expected boolean, got %T", instance), InstanceBooleanExpected)
		}

	case "string":
		if _, ok := instance.(string); !ok {
			v.addError(path, fmt.Sprintf("Expected string, got %T", instance), InstanceStringExpected)
		}

	case "number":
		if !isNumber(instance) {
			v.addError(path, fmt.Sprintf("Expected number, got %T", instance), InstanceNumberExpected)
		}

	case "integer", "int32":
		v.validateInt32(instance, path)

	case "int8":
		v.validateIntRange(instance, -128, 127, "int8", path)

	case "uint8":
		v.validateIntRange(instance, 0, 255, "uint8", path)

	case "int16":
		v.validateIntRange(instance, -32768, 32767, "int16", path)

	case "uint16":
		v.validateIntRange(instance, 0, 65535, "uint16", path)

	case "uint32":
		v.validateIntRange(instance, 0, 4294967295, "uint32", path)

	case "int64":
		v.validateStringInt(instance, new(big.Int).Neg(new(big.Int).Exp(big.NewInt(2), big.NewInt(63), nil)),
			new(big.Int).Sub(new(big.Int).Exp(big.NewInt(2), big.NewInt(63), nil), big.NewInt(1)), "int64", path)

	case "uint64":
		v.validateStringInt(instance, big.NewInt(0),
			new(big.Int).Sub(new(big.Int).Exp(big.NewInt(2), big.NewInt(64), nil), big.NewInt(1)), "uint64", path)

	case "int128":
		v.validateStringInt(instance, new(big.Int).Neg(new(big.Int).Exp(big.NewInt(2), big.NewInt(127), nil)),
			new(big.Int).Sub(new(big.Int).Exp(big.NewInt(2), big.NewInt(127), nil), big.NewInt(1)), "int128", path)

	case "uint128":
		v.validateStringInt(instance, big.NewInt(0),
			new(big.Int).Sub(new(big.Int).Exp(big.NewInt(2), big.NewInt(128), nil), big.NewInt(1)), "uint128", path)

	case "float", "float8", "double":
		if !isNumber(instance) {
			v.addError(path, fmt.Sprintf("Expected %s, got %T", typeStr, instance), InstanceNumberExpected)
		}

	case "decimal":
		if str, ok := instance.(string); ok {
			if _, err := strconv.ParseFloat(str, 64); err != nil {
				v.addError(path, "Invalid decimal format", InstanceDecimalExpected)
			}
		} else {
			v.addError(path, fmt.Sprintf("Expected decimal as string, got %T", instance), InstanceDecimalExpected)
		}

	case "date":
		if str, ok := instance.(string); !ok || !dateRegex.MatchString(str) {
			v.addError(path, "Expected date in YYYY-MM-DD format", InstanceDateFormatInvalid)
		}

	case "datetime":
		if str, ok := instance.(string); !ok || !datetimeRegex.MatchString(str) {
			v.addError(path, "Expected datetime in RFC3339 format", InstanceDatetimeFormatInvalid)
		}

	case "time":
		if str, ok := instance.(string); !ok || !timeRegex.MatchString(str) {
			v.addError(path, "Expected time in HH:MM:SS format", InstanceTimeFormatInvalid)
		}

	case "duration":
		if str, ok := instance.(string); !ok {
			v.addError(path, "Expected duration as string", InstanceDurationExpected)
		} else if !durationRegex.MatchString(str) {
			v.addError(path, "Expected duration in ISO 8601 format", InstanceDurationFormatInvalid)
		}

	case "uuid":
		if str, ok := instance.(string); !ok {
			v.addError(path, "Expected uuid as string", InstanceUUIDExpected)
		} else if !uuidRegex.MatchString(str) {
			v.addError(path, "Invalid uuid format", InstanceUUIDFormatInvalid)
		}

	case "uri":
		if str, ok := instance.(string); !ok {
			v.addError(path, "Expected uri as string", InstanceURIExpected)
		} else if _, err := url.ParseRequestURI(str); err != nil {
			v.addError(path, "Invalid uri format", InstanceURIFormatInvalid)
		}

	case "binary":
		if str, ok := instance.(string); !ok {
			v.addError(path, "Expected binary as base64 string", InstanceBinaryExpected)
		} else if _, err := base64.StdEncoding.DecodeString(str); err != nil {
			v.addError(path, "Invalid base64 encoding", InstanceBinaryEncodingInvalid)
		}

	case "jsonpointer":
		if str, ok := instance.(string); !ok || !jsonPtrRegex.MatchString(str) {
			v.addError(path, "Expected JSON pointer format", InstanceJSONPointerFormatInvalid)
		}

	case "object":
		v.validateObject(instance, schema, path)

	case "array":
		v.validateArray(instance, schema, path)

	case "set":
		v.validateSet(instance, schema, path)

	case "map":
		v.validateMap(instance, schema, path)

	case "tuple":
		v.validateTuple(instance, schema, path)

	case "choice":
		v.validateChoice(instance, schema, path)

	default:
		v.addError(path, fmt.Sprintf("Unknown type: %s", typeStr), InstanceTypeUnknown)
	}
}

func (v *InstanceValidator) validateInt32(instance interface{}, path string) {
	num, ok := toFloat64(instance)
	if !ok || num != math.Trunc(num) {
		v.addError(path, "Expected integer", InstanceIntegerExpected)
		return
	}
	if num < -2147483648 || num > 2147483647 {
		v.addError(path, "int32 value out of range", InstanceIntRangeInvalid)
	}
}

func (v *InstanceValidator) validateIntRange(instance interface{}, min, max float64, typeName, path string) {
	num, ok := toFloat64(instance)
	if !ok || num != math.Trunc(num) {
		v.addError(path, fmt.Sprintf("Expected %s", typeName), InstanceIntegerExpected)
		return
	}
	if num < min || num > max {
		v.addError(path, fmt.Sprintf("%s value out of range", typeName), InstanceIntRangeInvalid)
	}
}

func (v *InstanceValidator) validateStringInt(instance interface{}, min, max *big.Int, typeName, path string) {
	str, ok := instance.(string)
	if !ok {
		v.addError(path, fmt.Sprintf("Expected %s as string", typeName), InstanceStringNotExpected)
		return
	}
	val, success := new(big.Int).SetString(str, 10)
	if !success {
		v.addError(path, fmt.Sprintf("Invalid %s format", typeName), InstanceIntegerExpected)
		return
	}
	if val.Cmp(min) < 0 || val.Cmp(max) > 0 {
		v.addError(path, fmt.Sprintf("%s value out of range", typeName), InstanceIntRangeInvalid)
	}
}

func (v *InstanceValidator) validateObject(instance interface{}, schema map[string]interface{}, path string) {
	obj, ok := instance.(map[string]interface{})
	if !ok {
		v.addError(path, fmt.Sprintf("Expected object, got %T", instance), InstanceObjectExpected)
		return
	}

	properties, _ := schema["properties"].(map[string]interface{})
	required, _ := schema["required"].([]interface{})
	additionalProperties := schema["additionalProperties"]

	// Validate required properties
	for _, r := range required {
		if rStr, ok := r.(string); ok {
			if _, exists := obj[rStr]; !exists {
				v.addError(path, fmt.Sprintf("Missing required property: %s", rStr), InstanceRequiredPropertyMissing)
			}
		}
	}

	// Validate properties
	for propName, propSchema := range properties {
		if propValue, exists := obj[propName]; exists {
			if propSchemaMap, ok := propSchema.(map[string]interface{}); ok {
				v.validateInstance(propValue, propSchemaMap, path+"/"+propName)
			}
		}
	}

	// Validate additionalProperties
	if additionalProperties != nil {
		switch ap := additionalProperties.(type) {
		case bool:
			if !ap {
				for key := range obj {
					if properties == nil || properties[key] == nil {
						v.addError(path, fmt.Sprintf("Additional property not allowed: %s", key), InstanceAdditionalPropertyNotAllowed)
					}
				}
			}
		case map[string]interface{}:
			for key, val := range obj {
				if properties == nil || properties[key] == nil {
					v.validateInstance(val, ap, path+"/"+key)
				}
			}
		}
	}
}

// validateObjectConstraints validates object property constraints without checking instance type
// Used for allOf/anyOf/oneOf subschemas that have properties/required but no type
func (v *InstanceValidator) validateObjectConstraints(obj map[string]interface{}, schema map[string]interface{}, path string) {
	properties, _ := schema["properties"].(map[string]interface{})
	required, _ := schema["required"].([]interface{})
	additionalProperties := schema["additionalProperties"]

	// Validate required properties
	for _, r := range required {
		if rStr, ok := r.(string); ok {
			if _, exists := obj[rStr]; !exists {
				v.addError(path, fmt.Sprintf("Missing required property: %s", rStr), InstanceRequiredPropertyMissing)
			}
		}
	}

	// Validate properties
	for propName, propSchema := range properties {
		if propValue, exists := obj[propName]; exists {
			if propSchemaMap, ok := propSchema.(map[string]interface{}); ok {
				v.validateInstance(propValue, propSchemaMap, path+"/"+propName)
			}
		}
	}

	// Validate additionalProperties
	if additionalProperties != nil {
		switch ap := additionalProperties.(type) {
		case bool:
			if !ap {
				for key := range obj {
					if properties == nil || properties[key] == nil {
						v.addError(path, fmt.Sprintf("Additional property not allowed: %s", key), InstanceAdditionalPropertyNotAllowed)
					}
				}
			}
		case map[string]interface{}:
			for key, val := range obj {
				if properties == nil || properties[key] == nil {
					v.validateInstance(val, ap, path+"/"+key)
				}
			}
		}
	}
}

func (v *InstanceValidator) validateArray(instance interface{}, schema map[string]interface{}, path string) {
	arr, ok := instance.([]interface{})
	if !ok {
		v.addError(path, fmt.Sprintf("Expected array, got %T", instance), InstanceArrayExpected)
		return
	}

	if items, ok := schema["items"].(map[string]interface{}); ok {
		for i, item := range arr {
			v.validateInstance(item, items, fmt.Sprintf("%s[%d]", path, i))
		}
	}
}

func (v *InstanceValidator) validateSet(instance interface{}, schema map[string]interface{}, path string) {
	arr, ok := instance.([]interface{})
	if !ok {
		v.addError(path, fmt.Sprintf("Expected set (array), got %T", instance), InstanceSetExpected)
		return
	}

	// Check for duplicates
	seen := make(map[string]bool)
	for i := 0; i < len(arr); i++ {
		serialized, _ := json.Marshal(arr[i])
		if seen[string(serialized)] {
			v.addError(path, "Set contains duplicate items", InstanceSetDuplicate)
			break
		}
		seen[string(serialized)] = true
	}

	// Validate items
	if items, ok := schema["items"].(map[string]interface{}); ok {
		for i, item := range arr {
			v.validateInstance(item, items, fmt.Sprintf("%s[%d]", path, i))
		}
	}
}

func (v *InstanceValidator) validateMap(instance interface{}, schema map[string]interface{}, path string) {
	obj, ok := instance.(map[string]interface{})
	if !ok {
		v.addError(path, fmt.Sprintf("Expected map (object), got %T", instance), InstanceMapExpected)
		return
	}

	if values, ok := schema["values"].(map[string]interface{}); ok {
		for key, val := range obj {
			v.validateInstance(val, values, path+"/"+key)
		}
	}
}

func (v *InstanceValidator) validateTuple(instance interface{}, schema map[string]interface{}, path string) {
	arr, ok := instance.([]interface{})
	if !ok {
		v.addError(path, fmt.Sprintf("Expected tuple (array), got %T", instance), InstanceTupleExpected)
		return
	}

	tupleOrder, hasTuple := schema["tuple"].([]interface{})
	properties, _ := schema["properties"].(map[string]interface{})

	if !hasTuple {
		v.addError(path, "Tuple schema must have 'tuple' array", SchemaTupleMissingPrefixItems)
		return
	}

	if len(arr) != len(tupleOrder) {
		v.addError(path, fmt.Sprintf("Tuple length mismatch: expected %d, got %d", len(tupleOrder), len(arr)), InstanceTupleLengthMismatch)
		return
	}

	if properties != nil {
		for i, name := range tupleOrder {
			if propName, ok := name.(string); ok {
				if propSchema, ok := properties[propName].(map[string]interface{}); ok {
					v.validateInstance(arr[i], propSchema, path+"/"+propName)
				}
			}
		}
	}
}

func (v *InstanceValidator) validateChoice(instance interface{}, schema map[string]interface{}, path string) {
	obj, ok := instance.(map[string]interface{})
	if !ok {
		v.addError(path, fmt.Sprintf("Expected choice (object), got %T", instance), InstanceChoiceExpected)
		return
	}

	choices, _ := schema["choices"].(map[string]interface{})
	selector, _ := schema["selector"].(string)
	_, hasExtends := schema["$extends"]

	if choices == nil {
		v.addError(path, "Choice schema must have 'choices'", InstanceChoiceMissingOptions)
		return
	}

	if hasExtends && selector != "" {
		// Inline union: use selector property
		selectorValue, ok := obj[selector].(string)
		if !ok {
			v.addError(path, fmt.Sprintf("Selector '%s' must be a string", selector), InstanceChoiceDiscriminatorNotString)
			return
		}
		choiceSchema, ok := choices[selectorValue].(map[string]interface{})
		if !ok {
			v.addError(path, fmt.Sprintf("Selector value '%s' not in choices", selectorValue), InstanceChoiceOptionUnknown)
			return
		}
		// Validate remaining properties
		remaining := make(map[string]interface{})
		for k, val := range obj {
			if k != selector {
				remaining[k] = val
			}
		}
		v.validateInstance(remaining, choiceSchema, path)
	} else {
		// Tagged union: exactly one property matching a choice key
		keys := make([]string, 0, len(obj))
		for k := range obj {
			keys = append(keys, k)
		}
		if len(keys) != 1 {
			v.addError(path, "Tagged union must have exactly one property", InstanceChoiceNoMatch)
			return
		}
		key := keys[0]
		choiceSchema, ok := choices[key].(map[string]interface{})
		if !ok {
			v.addError(path, fmt.Sprintf("Property '%s' not in choices", key), InstanceChoiceOptionUnknown)
			return
		}
		v.validateInstance(obj[key], choiceSchema, path+"/"+key)
	}
}

func (v *InstanceValidator) validateConditionals(instance interface{}, schema map[string]interface{}, path string) {
	// allOf
	if allOf, ok := schema["allOf"].([]interface{}); ok {
		for i, subSchema := range allOf {
			if subSchemaMap, ok := subSchema.(map[string]interface{}); ok {
				v.validateInstance(instance, subSchemaMap, fmt.Sprintf("%s/allOf[%d]", path, i))
			}
		}
	}

	// anyOf
	if anyOf, ok := schema["anyOf"].([]interface{}); ok {
		valid := false
		for i, subSchema := range anyOf {
			if subSchemaMap, ok := subSchema.(map[string]interface{}); ok {
				tempValidator := &InstanceValidator{
					options:           v.options,
					errors:            []ValidationError{},
					rootSchema:        v.rootSchema,
					enabledExtensions: v.enabledExtensions,
				}
				tempValidator.validateInstance(instance, subSchemaMap, fmt.Sprintf("%s/anyOf[%d]", path, i))
				if len(tempValidator.errors) == 0 {
					valid = true
					break
				}
			}
		}
		if !valid {
			v.addError(path, "Instance does not satisfy anyOf", InstanceAnyOfNoneMatched)
		}
	}

	// oneOf
	if oneOf, ok := schema["oneOf"].([]interface{}); ok {
		validCount := 0
		for i, subSchema := range oneOf {
			if subSchemaMap, ok := subSchema.(map[string]interface{}); ok {
				tempValidator := &InstanceValidator{
					options:           v.options,
					errors:            []ValidationError{},
					rootSchema:        v.rootSchema,
					enabledExtensions: v.enabledExtensions,
				}
				tempValidator.validateInstance(instance, subSchemaMap, fmt.Sprintf("%s/oneOf[%d]", path, i))
				if len(tempValidator.errors) == 0 {
					validCount++
				}
			}
		}
		if validCount != 1 {
			v.addError(path, fmt.Sprintf("Instance must match exactly one schema in oneOf, matched %d", validCount), InstanceOneOfInvalidCount)
		}
	}

	// not
	if not, ok := schema["not"].(map[string]interface{}); ok {
		tempValidator := &InstanceValidator{
			options:           v.options,
			errors:            []ValidationError{},
			rootSchema:        v.rootSchema,
			enabledExtensions: v.enabledExtensions,
		}
		tempValidator.validateInstance(instance, not, path+"/not")
		if len(tempValidator.errors) == 0 {
			v.addError(path, "Instance must not match \"not\" schema", InstanceNotMatched)
		}
	}

	// if/then/else
	if ifSchema, ok := schema["if"].(map[string]interface{}); ok {
		tempValidator := &InstanceValidator{
			options:           v.options,
			errors:            []ValidationError{},
			rootSchema:        v.rootSchema,
			enabledExtensions: v.enabledExtensions,
		}
		tempValidator.validateInstance(instance, ifSchema, path+"/if")
		ifValid := len(tempValidator.errors) == 0

		if ifValid {
			if thenSchema, ok := schema["then"].(map[string]interface{}); ok {
				v.validateInstance(instance, thenSchema, path+"/then")
			}
		} else {
			if elseSchema, ok := schema["else"].(map[string]interface{}); ok {
				v.validateInstance(instance, elseSchema, path+"/else")
			}
		}
	}
}

func (v *InstanceValidator) validateValidationAddins(instance interface{}, typeStr string, schema map[string]interface{}, path string) {
	// String constraints
	if typeStr == "string" {
		if str, ok := instance.(string); ok {
			if minLen, ok := schema["minLength"].(float64); ok {
				if len(str) < int(minLen) {
					v.addError(path, fmt.Sprintf("String length %d is less than minLength %d", len(str), int(minLen)), InstanceStringMinLength)
				}
			}
			if maxLen, ok := schema["maxLength"].(float64); ok {
				if len(str) > int(maxLen) {
					v.addError(path, fmt.Sprintf("String length %d exceeds maxLength %d", len(str), int(maxLen)), InstanceStringMaxLength)
				}
			}
			if pattern, ok := schema["pattern"].(string); ok {
				if regex, err := regexp.Compile(pattern); err == nil {
					if !regex.MatchString(str) {
						v.addError(path, fmt.Sprintf("String does not match pattern: %s", pattern), InstanceStringPatternMismatch)
					}
				}
			}
		}
	}

	// Numeric constraints
	numericTypes := map[string]bool{
		"number": true, "integer": true, "float": true, "double": true, "decimal": true, "float8": true,
		"int8": true, "uint8": true, "int16": true, "uint16": true, "int32": true, "uint32": true,
	}
	if numericTypes[typeStr] {
		if num, ok := toFloat64(instance); ok {
			if min, ok := schema["minimum"].(float64); ok {
				if num < min {
					v.addError(path, fmt.Sprintf("Value %v is less than minimum %v", num, min), InstanceNumberMinimum)
				}
			}
			if max, ok := schema["maximum"].(float64); ok {
				if num > max {
					v.addError(path, fmt.Sprintf("Value %v exceeds maximum %v", num, max), InstanceNumberMaximum)
				}
			}
			if multipleOf, ok := schema["multipleOf"].(float64); ok {
				if math.Abs(math.Mod(num, multipleOf)) > 1e-10 {
					v.addError(path, fmt.Sprintf("Value %v is not a multiple of %v", num, multipleOf), InstanceNumberMultipleOf)
				}
			}
		}
	}

	// Array constraints
	if typeStr == "array" || typeStr == "set" {
		if arr, ok := instance.([]interface{}); ok {
			if minItems, ok := schema["minItems"].(float64); ok {
				if len(arr) < int(minItems) {
					v.addError(path, fmt.Sprintf("Array has %d items, less than minItems %d", len(arr), int(minItems)), InstanceMinItems)
				}
			}
			if maxItems, ok := schema["maxItems"].(float64); ok {
				if len(arr) > int(maxItems) {
					v.addError(path, fmt.Sprintf("Array has %d items, more than maxItems %d", len(arr), int(maxItems)), InstanceMaxItems)
				}
			}
			if uniqueItems, ok := schema["uniqueItems"].(bool); ok && uniqueItems {
				seen := make(map[string]bool)
				for _, item := range arr {
					serialized, _ := json.Marshal(item)
					if seen[string(serialized)] {
						v.addError(path, "Array items are not unique", InstanceSetDuplicate)
						break
					}
					seen[string(serialized)] = true
				}
			}
		}
	}

	// Object constraints
	if typeStr == "object" {
		if obj, ok := instance.(map[string]interface{}); ok {
			if minProps, ok := schema["minProperties"].(float64); ok {
				if len(obj) < int(minProps) {
					v.addError(path, fmt.Sprintf("Object has %d properties, less than minProperties %d", len(obj), int(minProps)), InstanceMinProperties)
				}
			}
			if maxProps, ok := schema["maxProperties"].(float64); ok {
				if len(obj) > int(maxProps) {
					v.addError(path, fmt.Sprintf("Object has %d properties, more than maxProperties %d", len(obj), int(maxProps)), InstanceMaxProperties)
				}
			}
		}
	}
}

func (v *InstanceValidator) resolveRef(ref string) map[string]interface{} {
	if v.rootSchema == nil || !strings.HasPrefix(ref, "#/") {
		return nil
	}

	parts := strings.Split(ref[2:], "/")
	var current interface{} = v.rootSchema

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

func (v *InstanceValidator) deepEqual(a, b interface{}) bool {
	aJSON, _ := json.Marshal(a)
	bJSON, _ := json.Marshal(b)
	return string(aJSON) == string(bJSON)
}

func (v *InstanceValidator) addError(path, message string, codes ...string) {
	code := "INSTANCE_ERROR"
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

func (v *InstanceValidator) result() ValidationResult {
	return ValidationResult{
		IsValid: len(v.errors) == 0,
		Errors:  append([]ValidationError{}, v.errors...),
	}
}

// Helper functions

func isNumber(v interface{}) bool {
	switch v.(type) {
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return true
	}
	return false
}

func toFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int8:
		return float64(n), true
	case int16:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint:
		return float64(n), true
	case uint8:
		return float64(n), true
	case uint16:
		return float64(n), true
	case uint32:
		return float64(n), true
	case uint64:
		return float64(n), true
	}
	return 0, false
}
