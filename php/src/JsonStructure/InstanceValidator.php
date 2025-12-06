<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Validates JSON instances against JSON Structure schemas.
 */
class InstanceValidator
{
    private const ABSOLUTE_URI_REGEX = '/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//';

    private const DATE_REGEX = '/^\d{4}-\d{2}-\d{2}$/';
    private const DATETIME_REGEX = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})$/';
    private const TIME_REGEX = '/^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/';
    private const DURATION_REGEX = '/^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$|^P\d+W$/';
    private const UUID_REGEX = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';
    private const JSONPOINTER_REGEX = '/^#(\/[^\/]+)*$/';

    /** @var array<string, mixed> */
    private array $rootSchema;

    /** @var ValidationError[] */
    private array $errors = [];

    /** @var string[] */
    private array $enabledExtensions = [];

    private bool $extended;
    private int $maxValidationDepth;

    /**
     * @param array<string, mixed> $rootSchema
     */
    public function __construct(
        array $rootSchema,
        bool $extended = false,
        int $maxValidationDepth = 64
    ) {
        $this->rootSchema = $rootSchema;
        $this->extended = $extended;
        $this->maxValidationDepth = $maxValidationDepth;
        $this->detectEnabledExtensions();
    }

    private function detectEnabledExtensions(): void
    {
        $schemaUri = $this->rootSchema['$schema'] ?? '';
        $uses = $this->rootSchema['$uses'] ?? [];

        if (str_contains($schemaUri, 'extended') || str_contains($schemaUri, 'validation')) {
            $this->enabledExtensions[] = 'JSONStructureConditionalComposition';
            $this->enabledExtensions[] = 'JSONStructureValidation';
        }

        if (is_array($uses)) {
            foreach ($uses as $ext) {
                $this->enabledExtensions[] = $ext;
            }
        }

        // If extended=true was passed to constructor, enable validation extensions
        if ($this->extended) {
            $this->enabledExtensions[] = 'JSONStructureConditionalComposition';
            $this->enabledExtensions[] = 'JSONStructureValidation';
        }
    }

    /**
     * Validates an instance against the root schema.
     *
     * @return ValidationError[]
     */
    public function validate(mixed $instance): array
    {
        $this->errors = [];
        $this->validateInstance($instance, null, '#');
        return $this->errors;
    }

    /**
     * Validates an instance against a specific schema.
     *
     * @param array<string, mixed>|null $schema
     * @return ValidationError[]
     */
    public function validateInstance(mixed $instance, ?array $schema = null, string $path = '#', int $depth = 0): array
    {
        if ($depth > $this->maxValidationDepth) {
            $this->addError("Maximum validation depth ({$this->maxValidationDepth}) exceeded", $path, ErrorCodes::INSTANCE_MAX_DEPTH_EXCEEDED);
            return $this->errors;
        }

        if ($schema === null) {
            $schema = $this->rootSchema;

            // Handle $root - redirect to the designated root type
            if (isset($schema['$root']) && !isset($schema['type'])) {
                $rootRef = $schema['$root'];
                $resolved = $this->resolveRef($rootRef);
                if ($resolved === null) {
                    $this->addError("Cannot resolve \$root reference {$rootRef}", $path, ErrorCodes::INSTANCE_ROOT_UNRESOLVED);
                    return $this->errors;
                }
                return $this->validateInstance($instance, $resolved, $path, $depth + 1);
            }
        }

        // Handle schemas that are only conditional composition at the root (no 'type')
        $conditionalKeywords = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'];
        $hasConditionalsAtRoot = false;
        foreach ($conditionalKeywords as $kw) {
            if (isset($schema[$kw])) {
                $hasConditionalsAtRoot = true;
                break;
            }
        }

        if (!isset($schema['type']) && $hasConditionalsAtRoot) {
            $enableConditional = $this->extended ||
                in_array('JSONStructureConditionalComposition', $this->enabledExtensions, true) ||
                in_array('JSONStructureValidation', $this->enabledExtensions, true);

            if ($enableConditional) {
                $this->validateConditionals($schema, $instance, $path);
                return $this->errors;
            } else {
                $this->addError("Conditional composition keywords present at {$path} but not enabled", $path);
                return $this->errors;
            }
        }

        // Handle case where "type" is a dict with a $ref
        $schemaType = $schema['type'] ?? null;
        if ($schemaType === null) {
            $this->addError("Schema at {$path} has no 'type'", $path);
            return $this->errors;
        }

        if (is_array($schemaType) && !array_is_list($schemaType)) {
            // Associative array (object)
            if (isset($schemaType['$ref'])) {
                $resolved = $this->resolveRef($schemaType['$ref']);
                if ($resolved === null) {
                    $this->addError("Cannot resolve \$ref {$schemaType['$ref']} at {$path}/type", $path . '/type', ErrorCodes::INSTANCE_REF_UNRESOLVED);
                    return $this->errors;
                }
                $newSchema = array_merge($schema, ['type' => $resolved['type'] ?? null]);
                if (isset($resolved['properties'])) {
                    $mergedProps = $resolved['properties'];
                    if (isset($schema['properties'])) {
                        $mergedProps = array_merge($mergedProps, $schema['properties']);
                    }
                    $newSchema['properties'] = $mergedProps;
                }
                if (isset($resolved['tuple'])) {
                    $newSchema['tuple'] = $resolved['tuple'];
                }
                if (isset($resolved['required']) && !isset($newSchema['required'])) {
                    $newSchema['required'] = $resolved['required'];
                }
                if (isset($resolved['choices'])) {
                    $newSchema['choices'] = $resolved['choices'];
                }
                if (isset($resolved['selector'])) {
                    $newSchema['selector'] = $resolved['selector'];
                }
                if (isset($resolved['$extends']) && !isset($newSchema['$extends'])) {
                    $newSchema['$extends'] = $resolved['$extends'];
                }
                $schema = $newSchema;
                $schemaType = $schema['type'];
            } else {
                $this->addError("Schema at {$path} has invalid 'type'", $path);
                return $this->errors;
            }
        }

        // Handle union types
        if (is_array($schemaType) && array_is_list($schemaType)) {
            $unionValid = false;
            $unionErrors = [];
            foreach ($schemaType as $t) {
                $backup = $this->errors;
                $this->errors = [];
                $this->validateInstance($instance, ['type' => $t], $path, $depth + 1);
                if (count($this->errors) === 0) {
                    $unionValid = true;
                    break;
                }
                foreach ($this->errors as $e) {
                    $unionErrors[] = (string) $e;
                }
                $this->errors = $backup;
            }
            if (!$unionValid) {
                $this->addError("Instance at {$path} does not match any type in union: " . implode(', ', $unionErrors), $path);
            }
            return $this->errors;
        }

        if (!is_string($schemaType)) {
            $this->addError("Schema at {$path} has invalid 'type'", $path);
            return $this->errors;
        }

        // Process $extends (can be a string or array of strings for multiple inheritance)
        if ($schemaType !== 'choice' && isset($schema['$extends'])) {
            $extendsValue = $schema['$extends'];
            $extendsRefs = [];

            if (is_string($extendsValue)) {
                $extendsRefs = [$extendsValue];
            } elseif (is_array($extendsValue)) {
                $extendsRefs = array_filter($extendsValue, 'is_string');
            }

            if (count($extendsRefs) > 0) {
                // Merge base types in order (first-wins for properties)
                $mergedProps = [];
                $mergedRequired = [];

                foreach ($extendsRefs as $ref) {
                    $base = $this->resolveRef($ref);
                    if ($base === null) {
                        $this->addError("Cannot resolve \$extends {$ref} at {$path}", $path);
                        return $this->errors;
                    }
                    // Merge properties (first-wins)
                    $baseProps = $base['properties'] ?? [];
                    foreach ($baseProps as $key => $value) {
                        if (!isset($mergedProps[$key])) {
                            $mergedProps[$key] = $value;
                        }
                    }
                    // Merge required
                    if (isset($base['required'])) {
                        foreach ($base['required'] as $r) {
                            $mergedRequired[$r] = true;
                        }
                    }
                }

                // Merge derived schema's properties on top
                $derivedProps = $schema['properties'] ?? [];
                foreach ($derivedProps as $key => $value) {
                    if (isset($mergedProps[$key])) {
                        $this->addError("Property '{$key}' is inherited via \$extends and must not be redefined at {$path}", $path);
                    }
                    $mergedProps[$key] = $value;
                }

                if (isset($schema['required'])) {
                    foreach ($schema['required'] as $r) {
                        $mergedRequired[$r] = true;
                    }
                }

                // Create merged schema
                $merged = $schema;
                unset($merged['$extends'], $merged['abstract']);
                if (count($mergedProps) > 0) {
                    $merged['properties'] = $mergedProps;
                }
                if (count($mergedRequired) > 0) {
                    $merged['required'] = array_keys($mergedRequired);
                }
                $schema = $merged;
            }
        }

        // Reject abstract schemas
        if (($schema['abstract'] ?? false) === true) {
            $this->addError("Abstract schema at {$path} cannot be used for instance validation", $path);
            return $this->errors;
        }

        // Type-based validation
        $this->validateType($schemaType, $instance, $schema, $path, $depth);

        // Extended validation
        if ($this->extended || in_array('JSONStructureValidation', $this->enabledExtensions, true)) {
            $this->validateValidationAddins($schema, $instance, $path);
        }

        if ($this->extended || in_array('JSONStructureConditionalComposition', $this->enabledExtensions, true)) {
            $this->validateConditionals($schema, $instance, $path);
        }

        // Validate const
        if (isset($schema['const'])) {
            if ($instance !== $schema['const']) {
                $this->addError("Value at {$path} does not equal const", $path, ErrorCodes::INSTANCE_CONST_MISMATCH);
            }
        }

        // Validate enum
        if (isset($schema['enum'])) {
            if (!in_array($instance, $schema['enum'], true)) {
                $this->addError("Value at {$path} not in enum", $path, ErrorCodes::INSTANCE_ENUM_MISMATCH);
            }
        }

        return $this->errors;
    }

    private function validateType(string $type, mixed $instance, array $schema, string $path, int $depth): void
    {
        switch ($type) {
            case 'any':
                break;

            case 'string':
                if (!is_string($instance)) {
                    $this->addError("Expected string at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_STRING_EXPECTED);
                }
                break;

            case 'number':
                if (!is_int($instance) && !is_float($instance)) {
                    $this->addError("Expected number at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_NUMBER_EXPECTED);
                }
                break;

            case 'boolean':
                if (!is_bool($instance)) {
                    $this->addError("Expected boolean at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_BOOLEAN_EXPECTED);
                }
                break;

            case 'null':
                if ($instance !== null) {
                    $this->addError("Expected null at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_NULL_EXPECTED);
                }
                break;

            case 'int8':
                $this->validateIntegerRange($instance, $path, 'int8', -128, 127);
                break;

            case 'uint8':
                $this->validateIntegerRange($instance, $path, 'uint8', 0, 255);
                break;

            case 'int16':
                $this->validateIntegerRange($instance, $path, 'int16', -32768, 32767);
                break;

            case 'uint16':
                $this->validateIntegerRange($instance, $path, 'uint16', 0, 65535);
                break;

            case 'int32':
            case 'integer':
                $this->validateIntegerRange($instance, $path, $type, -2147483648, 2147483647);
                break;

            case 'uint32':
                $this->validateIntegerRange($instance, $path, 'uint32', 0, 4294967295);
                break;

            case 'int64':
                $this->validateLargeInteger($instance, $path, 'int64', '-9223372036854775808', '9223372036854775807');
                break;

            case 'uint64':
                $this->validateLargeInteger($instance, $path, 'uint64', '0', '18446744073709551615');
                break;

            case 'int128':
                $this->validateLargeInteger($instance, $path, 'int128', '-170141183460469231731687303715884105728', '170141183460469231731687303715884105727');
                break;

            case 'uint128':
                $this->validateLargeInteger($instance, $path, 'uint128', '0', '340282366920938463463374607431768211455');
                break;

            case 'float8':
            case 'float':
            case 'double':
                if (!is_int($instance) && !is_float($instance)) {
                    $this->addError("Expected {$type} at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_NUMBER_EXPECTED);
                }
                break;

            case 'decimal':
                if (!is_string($instance)) {
                    $this->addError("Expected decimal as string at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_DECIMAL_EXPECTED);
                } elseif (!is_numeric($instance)) {
                    $this->addError("Invalid decimal format at {$path}", $path, ErrorCodes::INSTANCE_DECIMAL_EXPECTED);
                }
                break;

            case 'date':
                if (!is_string($instance)) {
                    $this->addError("Expected date at {$path}", $path, ErrorCodes::INSTANCE_DATE_EXPECTED);
                } elseif (!preg_match(self::DATE_REGEX, $instance)) {
                    $this->addError("Expected date (YYYY-MM-DD) at {$path}", $path, ErrorCodes::INSTANCE_DATE_FORMAT_INVALID);
                }
                break;

            case 'datetime':
                if (!is_string($instance)) {
                    $this->addError("Expected datetime at {$path}", $path, ErrorCodes::INSTANCE_DATETIME_EXPECTED);
                } elseif (!preg_match(self::DATETIME_REGEX, $instance)) {
                    $this->addError("Expected datetime (RFC3339) at {$path}", $path, ErrorCodes::INSTANCE_DATETIME_FORMAT_INVALID);
                }
                break;

            case 'time':
                if (!is_string($instance)) {
                    $this->addError("Expected time at {$path}", $path, ErrorCodes::INSTANCE_TIME_EXPECTED);
                } elseif (!preg_match(self::TIME_REGEX, $instance)) {
                    $this->addError("Expected time (HH:MM:SS) at {$path}", $path, ErrorCodes::INSTANCE_TIME_FORMAT_INVALID);
                }
                break;

            case 'duration':
                if (!is_string($instance)) {
                    $this->addError("Expected duration as string at {$path}", $path, ErrorCodes::INSTANCE_DURATION_EXPECTED);
                } elseif (!preg_match(self::DURATION_REGEX, $instance)) {
                    $this->addError("Expected duration (ISO 8601 format) at {$path}", $path, ErrorCodes::INSTANCE_DURATION_FORMAT_INVALID);
                }
                break;

            case 'uuid':
                if (!is_string($instance)) {
                    $this->addError("Expected uuid as string at {$path}", $path, ErrorCodes::INSTANCE_UUID_EXPECTED);
                } elseif (!preg_match(self::UUID_REGEX, $instance)) {
                    $this->addError("Invalid uuid format at {$path}", $path, ErrorCodes::INSTANCE_UUID_FORMAT_INVALID);
                }
                break;

            case 'uri':
                if (!is_string($instance)) {
                    $this->addError("Expected uri as string at {$path}", $path, ErrorCodes::INSTANCE_URI_EXPECTED);
                } else {
                    $parsed = parse_url($instance);
                    if ($parsed === false || !isset($parsed['scheme'])) {
                        $this->addError("Invalid uri format at {$path}", $path, ErrorCodes::INSTANCE_URI_FORMAT_INVALID);
                    }
                }
                break;

            case 'binary':
                if (!is_string($instance)) {
                    $this->addError("Expected binary (base64 string) at {$path}", $path, ErrorCodes::INSTANCE_BINARY_EXPECTED);
                }
                break;

            case 'jsonpointer':
                if (!is_string($instance)) {
                    $this->addError("Expected JSON pointer at {$path}", $path, ErrorCodes::INSTANCE_JSONPOINTER_EXPECTED);
                } elseif (!preg_match(self::JSONPOINTER_REGEX, $instance)) {
                    $this->addError("Expected JSON pointer format at {$path}", $path, ErrorCodes::INSTANCE_JSONPOINTER_FORMAT_INVALID);
                }
                break;

            case 'object':
                $this->validateObject($instance, $schema, $path, $depth);
                break;

            case 'array':
                $this->validateArray($instance, $schema, $path, $depth);
                break;

            case 'set':
                $this->validateSet($instance, $schema, $path, $depth);
                break;

            case 'map':
                $this->validateMap($instance, $schema, $path, $depth);
                break;

            case 'tuple':
                $this->validateTuple($instance, $schema, $path, $depth);
                break;

            case 'choice':
                $this->validateChoice($instance, $schema, $path, $depth);
                break;

            default:
                $this->addError("Unsupported type '{$type}' at {$path}", $path, ErrorCodes::INSTANCE_TYPE_UNKNOWN);
                break;
        }
    }

    private function validateIntegerRange(mixed $instance, string $path, string $typeName, int $min, int $max): void
    {
        if (!is_int($instance)) {
            $this->addError("Expected {$typeName} at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_INTEGER_EXPECTED);
            return;
        }

        if ($instance < $min || $instance > $max) {
            $this->addError("{$typeName} value at {$path} out of range", $path, ErrorCodes::INSTANCE_INT_RANGE_INVALID);
        }
    }

    private function validateLargeInteger(mixed $instance, string $path, string $typeName, string $min, string $max): void
    {
        if (!is_string($instance)) {
            $this->addError("Expected {$typeName} as string at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_STRING_EXPECTED);
            return;
        }

        if (!is_numeric($instance)) {
            $this->addError("Invalid {$typeName} format at {$path}", $path, ErrorCodes::INSTANCE_INT_RANGE_INVALID);
            return;
        }

        // Compare as strings using bccomp if available, or simple comparison for smaller values
        if (bccomp($instance, $min) < 0 || bccomp($instance, $max) > 0) {
            $this->addError("{$typeName} value at {$path} out of range", $path, ErrorCodes::INSTANCE_INT_RANGE_INVALID);
        }
    }

    private function validateObject(mixed $instance, array $schema, string $path, int $depth): void
    {
        if (!is_array($instance) || array_is_list($instance)) {
            $this->addError("Expected object at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_OBJECT_EXPECTED);
            return;
        }

        $props = $schema['properties'] ?? [];
        $required = $schema['required'] ?? [];

        // Check required properties
        foreach ($required as $r) {
            if (!array_key_exists($r, $instance)) {
                $this->addError("Missing required property '{$r}' at {$path}", $path, ErrorCodes::INSTANCE_REQUIRED_PROPERTY_MISSING);
            }
        }

        // Validate properties
        foreach ($props as $prop => $propSchema) {
            if (array_key_exists($prop, $instance)) {
                $this->validateInstance($instance[$prop], $propSchema, "{$path}/{$prop}", $depth + 1);
            }
        }

        // Check additional properties
        if (isset($schema['additionalProperties'])) {
            $addl = $schema['additionalProperties'];
            $reservedInstanceProps = ['$schema', '$uses'];

            if ($addl === false) {
                foreach (array_keys($instance) as $key) {
                    $isReservedAtRoot = $path === '#' && in_array($key, $reservedInstanceProps, true);
                    if (!isset($props[$key]) && !$isReservedAtRoot) {
                        $this->addError("Additional property '{$key}' not allowed at {$path}", $path, ErrorCodes::INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED);
                    }
                }
            } elseif (is_array($addl)) {
                foreach (array_keys($instance) as $key) {
                    $isReservedAtRoot = $path === '#' && in_array($key, $reservedInstanceProps, true);
                    if (!isset($props[$key]) && !$isReservedAtRoot) {
                        $this->validateInstance($instance[$key], $addl, "{$path}/{$key}", $depth + 1);
                    }
                }
            }
        }

        // dependentRequired validation
        if (isset($schema['dependentRequired']) && is_array($schema['dependentRequired'])) {
            foreach ($schema['dependentRequired'] as $propName => $requiredDeps) {
                if (array_key_exists($propName, $instance) && is_array($requiredDeps)) {
                    foreach ($requiredDeps as $dep) {
                        if (!array_key_exists($dep, $instance)) {
                            $this->addError("Property '{$propName}' at {$path} requires dependent property '{$dep}'", $path, ErrorCodes::INSTANCE_DEPENDENT_REQUIRED);
                        }
                    }
                }
            }
        }
    }

    private function validateArray(mixed $instance, array $schema, string $path, int $depth): void
    {
        if (!is_array($instance) || !array_is_list($instance)) {
            $this->addError("Expected array at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_ARRAY_EXPECTED);
            return;
        }

        $itemsSchema = $schema['items'] ?? null;
        if ($itemsSchema !== null) {
            foreach ($instance as $idx => $item) {
                $this->validateInstance($item, $itemsSchema, "{$path}[{$idx}]", $depth + 1);
            }
        }
    }

    private function validateSet(mixed $instance, array $schema, string $path, int $depth): void
    {
        if (!is_array($instance) || !array_is_list($instance)) {
            $this->addError("Expected set (unique array) at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_SET_EXPECTED);
            return;
        }

        // Check for duplicates
        $serialized = array_map(fn($x) => json_encode($x, JSON_THROW_ON_ERROR), $instance);
        if (count($serialized) !== count(array_unique($serialized))) {
            $this->addError("Set at {$path} contains duplicate items", $path, ErrorCodes::INSTANCE_SET_DUPLICATE);
        }

        $itemsSchema = $schema['items'] ?? null;
        if ($itemsSchema !== null) {
            foreach ($instance as $idx => $item) {
                $this->validateInstance($item, $itemsSchema, "{$path}[{$idx}]", $depth + 1);
            }
        }
    }

    private function validateMap(mixed $instance, array $schema, string $path, int $depth): void
    {
        if (!is_array($instance) || array_is_list($instance)) {
            $this->addError("Expected map (object) at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_MAP_EXPECTED);
            return;
        }

        $valuesSchema = $schema['values'] ?? null;
        if ($valuesSchema !== null) {
            foreach ($instance as $key => $val) {
                $this->validateInstance($val, $valuesSchema, "{$path}/{$key}", $depth + 1);
            }
        }
    }

    private function validateTuple(mixed $instance, array $schema, string $path, int $depth): void
    {
        if (!is_array($instance) || !array_is_list($instance)) {
            $this->addError("Expected tuple (array) at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_TUPLE_EXPECTED);
            return;
        }

        $order = $schema['tuple'] ?? null;
        $props = $schema['properties'] ?? [];

        if ($order === null) {
            $this->addError("Tuple schema at {$path} is missing the required 'tuple' keyword for ordering", $path);
            return;
        }

        if (!is_array($order)) {
            $this->addError("'tuple' keyword at {$path} must be an array of property names", $path);
            return;
        }

        // Verify each name in order exists in properties
        foreach ($order as $propName) {
            if (!isset($props[$propName])) {
                $this->addError("Tuple order key '{$propName}' at {$path} not defined in properties", $path);
            }
        }

        $expectedLen = count($order);
        if (count($instance) !== $expectedLen) {
            $this->addError("Tuple at {$path} length " . count($instance) . " does not equal expected {$expectedLen}", $path, ErrorCodes::INSTANCE_TUPLE_LENGTH_MISMATCH);
        } else {
            foreach ($order as $idx => $propName) {
                if (isset($props[$propName])) {
                    $propSchema = $props[$propName];
                    $this->validateInstance($instance[$idx], $propSchema, "{$path}/{$propName}", $depth + 1);
                }
            }
        }
    }

    private function validateChoice(mixed $instance, array $schema, string $path, int $depth): void
    {
        if (!is_array($instance) || array_is_list($instance)) {
            $this->addError("Expected choice object at {$path}, got " . gettype($instance), $path, ErrorCodes::INSTANCE_CHOICE_EXPECTED);
            return;
        }

        $choices = $schema['choices'] ?? [];
        $extends = $schema['$extends'] ?? null;
        $selector = $schema['selector'] ?? null;

        if ($extends === null) {
            // Tagged union: exactly one property matching a choice key
            if (count($instance) !== 1) {
                $this->addError("Tagged union at {$path} must have a single property", $path);
                return;
            }

            $key = array_key_first($instance);
            $value = $instance[$key];

            if (!isset($choices[$key])) {
                $this->addError("Property '{$key}' at {$path} not one of choices " . json_encode(array_keys($choices)), $path, ErrorCodes::INSTANCE_CHOICE_UNKNOWN);
            } else {
                $this->validateInstance($value, $choices[$key], "{$path}/{$key}", $depth + 1);
            }
        } else {
            // Inline union: must have selector property
            if ($selector === null) {
                $this->addError("Inline union at {$path} missing 'selector' in schema", $path, ErrorCodes::INSTANCE_CHOICE_SELECTOR_MISSING);
                return;
            }

            $selVal = $instance[$selector] ?? null;
            if (!is_string($selVal)) {
                $this->addError("Selector '{$selector}' at {$path} must be a string", $path, ErrorCodes::INSTANCE_CHOICE_SELECTOR_NOT_STRING);
                return;
            }

            if (!isset($choices[$selVal])) {
                $this->addError("Selector '{$selVal}' at {$path} not one of choices " . json_encode(array_keys($choices)), $path, ErrorCodes::INSTANCE_CHOICE_UNKNOWN);
                return;
            }

            // Validate remaining properties against chosen variant
            $instCopy = $instance;
            unset($instCopy[$selector]);
            $this->validateInstance($instCopy, $choices[$selVal], $path, $depth + 1);
        }
    }

    private function validateConditionals(array $schema, mixed $instance, string $path): void
    {
        // allOf
        if (isset($schema['allOf'])) {
            $subschemas = $schema['allOf'];
            foreach ($subschemas as $idx => $subschema) {
                $this->validateInstance($instance, $subschema, "{$path}/allOf[{$idx}]");
            }
        }

        // anyOf
        if (isset($schema['anyOf'])) {
            $subschemas = $schema['anyOf'];
            $valid = false;
            $errorsAny = [];

            foreach ($subschemas as $idx => $subschema) {
                $backup = $this->errors;
                $this->errors = [];
                $this->validateInstance($instance, $subschema, "{$path}/anyOf[{$idx}]");

                if (count($this->errors) === 0) {
                    $valid = true;
                    $this->errors = $backup;
                    break;
                }
                foreach ($this->errors as $e) {
                    $errorsAny[] = "anyOf[{$idx}]: " . (string) $e;
                }
                $this->errors = $backup;
            }

            if (!$valid) {
                $this->addError("Instance at {$path} does not satisfy anyOf: " . implode(', ', $errorsAny), $path, ErrorCodes::INSTANCE_ANY_OF_NONE_MATCHED);
            }
        }

        // oneOf
        if (isset($schema['oneOf'])) {
            $subschemas = $schema['oneOf'];
            $validCount = 0;
            $errorsOne = [];

            foreach ($subschemas as $idx => $subschema) {
                $backup = $this->errors;
                $this->errors = [];
                $this->validateInstance($instance, $subschema, "{$path}/oneOf[{$idx}]");

                if (count($this->errors) === 0) {
                    $validCount++;
                } else {
                    foreach ($this->errors as $e) {
                        $errorsOne[] = "oneOf[{$idx}]: " . (string) $e;
                    }
                }
                $this->errors = $backup;
            }

            if ($validCount !== 1) {
                $this->addError("Instance at {$path} must match exactly one subschema in oneOf; matched {$validCount}", $path, ErrorCodes::INSTANCE_ONE_OF_INVALID_COUNT);
            }
        }

        // not
        if (isset($schema['not'])) {
            $subschema = $schema['not'];
            $backup = $this->errors;
            $this->errors = [];
            $this->validateInstance($instance, $subschema, "{$path}/not");

            if (count($this->errors) === 0) {
                $this->errors = $backup;
                $this->addError("Instance at {$path} should not validate against 'not' schema", $path, ErrorCodes::INSTANCE_NOT_MATCHED);
            } else {
                $this->errors = $backup;
            }
        }

        // if/then/else
        if (isset($schema['if'])) {
            $backup = $this->errors;
            $this->errors = [];
            $this->validateInstance($instance, $schema['if'], "{$path}/if");
            $ifValid = count($this->errors) === 0;
            $this->errors = $backup;

            if ($ifValid && isset($schema['then'])) {
                $this->validateInstance($instance, $schema['then'], "{$path}/then");
            } elseif (!$ifValid && isset($schema['else'])) {
                $this->validateInstance($instance, $schema['else'], "{$path}/else");
            }
        }
    }

    private function validateValidationAddins(array $schema, mixed $instance, string $path): void
    {
        $schemaType = $schema['type'] ?? null;

        // Numeric constraints
        if (is_string($schemaType) && Types::isNumericType($schemaType)) {
            if (is_int($instance) || is_float($instance)) {
                if (isset($schema['minimum']) && $instance < $schema['minimum']) {
                    $this->addError("Value at {$path} is less than minimum {$schema['minimum']}", $path, ErrorCodes::INSTANCE_NUMBER_MINIMUM);
                }
                if (isset($schema['maximum']) && $instance > $schema['maximum']) {
                    $this->addError("Value at {$path} is greater than maximum {$schema['maximum']}", $path, ErrorCodes::INSTANCE_NUMBER_MAXIMUM);
                }
                if (isset($schema['exclusiveMinimum'])) {
                    $exclMin = $schema['exclusiveMinimum'];
                    if (!is_bool($exclMin) && $instance <= $exclMin) {
                        $this->addError("Value at {$path} is not greater than exclusive minimum {$exclMin}", $path, ErrorCodes::INSTANCE_NUMBER_EXCLUSIVE_MINIMUM);
                    }
                }
                if (isset($schema['exclusiveMaximum'])) {
                    $exclMax = $schema['exclusiveMaximum'];
                    if (!is_bool($exclMax) && $instance >= $exclMax) {
                        $this->addError("Value at {$path} is not less than exclusive maximum {$exclMax}", $path, ErrorCodes::INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM);
                    }
                }
                if (isset($schema['multipleOf'])) {
                    $multipleOf = $schema['multipleOf'];
                    $quotient = $instance / $multipleOf;
                    if (abs($quotient - round($quotient)) > 1e-10) {
                        $this->addError("Value at {$path} is not a multiple of {$multipleOf}", $path, ErrorCodes::INSTANCE_NUMBER_MULTIPLE_OF);
                    }
                }
            }
        }

        // String constraints
        if ($schemaType === 'string' && is_string($instance)) {
            if (isset($schema['minLength']) && mb_strlen($instance) < $schema['minLength']) {
                $this->addError("String at {$path} shorter than minLength {$schema['minLength']}", $path, ErrorCodes::INSTANCE_STRING_MIN_LENGTH);
            }
            if (isset($schema['maxLength']) && mb_strlen($instance) > $schema['maxLength']) {
                $this->addError("String at {$path} exceeds maxLength {$schema['maxLength']}", $path, ErrorCodes::INSTANCE_STRING_MAX_LENGTH);
            }
            if (isset($schema['pattern'])) {
                $pattern = $schema['pattern'];
                if (@preg_match("/{$pattern}/", $instance) !== 1) {
                    $this->addError("String at {$path} does not match pattern {$pattern}", $path, ErrorCodes::INSTANCE_STRING_PATTERN_MISMATCH);
                }
            }
            if (isset($schema['format'])) {
                $this->validateFormat($instance, $schema['format'], $path);
            }
        }

        // Array constraints
        if (in_array($schemaType, ['array', 'set'], true) && is_array($instance)) {
            if (isset($schema['minItems']) && count($instance) < $schema['minItems']) {
                $this->addError("Array at {$path} has fewer items than minItems {$schema['minItems']}", $path, ErrorCodes::INSTANCE_MIN_ITEMS);
            }
            if (isset($schema['maxItems']) && count($instance) > $schema['maxItems']) {
                $this->addError("Array at {$path} has more items than maxItems {$schema['maxItems']}", $path, ErrorCodes::INSTANCE_MAX_ITEMS);
            }
            if (($schema['uniqueItems'] ?? false) === true) {
                $serialized = array_map(fn($x) => json_encode($x, JSON_THROW_ON_ERROR), $instance);
                if (count($serialized) !== count(array_unique($serialized))) {
                    $this->addError("Array at {$path} does not have unique items", $path, ErrorCodes::INSTANCE_SET_DUPLICATE);
                }
            }

            // contains validation
            if (isset($schema['contains'])) {
                $containsSchema = $schema['contains'];
                $matches = [];

                foreach ($instance as $i => $item) {
                    $tempErrors = $this->errors;
                    $this->errors = [];
                    $this->validateInstance($item, $containsSchema, "{$path}[{$i}]");
                    if (count($this->errors) === 0) {
                        $matches[] = $i;
                    }
                    $this->errors = $tempErrors;
                }

                if (count($matches) === 0) {
                    $this->addError("Array at {$path} does not contain required element", $path, ErrorCodes::INSTANCE_MIN_CONTAINS);
                }

                if (isset($schema['minContains']) && count($matches) < $schema['minContains']) {
                    $this->addError("Array at {$path} contains fewer than minContains {$schema['minContains']} matching elements", $path, ErrorCodes::INSTANCE_MIN_CONTAINS);
                }

                if (isset($schema['maxContains']) && count($matches) > $schema['maxContains']) {
                    $this->addError("Array at {$path} contains more than maxContains {$schema['maxContains']} matching elements", $path, ErrorCodes::INSTANCE_MAX_CONTAINS);
                }
            }
        }

        // Object constraints
        if ($schemaType === 'object' && is_array($instance) && !array_is_list($instance)) {
            if (isset($schema['minProperties']) && count($instance) < $schema['minProperties']) {
                $this->addError("Object at {$path} has fewer properties than minProperties {$schema['minProperties']}", $path, ErrorCodes::INSTANCE_MIN_PROPERTIES);
            }
            if (isset($schema['maxProperties']) && count($instance) > $schema['maxProperties']) {
                $this->addError("Object at {$path} has more properties than maxProperties {$schema['maxProperties']}", $path, ErrorCodes::INSTANCE_MAX_PROPERTIES);
            }
        }

        // Map constraints
        if ($schemaType === 'map' && is_array($instance) && !array_is_list($instance)) {
            if (isset($schema['minEntries']) && count($instance) < $schema['minEntries']) {
                $this->addError("Map at {$path} has fewer than minEntries {$schema['minEntries']}", $path, ErrorCodes::INSTANCE_MAP_MIN_ENTRIES);
            }
            if (isset($schema['maxEntries']) && count($instance) > $schema['maxEntries']) {
                $this->addError("Map at {$path} has more than maxEntries {$schema['maxEntries']}", $path, ErrorCodes::INSTANCE_MAP_MAX_ENTRIES);
            }

            // keyNames validation
            if (isset($schema['keyNames'])) {
                $keyNamesSchema = $schema['keyNames'];
                foreach (array_keys($instance) as $keyName) {
                    $tempErrors = $this->errors;
                    $this->errors = [];
                    $this->validateInstance($keyName, $keyNamesSchema, "{$path}/keyName({$keyName})");
                    if (count($this->errors) > 0) {
                        $this->errors = $tempErrors;
                        $this->addError("Map key name '{$keyName}' at {$path} does not match keyNames constraint", $path, ErrorCodes::INSTANCE_MAP_KEY_INVALID);
                    } else {
                        $this->errors = $tempErrors;
                    }
                }
            }
        }
    }

    private function validateFormat(string $instance, string $format, string $path): void
    {
        switch ($format) {
            case 'email':
                if (filter_var($instance, FILTER_VALIDATE_EMAIL) === false) {
                    $this->addError("String at {$path} does not match format email", $path, ErrorCodes::INSTANCE_FORMAT_EMAIL_INVALID);
                }
                break;

            case 'ipv4':
                if (filter_var($instance, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
                    $this->addError("String at {$path} does not match format ipv4", $path, ErrorCodes::INSTANCE_FORMAT_IPV4_INVALID);
                }
                break;

            case 'ipv6':
                if (filter_var($instance, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
                    $this->addError("String at {$path} does not match format ipv6", $path, ErrorCodes::INSTANCE_FORMAT_IPV6_INVALID);
                }
                break;

            case 'uri':
                if (filter_var($instance, FILTER_VALIDATE_URL) === false) {
                    $this->addError("String at {$path} does not match format uri", $path, ErrorCodes::INSTANCE_FORMAT_URI_INVALID);
                }
                break;

            case 'hostname':
                if (!preg_match('/^[a-zA-Z0-9.-]+$/', $instance)) {
                    $this->addError("String at {$path} does not match format hostname", $path, ErrorCodes::INSTANCE_FORMAT_HOSTNAME_INVALID);
                }
                break;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function resolveRef(string $ref): ?array
    {
        if (!str_starts_with($ref, '#')) {
            return null;
        }

        $parts = explode('/', ltrim($ref, '#'));
        $target = $this->rootSchema;

        foreach ($parts as $part) {
            if ($part === '') {
                continue;
            }
            $part = str_replace('~1', '/', $part);
            $part = str_replace('~0', '~', $part);

            if (is_array($target) && array_key_exists($part, $target)) {
                $target = $target[$part];
            } else {
                return null;
            }
        }

        return is_array($target) ? $target : null;
    }

    private function addError(string $message, string $path, string $code = ErrorCodes::SCHEMA_ERROR): void
    {
        $this->errors[] = new ValidationError(
            code: $code,
            message: $message,
            path: $path,
            severity: ValidationSeverity::ERROR
        );
    }
}
