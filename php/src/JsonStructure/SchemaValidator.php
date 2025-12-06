<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Validates JSON Structure Core documents for conformance with the specification.
 */
class SchemaValidator
{
    private const ABSOLUTE_URI_REGEX = '/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//';
    private const IDENTIFIER_REGEX = '/^[A-Za-z_][A-Za-z0-9_]*$/';
    private const IDENTIFIER_WITH_DOLLAR_REGEX = '/^[A-Za-z_$][A-Za-z0-9_$]*$/';

    /** @var ValidationError[] */
    private array $errors = [];

    /** @var ValidationError[] */
    private array $warnings = [];

    private mixed $doc = null;
    private ?string $sourceText = null;
    private ?JsonSourceLocator $sourceLocator = null;

    /** @var string[] */
    private array $seenExtends = [];

    /** @var string[] */
    private array $enabledExtensions = [];

    private bool $extended;
    private bool $allowDollar;
    private bool $warnOnUnusedExtensionKeywords;
    private int $maxValidationDepth;

    public function __construct(
        bool $allowDollar = false,
        bool $extended = false,
        bool $warnOnUnusedExtensionKeywords = true,
        int $maxValidationDepth = 64
    ) {
        $this->allowDollar = $allowDollar;
        $this->extended = $extended;
        $this->warnOnUnusedExtensionKeywords = $warnOnUnusedExtensionKeywords;
        $this->maxValidationDepth = $maxValidationDepth;
    }

    /**
     * Validates a JSON Structure schema document.
     *
     * @param array<string, mixed> $doc The parsed JSON Structure document
     * @param string|null $sourceText Original JSON text for line/column tracking
     * @return ValidationError[] List of validation errors
     */
    public function validate(array|bool|null $doc, ?string $sourceText = null): array
    {
        $this->errors = [];
        $this->warnings = [];
        $this->doc = $doc;
        $this->sourceText = $sourceText;
        $this->seenExtends = [];
        $this->enabledExtensions = [];

        if ($sourceText !== null) {
            $this->sourceLocator = new JsonSourceLocator($sourceText);
        } else {
            $this->sourceLocator = null;
        }

        if (!is_array($doc)) {
            $this->addError('Root of the document must be a JSON object.', '#', ErrorCodes::SCHEMA_INVALID_TYPE);
            return $this->errors;
        }

        // Check which extensions are enabled
        if ($this->extended) {
            $this->checkEnabledExtensions($doc);
        }

        $this->checkRequiredTopLevelKeywords($doc, '#');

        if (isset($doc['$schema'])) {
            $this->checkIsAbsoluteUri($doc['$schema'], '$schema', '#/$schema');
        }

        if (isset($doc['$id'])) {
            $this->checkIsAbsoluteUri($doc['$id'], '$id', '#/$id');
        }

        if (isset($doc['$uses'])) {
            $this->checkUses($doc['$uses'], '#/$uses');
        }

        if (isset($doc['type']) && isset($doc['$root'])) {
            $this->addError("Document cannot have both 'type' at root and '\$root' at the same time.", '#', ErrorCodes::SCHEMA_ROOT_CONFLICT);
        }

        if (isset($doc['type'])) {
            $this->validateSchema($doc, true, '#');
        }

        if (isset($doc['$root'])) {
            $this->checkJsonPointer($doc['$root'], $this->doc, '#/$root');
        }

        if (isset($doc['definitions'])) {
            if (!is_array($doc['definitions'])) {
                $this->addError('definitions must be an object.', '#/definitions', ErrorCodes::SCHEMA_KEYWORD_INVALID_TYPE);
            } else {
                $this->validateNamespace($doc['definitions'], '#/definitions');
            }
        }

        if (isset($doc['$offers'])) {
            $this->checkOffers($doc['$offers'], '#/$offers');
        }

        // Check for composition keywords at root if no type is present
        if ($this->extended && !isset($doc['type'])) {
            $this->checkCompositionKeywords($doc, '#');
        }

        // Check that document has either 'type', '$root', or composition keywords at root
        $hasType = isset($doc['type']);
        $hasRoot = isset($doc['$root']);
        $hasComposition = $this->extended && $this->hasCompositionKeywords($doc);

        if (!$hasType && !$hasRoot && !$hasComposition) {
            $this->addError("Document must have 'type', '\$root', or composition keywords at root.", '#', ErrorCodes::SCHEMA_ROOT_MISSING_TYPE);
        }

        return $this->errors;
    }

    /**
     * Get warnings generated during validation.
     *
     * @return ValidationError[]
     */
    public function getWarnings(): array
    {
        return $this->warnings;
    }

    private function checkEnabledExtensions(array $doc): void
    {
        $schemaUri = $doc['$schema'] ?? '';
        $uses = $doc['$uses'] ?? [];

        // Check if using extended or validation meta-schema
        if (str_contains($schemaUri, 'extended') || str_contains($schemaUri, 'validation')) {
            if (str_contains($schemaUri, 'validation')) {
                $this->enabledExtensions[] = 'JSONStructureConditionalComposition';
                $this->enabledExtensions[] = 'JSONStructureValidation';
            }
        }

        // Check $uses array
        if (is_array($uses)) {
            foreach ($uses as $ext) {
                if (in_array($ext, Types::KNOWN_EXTENSIONS, true)) {
                    $this->enabledExtensions[] = $ext;
                }
            }
        }
    }

    private function checkUses(mixed $uses, string $path): void
    {
        if (!is_array($uses)) {
            $this->addError('$uses must be an array.', $path, ErrorCodes::SCHEMA_KEYWORD_INVALID_TYPE);
            return;
        }

        foreach ($uses as $idx => $ext) {
            if (!is_string($ext)) {
                $this->addError("\$uses[{$idx}] must be a string.", "{$path}[{$idx}]", ErrorCodes::SCHEMA_KEYWORD_INVALID_TYPE);
            } elseif ($this->extended && !in_array($ext, Types::KNOWN_EXTENSIONS, true)) {
                $this->addError("Unknown extension '{$ext}' in \$uses.", "{$path}[{$idx}]", ErrorCodes::SCHEMA_USES_UNKNOWN_EXTENSION);
            }
        }
    }

    private function checkRequiredTopLevelKeywords(array $obj, string $location): void
    {
        if (!isset($obj['$id'])) {
            $this->addError("Missing required '\$id' keyword at root.", $location, ErrorCodes::SCHEMA_ROOT_MISSING_ID);
        }

        // Root schema with 'type' must have 'name'
        if (isset($obj['type']) && !isset($obj['name'])) {
            $this->addError("Root schema with 'type' must have a 'name' property.", $location, ErrorCodes::SCHEMA_ROOT_MISSING_NAME);
        }
    }

    private function checkIsAbsoluteUri(mixed $value, string $keywordName, string $location): void
    {
        if (!is_string($value)) {
            $this->addError("'{$keywordName}' must be a string.", $location);
            return;
        }

        if (!preg_match(self::ABSOLUTE_URI_REGEX, $value)) {
            $this->addError("'{$keywordName}' must be an absolute URI.", $location);
        }
    }

    private function validateNamespace(array $obj, string $path): void
    {
        foreach ($obj as $k => $v) {
            $subpath = "{$path}/{$k}";

            if (is_array($v) && (isset($v['type']) || isset($v['$ref']) ||
                ($this->extended && $this->hasCompositionKeywords($v)))) {
                $this->validateSchema($v, false, $subpath, $k, $subpath);
            } else {
                if (!is_array($v)) {
                    $this->addError("{$subpath} is not a valid namespace or schema object.", $subpath);
                } else {
                    $this->validateNamespace($v, $subpath);
                }
            }
        }
    }

    private function hasCompositionKeywords(array $obj): bool
    {
        foreach (Types::COMPOSITION_KEYWORDS as $keyword) {
            if (isset($obj[$keyword])) {
                return true;
            }
        }
        return false;
    }

    private function validateSchema(
        array $schemaObj,
        bool $isRoot = false,
        string $path = '',
        ?string $nameInNamespace = null,
        ?string $definitionPath = null
    ): void {
        // Check composition keywords if extended validation is enabled
        if ($this->extended) {
            $this->checkCompositionKeywords($schemaObj, $path);
        }

        if ($isRoot && isset($schemaObj['type']) && !isset($schemaObj['name'])) {
            if (!is_array($schemaObj['type'])) {
                $this->addError("Root schema with 'type' must have a 'name' property.", $path);
            }
        }

        if (isset($schemaObj['name'])) {
            if (!is_string($schemaObj['name'])) {
                $this->addError("'name' must be a string.", $path . '/name');
            } else {
                $regex = $this->allowDollar ? self::IDENTIFIER_WITH_DOLLAR_REGEX : self::IDENTIFIER_REGEX;
                if (!preg_match($regex, $schemaObj['name'])) {
                    $this->addError("'name' must match the identifier pattern.", $path . '/name');
                }
            }
        }

        if (isset($schemaObj['abstract']) && !is_bool($schemaObj['abstract'])) {
            $this->addError("'abstract' keyword must be boolean.", $path . '/abstract');
        }

        if (isset($schemaObj['$extends'])) {
            $this->validateExtendsKeyword($schemaObj['$extends'], $path . '/$extends');
        }

        // Check for bare $ref - this is NOT permitted per spec Section 3.4.1
        if (isset($schemaObj['$ref'])) {
            $this->addError(
                "'\$ref' is only permitted inside the 'type' attribute. " .
                "Use { \"type\": { \"\$ref\": \"...\" } } instead of { \"\$ref\": \"...\" }",
                $path . '/$ref',
                ErrorCodes::SCHEMA_REF_NOT_IN_TYPE
            );
            return;
        }

        // Check if this is a non-schema with composition keywords
        $hasType = isset($schemaObj['type']);
        $hasComposition = $this->extended && $this->hasCompositionKeywords($schemaObj);

        if (!$hasType && !$hasComposition) {
            $this->addError("Missing required 'type' in schema object.", $path);
            return;
        }

        if (isset($schemaObj['type'])) {
            $tval = $schemaObj['type'];

            if (is_array($tval) && !array_is_list($tval)) {
                // Handle associative array as object (type reference with $ref)
                if (!isset($tval['$ref'])) {
                    if (isset($tval['type']) || isset($tval['properties'])) {
                        $this->validateSchema($tval, false, "{$path}/type(inline)");
                    } else {
                        $this->addError("Type dict must have '\$ref' or be a valid schema object.", $path . '/type');
                    }
                } else {
                    $ref = $tval['$ref'];
                    $this->checkJsonPointer($ref, $this->doc, $path . '/type/$ref');
                    // Check for circular self-reference
                    if (count($schemaObj) === 1 && count($tval) === 1 && $definitionPath !== null) {
                        if ($ref === $definitionPath) {
                            $this->addError("Circular reference detected: {$ref}", $path . '/type/$ref', ErrorCodes::SCHEMA_REF_CIRCULAR);
                            return;
                        }
                    }
                }
            } elseif (is_array($tval)) {
                // Handle list (type union)
                if (count($tval) === 0) {
                    $this->addError('Type union cannot be empty.', $path . '/type');
                } else {
                    foreach ($tval as $idx => $unionItem) {
                        $this->checkUnionTypeItem($unionItem, "{$path}/type[{$idx}]");
                    }
                }
            } else {
                if (!is_string($tval)) {
                    $this->addError('Type must be a string, list, or object with $ref.', $path . '/type');
                } else {
                    if (!Types::isValidType($tval)) {
                        $this->addError("Type '{$tval}' is not a recognized primitive or compound type.", $path . '/type');
                    } else {
                        switch ($tval) {
                            case 'any':
                                break;
                            case 'object':
                                $this->checkObjectSchema($schemaObj, $path);
                                break;
                            case 'array':
                                $this->checkArraySchema($schemaObj, $path);
                                break;
                            case 'set':
                                $this->checkSetSchema($schemaObj, $path);
                                break;
                            case 'map':
                                $this->checkMapSchema($schemaObj, $path);
                                break;
                            case 'tuple':
                                $this->checkTupleSchema($schemaObj, $path);
                                break;
                            case 'choice':
                                $this->checkChoiceSchema($schemaObj, $path);
                                break;
                            default:
                                $this->checkPrimitiveSchema($schemaObj, $path);
                                break;
                        }
                    }
                }
            }
        }

        // Extended validation checks
        if ($this->extended && isset($schemaObj['type'])) {
            $this->checkExtendedValidationKeywords($schemaObj, $path);
        }

        if (isset($schemaObj['required'])) {
            $reqVal = $schemaObj['required'];
            if (isset($schemaObj['type']) && is_string($schemaObj['type'])) {
                if ($schemaObj['type'] !== 'object') {
                    $this->addError("'required' can only appear in an object schema.", $path . '/required');
                }
            }

            if (!is_array($reqVal)) {
                $this->addError("'required' must be an array.", $path . '/required');
            } else {
                foreach ($reqVal as $idx => $item) {
                    if (!is_string($item)) {
                        $this->addError("'required[{$idx}]' must be a string.", "{$path}/required[{$idx}]");
                    }
                }
                // Check that required properties exist in properties
                if (isset($schemaObj['properties']) && is_array($schemaObj['properties'])) {
                    foreach ($reqVal as $idx => $item) {
                        if (is_string($item) && !isset($schemaObj['properties'][$item])) {
                            $this->addError("'required' references property '{$item}' that is not in 'properties'.", "{$path}/required[{$idx}]");
                        }
                    }
                }
            }
        }

        if (isset($schemaObj['additionalProperties'])) {
            if (isset($schemaObj['type']) && is_string($schemaObj['type'])) {
                if ($schemaObj['type'] !== 'object') {
                    $this->addError("'additionalProperties' can only appear in an object schema.", $path . '/additionalProperties');
                }
            }
        }

        if (isset($schemaObj['enum'])) {
            $enumVal = $schemaObj['enum'];
            if (!is_array($enumVal)) {
                $this->addError("'enum' must be an array.", $path . '/enum');
            } else {
                if (count($enumVal) === 0) {
                    $this->addError("'enum' array cannot be empty.", $path . '/enum');
                }
                // Check for duplicates
                $seen = [];
                foreach ($enumVal as $idx => $item) {
                    $itemStr = json_encode($item, JSON_THROW_ON_ERROR);
                    if (in_array($itemStr, $seen, true)) {
                        $this->addError("'enum' contains duplicate value at index {$idx}.", "{$path}/enum[{$idx}]");
                    }
                    $seen[] = $itemStr;
                }
            }

            if (isset($schemaObj['type']) && is_string($schemaObj['type'])) {
                if (Types::isCompoundType($schemaObj['type'])) {
                    $this->addError("'enum' cannot be used with compound types.", $path . '/enum');
                }
            }
        }

        if (isset($schemaObj['const'])) {
            if (isset($schemaObj['type']) && is_string($schemaObj['type'])) {
                if (Types::isCompoundType($schemaObj['type'])) {
                    $this->addError("'const' cannot be used with compound types.", $path . '/const');
                }
            }
        }
    }

    private function checkCompositionKeywords(array $obj, string $path): void
    {
        if (!$this->extended) {
            return;
        }

        // Check if conditional composition is enabled
        if (!in_array('JSONStructureConditionalComposition', $this->enabledExtensions, true)) {
            foreach (Types::COMPOSITION_KEYWORDS as $key) {
                if (isset($obj[$key])) {
                    $this->addError("Conditional composition keyword '{$key}' requires JSONStructureConditionalComposition extension.", "{$path}/{$key}");
                }
            }
            return;
        }

        // Validate allOf, anyOf, oneOf
        foreach (['allOf', 'anyOf', 'oneOf'] as $key) {
            if (isset($obj[$key])) {
                $val = $obj[$key];
                if (!is_array($val)) {
                    $this->addError("'{$key}' must be an array.", "{$path}/{$key}");
                } elseif (count($val) === 0) {
                    $this->addError("'{$key}' array cannot be empty.", "{$path}/{$key}");
                } else {
                    foreach ($val as $idx => $item) {
                        if (is_array($item)) {
                            $this->validateSchema($item, false, "{$path}/{$key}[{$idx}]");
                        } else {
                            $this->addError("'{$key}' array items must be schema objects.", "{$path}/{$key}[{$idx}]");
                        }
                    }
                }
            }
        }

        // Validate not
        if (isset($obj['not'])) {
            $val = $obj['not'];
            if (is_array($val)) {
                $this->validateSchema($val, false, "{$path}/not");
            } else {
                $this->addError("'not' must be a schema object.", "{$path}/not");
            }
        }

        // Validate if/then/else
        foreach (['if', 'then', 'else'] as $key) {
            if (isset($obj[$key])) {
                $val = $obj[$key];
                if (is_array($val)) {
                    $this->validateSchema($val, false, "{$path}/{$key}");
                } else {
                    $this->addError("'{$key}' must be a schema object.", "{$path}/{$key}");
                }
            }
        }
    }

    private function checkExtendedValidationKeywords(array $obj, string $path): void
    {
        $validationEnabled = in_array('JSONStructureValidation', $this->enabledExtensions, true);

        $tval = $obj['type'] ?? null;
        if (!is_string($tval)) {
            return;
        }

        // Check for constraint type mismatches
        $stringConstraints = ['minLength', 'maxLength', 'pattern'];
        $numericConstraints = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
        $arrayConstraints = ['minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains'];

        // Check string constraints on non-string types
        if ($tval !== 'string') {
            foreach ($stringConstraints as $key) {
                if (isset($obj[$key])) {
                    $this->addError("'{$key}' constraint is only valid for string type, not '{$tval}'.", "{$path}/{$key}");
                }
            }
        }

        // Check numeric constraints on non-numeric types
        if (!Types::isNumericType($tval)) {
            foreach ($numericConstraints as $key) {
                if (isset($obj[$key])) {
                    $this->addError("'{$key}' constraint is only valid for numeric types, not '{$tval}'.", "{$path}/{$key}");
                }
            }
        }

        // Check array constraints on non-array types
        if (!Types::isArrayType($tval)) {
            foreach ($arrayConstraints as $key) {
                if (isset($obj[$key])) {
                    $this->addError("'{$key}' constraint is only valid for array/set/tuple types, not '{$tval}'.", "{$path}/{$key}");
                }
            }
        }

        // Now validate the constraint values for matching types
        if (Types::isNumericType($tval)) {
            $this->checkNumericValidation($obj, $path, $tval, $validationEnabled);
        } elseif ($tval === 'string') {
            $this->checkStringValidation($obj, $path, $validationEnabled);
        } elseif (in_array($tval, ['array', 'set'], true)) {
            $this->checkArrayValidation($obj, $path, $tval, $validationEnabled);
        } elseif (Types::isObjectType($tval)) {
            $this->checkObjectValidation($obj, $path, $tval, $validationEnabled);
        }

        // Check default keyword
        if (isset($obj['default']) && !$validationEnabled) {
            $this->addExtensionKeywordWarning('default', $path);
        }
    }

    private function checkNumericValidation(array $obj, string $path, string $typeName, bool $validationEnabled): void
    {
        $expectsString = Types::isStringBasedNumericType($typeName);

        foreach (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as $key) {
            if (isset($obj[$key])) {
                if (!$validationEnabled) {
                    $this->addExtensionKeywordWarning($key, $path);
                }
                $val = $obj[$key];
                if ($expectsString) {
                    if (!is_string($val)) {
                        $this->addError("'{$key}' for type '{$typeName}' must be a string.", "{$path}/{$key}");
                    }
                } else {
                    if (!is_int($val) && !is_float($val)) {
                        $this->addError("'{$key}' must be a number.", "{$path}/{$key}");
                    } elseif ($key === 'multipleOf' && $val <= 0) {
                        $this->addError("'multipleOf' must be a positive number.", "{$path}/{$key}");
                    }
                }
            }
        }

        // Check minimum <= maximum
        if (isset($obj['minimum'], $obj['maximum'])) {
            $minVal = $obj['minimum'];
            $maxVal = $obj['maximum'];
            if ((is_int($minVal) || is_float($minVal)) && (is_int($maxVal) || is_float($maxVal))) {
                if ($minVal > $maxVal) {
                    $this->addError("'minimum' cannot be greater than 'maximum'.", $path);
                }
            }
        }
    }

    private function checkStringValidation(array $obj, string $path, bool $validationEnabled): void
    {
        if (isset($obj['minLength'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('minLength', $path);
            }
            $val = $obj['minLength'];
            if (!is_int($val) || $val < 0) {
                $this->addError("'minLength' must be a non-negative integer.", "{$path}/minLength");
            }
        }

        if (isset($obj['maxLength'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('maxLength', $path);
            }
            $val = $obj['maxLength'];
            if (!is_int($val) || $val < 0) {
                $this->addError("'maxLength' must be a non-negative integer.", "{$path}/maxLength");
            }
        }

        // Check minLength <= maxLength
        if (isset($obj['minLength'], $obj['maxLength'])) {
            $minVal = $obj['minLength'];
            $maxVal = $obj['maxLength'];
            if (is_int($minVal) && is_int($maxVal) && $minVal > $maxVal) {
                $this->addError("'minLength' cannot be greater than 'maxLength'.", $path);
            }
        }

        if (isset($obj['pattern'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('pattern', $path);
            }
            $val = $obj['pattern'];
            if (!is_string($val)) {
                $this->addError("'pattern' must be a string.", "{$path}/pattern");
            } else {
                // Try to compile the regex
                if (@preg_match("/{$val}/", '') === false) {
                    $this->addError("'pattern' is not a valid regular expression: " . preg_last_error_msg(), "{$path}/pattern");
                }
            }
        }

        if (isset($obj['format'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('format', $path);
            }
            $val = $obj['format'];
            if (!is_string($val)) {
                $this->addError("'format' must be a string.", "{$path}/format");
            } elseif (!in_array($val, Types::VALID_FORMATS, true)) {
                $this->addError("Unknown format '{$val}'.", "{$path}/format");
            }
        }

        foreach (['contentEncoding', 'contentMediaType'] as $key) {
            if (isset($obj[$key])) {
                if (!$validationEnabled) {
                    $this->addExtensionKeywordWarning($key, $path);
                }
                $val = $obj[$key];
                if (!is_string($val)) {
                    $this->addError("'{$key}' must be a string.", "{$path}/{$key}");
                }
            }
        }
    }

    private function checkArrayValidation(array $obj, string $path, string $typeName, bool $validationEnabled): void
    {
        foreach (['minItems', 'maxItems'] as $key) {
            if (isset($obj[$key])) {
                if (!$validationEnabled) {
                    $this->addExtensionKeywordWarning($key, $path);
                }
                $val = $obj[$key];
                if (!is_int($val) || $val < 0) {
                    $this->addError("'{$key}' must be a non-negative integer.", "{$path}/{$key}");
                }
            }
        }

        // Check minItems <= maxItems
        if (isset($obj['minItems'], $obj['maxItems'])) {
            $minVal = $obj['minItems'];
            $maxVal = $obj['maxItems'];
            if (is_int($minVal) && is_int($maxVal) && $minVal > $maxVal) {
                $this->addError("'minItems' cannot be greater than 'maxItems'.", $path);
            }
        }

        if (isset($obj['uniqueItems'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('uniqueItems', $path);
            }
            $val = $obj['uniqueItems'];
            if (!is_bool($val)) {
                $this->addError("'uniqueItems' must be a boolean.", "{$path}/uniqueItems");
            } elseif ($typeName === 'set' && $val === false) {
                $this->addError("'uniqueItems' cannot be false for 'set' type.", "{$path}/uniqueItems");
            }
        }

        if (isset($obj['contains'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('contains', $path);
            }
            $val = $obj['contains'];
            if (is_array($val)) {
                $this->validateSchema($val, false, "{$path}/contains");
            } else {
                $this->addError("'contains' must be a schema object.", "{$path}/contains");
            }
        }

        foreach (['minContains', 'maxContains'] as $key) {
            if (isset($obj[$key])) {
                if (!$validationEnabled) {
                    $this->addExtensionKeywordWarning($key, $path);
                }
                $val = $obj[$key];
                if (!is_int($val) || $val < 0) {
                    $this->addError("'{$key}' must be a non-negative integer.", "{$path}/{$key}");
                }
                if (!isset($obj['contains'])) {
                    $this->addError("'{$key}' requires 'contains' to be present.", "{$path}/{$key}");
                }
            }
        }
    }

    private function checkObjectValidation(array $obj, string $path, string $typeName, bool $validationEnabled): void
    {
        $minKey = $typeName === 'map' ? 'minEntries' : 'minProperties';
        $maxKey = $typeName === 'map' ? 'maxEntries' : 'maxProperties';

        foreach ([$minKey, $maxKey, 'minProperties', 'maxProperties', 'minEntries', 'maxEntries'] as $key) {
            if (isset($obj[$key])) {
                if (!$validationEnabled) {
                    $this->addExtensionKeywordWarning($key, $path);
                }
                // Check if using the right keyword for the type
                if ($typeName === 'map' && in_array($key, ['minProperties', 'maxProperties'], true)) {
                    $replacement = str_replace('Properties', 'Entries', $key);
                    $this->addError("Use '{$replacement}' for map type instead of '{$key}'.", "{$path}/{$key}");
                } elseif ($typeName === 'object' && in_array($key, ['minEntries', 'maxEntries'], true)) {
                    $replacement = str_replace('Entries', 'Properties', $key);
                    $this->addError("Use '{$replacement}' for object type instead of '{$key}'.", "{$path}/{$key}");
                }

                $val = $obj[$key];
                if (!is_int($val) || $val < 0) {
                    $this->addError("'{$key}' must be a non-negative integer.", "{$path}/{$key}");
                }
            }
        }

        if (isset($obj['dependentRequired'])) {
            if (!$validationEnabled) {
                $this->addExtensionKeywordWarning('dependentRequired', $path);
            }
            if ($typeName !== 'object') {
                $this->addError("'dependentRequired' only applies to object type.", "{$path}/dependentRequired");
            } else {
                $val = $obj['dependentRequired'];
                if (!is_array($val)) {
                    $this->addError("'dependentRequired' must be an object.", "{$path}/dependentRequired");
                } else {
                    foreach ($val as $prop => $deps) {
                        if (!is_array($deps)) {
                            $this->addError("'dependentRequired/{$prop}' must be an array.", "{$path}/dependentRequired/{$prop}");
                        } else {
                            foreach ($deps as $idx => $dep) {
                                if (!is_string($dep)) {
                                    $this->addError("'dependentRequired/{$prop}[{$idx}]' must be a string.", "{$path}/dependentRequired/{$prop}[{$idx}]");
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private function checkUnionTypeItem(mixed $unionItem, string $path): void
    {
        if (is_string($unionItem)) {
            if (!Types::isValidType($unionItem)) {
                $this->addError("'{$unionItem}' not recognized as a valid type name.", $path);
            }
            if (Types::isCompoundType($unionItem)) {
                $this->addError("Inline compound type '{$unionItem}' is not permitted in a union. Must use a \$ref.", $path);
            }
        } elseif (is_array($unionItem)) {
            if (!isset($unionItem['$ref'])) {
                $this->addError('Inline compound definitions not allowed in union. Must be a $ref.', $path);
            } else {
                $this->checkJsonPointer($unionItem['$ref'], $this->doc, $path . '/$ref');
            }
        } else {
            $this->addError('Union item must be a string or an object with $ref.', $path);
        }
    }

    private function checkObjectSchema(array $obj, string $path): void
    {
        if (!isset($obj['properties']) && !isset($obj['$extends'])) {
            $this->addError("Object type must have 'properties' if not extending another type.", $path . '/properties');
        } elseif (isset($obj['properties'])) {
            $props = $obj['properties'];
            if (!is_array($props)) {
                $this->addError('Properties must be an object.', $path . '/properties');
            } else {
                $regex = $this->allowDollar ? self::IDENTIFIER_WITH_DOLLAR_REGEX : self::IDENTIFIER_REGEX;
                foreach ($props as $propName => $propSchema) {
                    if (!preg_match($regex, (string) $propName)) {
                        $this->addError("Property key '{$propName}' does not match the identifier pattern.", "{$path}/properties/{$propName}");
                    }
                    if (is_array($propSchema)) {
                        $this->validateSchema($propSchema, false, "{$path}/properties/{$propName}");
                    } else {
                        $this->addError("Property '{$propName}' must be an object (a schema).", "{$path}/properties/{$propName}");
                    }
                }
            }
        }
    }

    private function checkArraySchema(array $obj, string $path): void
    {
        if (!isset($obj['items'])) {
            $this->addError("Array type must have 'items'.", $path . '/items');
        } else {
            $itemsSchema = $obj['items'];
            if (!is_array($itemsSchema)) {
                $this->addError("'items' must be an object (a schema).", $path . '/items');
            } else {
                $this->validateSchema($itemsSchema, false, $path . '/items');
            }
        }
    }

    private function checkSetSchema(array $obj, string $path): void
    {
        if (!isset($obj['items'])) {
            $this->addError("Set type must have 'items'.", $path . '/items');
        } else {
            $itemsSchema = $obj['items'];
            if (!is_array($itemsSchema)) {
                $this->addError("'items' must be an object (a schema).", $path . '/items');
            } else {
                $this->validateSchema($itemsSchema, false, $path . '/items');
            }
        }
    }

    private function checkMapSchema(array $obj, string $path): void
    {
        if (!isset($obj['values'])) {
            $this->addError("Map type must have 'values'.", $path . '/values');
        } else {
            $valuesSchema = $obj['values'];
            if (!is_array($valuesSchema)) {
                $this->addError("'values' must be an object (a schema).", $path . '/values');
            } else {
                $this->validateSchema($valuesSchema, false, $path . '/values');
            }
        }
    }

    private function checkTupleSchema(array $obj, string $path): void
    {
        // Check that 'name' is present
        if (!isset($obj['name'])) {
            $this->addError("Tuple type must include a 'name' attribute.", $path . '/name');
        }

        // Validate properties
        if (!isset($obj['properties'])) {
            $this->addError("Tuple type must have 'properties'.", $path . '/properties');
        } else {
            $props = $obj['properties'];
            if (!is_array($props)) {
                $this->addError("'properties' must be an object.", $path . '/properties');
            } else {
                $regex = $this->allowDollar ? self::IDENTIFIER_WITH_DOLLAR_REGEX : self::IDENTIFIER_REGEX;
                foreach ($props as $propName => $propSchema) {
                    if (!preg_match($regex, (string) $propName)) {
                        $this->addError("Tuple property key '{$propName}' does not match the identifier pattern.", "{$path}/properties/{$propName}");
                    }
                    if (is_array($propSchema)) {
                        $this->validateSchema($propSchema, false, "{$path}/properties/{$propName}");
                    } else {
                        $this->addError("Tuple property '{$propName}' must be an object (a schema).", "{$path}/properties/{$propName}");
                    }
                }
            }
        }

        // Check that the 'tuple' keyword is present
        if (!isset($obj['tuple'])) {
            $this->addError("Tuple type must include the 'tuple' keyword defining the order of elements.", $path . '/tuple');
        } else {
            $tupleOrder = $obj['tuple'];
            if (!is_array($tupleOrder)) {
                $this->addError("'tuple' keyword must be an array of strings.", $path . '/tuple');
            } else {
                foreach ($tupleOrder as $idx => $element) {
                    if (!is_string($element)) {
                        $this->addError("Element at index {$idx} in 'tuple' array must be a string.", "{$path}/tuple[{$idx}]");
                    } elseif (isset($obj['properties']) && is_array($obj['properties']) && !isset($obj['properties'][$element])) {
                        $this->addError("Element '{$element}' in 'tuple' does not correspond to any property in 'properties'.", "{$path}/tuple[{$idx}]");
                    }
                }
            }
        }
    }

    private function checkChoiceSchema(array $obj, string $path): void
    {
        if (!isset($obj['choices'])) {
            $this->addError("Choice type must have 'choices'.", $path . '/choices');
        } else {
            $choices = $obj['choices'];
            if (!is_array($choices)) {
                $this->addError("'choices' must be an object (map).", $path . '/choices');
            } else {
                foreach ($choices as $name => $choiceSchema) {
                    if (!is_string($name)) {
                        $this->addError("Choice key '{$name}' must be a string.", "{$path}/choices/{$name}");
                    }
                    if (is_array($choiceSchema)) {
                        $this->validateSchema($choiceSchema, false, "{$path}/choices/{$name}");
                    } else {
                        $this->addError("Choice value for '{$name}' must be an object (schema).", "{$path}/choices/{$name}");
                    }
                }
            }
        }

        if (isset($obj['selector']) && !is_string($obj['selector'])) {
            $this->addError("'selector' must be a string.", $path . '/selector');
        }
    }

    private function checkPrimitiveSchema(array $obj, string $path): void
    {
        // Additional annotation checks can be added here
    }

    private function checkJsonPointer(mixed $pointer, mixed $doc, string $path): void
    {
        if (!is_string($pointer)) {
            $this->addError('JSON Pointer must be a string.', $path);
            return;
        }

        if (!str_starts_with($pointer, '#')) {
            $this->addError("JSON Pointer must start with '#' when referencing the same document.", $path);
            return;
        }

        $parts = explode('/', $pointer);
        $cur = $doc;

        if ($pointer === '#') {
            return;
        }

        foreach ($parts as $i => $p) {
            if ($i === 0) {
                continue;
            }
            $p = str_replace('~1', '/', $p);
            $p = str_replace('~0', '~', $p);

            if (is_array($cur)) {
                if (array_key_exists($p, $cur)) {
                    $cur = $cur[$p];
                } else {
                    $this->addError("JSON Pointer segment '/{$p}' not found.", $path);
                    return;
                }
            } else {
                $this->addError("JSON Pointer segment '/{$p}' not applicable to non-object.", $path);
                return;
            }
        }
    }

    private function validateExtendsKeyword(mixed $extendsValue, string $path): void
    {
        $refs = [];

        if (is_string($extendsValue)) {
            $refs[] = [$extendsValue, $path];
        } elseif (is_array($extendsValue)) {
            foreach ($extendsValue as $i => $item) {
                if (!is_string($item)) {
                    $this->addError("'\$extends' array element must be a JSON pointer string.", "{$path}[{$i}]");
                } else {
                    $refs[] = [$item, "{$path}[{$i}]"];
                }
            }
        } else {
            $this->addError("'\$extends' must be a JSON pointer string or an array of JSON pointer strings.", $path);
            return;
        }

        foreach ($refs as [$ref, $refPath]) {
            if (!str_starts_with($ref, '#')) {
                continue; // External references handled elsewhere
            }

            // Check for circular $extends
            if (in_array($ref, $this->seenExtends, true)) {
                $this->addError("Circular \$extends reference detected: {$ref}", $refPath, ErrorCodes::SCHEMA_EXTENDS_CIRCULAR);
                continue;
            }

            $this->seenExtends[] = $ref;

            // Resolve the reference and check if it has $extends
            $resolved = $this->resolveJsonPointer($ref);
            if ($resolved === null) {
                $this->addError("\$extends reference '{$ref}' not found.", $refPath, ErrorCodes::SCHEMA_EXTENDS_NOT_FOUND);
            } elseif (is_array($resolved) && isset($resolved['$extends'])) {
                // Recursively validate the extended schema's $extends
                $this->validateExtendsKeyword($resolved['$extends'], $refPath);
            }

            $this->seenExtends = array_diff($this->seenExtends, [$ref]);
        }
    }

    private function resolveJsonPointer(string $pointer): mixed
    {
        if (!is_string($pointer) || !str_starts_with($pointer, '#')) {
            return null;
        }

        if ($pointer === '#') {
            return $this->doc;
        }

        $parts = explode('/', $pointer);
        $cur = $this->doc;

        foreach ($parts as $i => $p) {
            if ($i === 0) {
                continue;
            }
            $p = str_replace('~1', '/', $p);
            $p = str_replace('~0', '~', $p);

            if (is_array($cur) && array_key_exists($p, $cur)) {
                $cur = $cur[$p];
            } else {
                return null;
            }
        }

        return $cur;
    }

    private function checkOffers(mixed $offers, string $path): void
    {
        if (!is_array($offers)) {
            $this->addError('$offers must be an object.', $path);
            return;
        }

        foreach ($offers as $addinName => $addinVal) {
            if (!is_string($addinName)) {
                $this->addError('$offers keys must be strings.', $path);
            }

            if (is_string($addinVal)) {
                $this->checkJsonPointer($addinVal, $this->doc, "{$path}/{$addinName}");
            } elseif (is_array($addinVal)) {
                foreach ($addinVal as $idx => $pointer) {
                    if (!is_string($pointer)) {
                        $this->addError("\$offers/{$addinName}[{$idx}] must be a string (JSON Pointer).", "{$path}/{$addinName}[{$idx}]");
                    } else {
                        $this->checkJsonPointer($pointer, $this->doc, "{$path}/{$addinName}[{$idx}]");
                    }
                }
            } else {
                $this->addError("\$offers/{$addinName} must be a string or array of strings.", "{$path}/{$addinName}");
            }
        }
    }

    private function addError(string $message, string $location = '#', string $code = ErrorCodes::SCHEMA_ERROR): void
    {
        $loc = $this->sourceLocator?->getLocation($location) ?? JsonLocation::unknown();

        $this->errors[] = new ValidationError(
            code: $code,
            message: $message,
            path: $location,
            severity: ValidationSeverity::ERROR,
            location: $loc
        );
    }

    private function addWarning(string $message, string $location = '#', string $code = ErrorCodes::SCHEMA_ERROR): void
    {
        $loc = $this->sourceLocator?->getLocation($location) ?? JsonLocation::unknown();

        $this->warnings[] = new ValidationError(
            code: $code,
            message: $message,
            path: $location,
            severity: ValidationSeverity::WARNING,
            location: $loc
        );
    }

    private function addExtensionKeywordWarning(string $keyword, string $path): void
    {
        if (!$this->warnOnUnusedExtensionKeywords) {
            return;
        }

        if (in_array('JSONStructureValidation', $this->enabledExtensions, true)) {
            return;
        }

        $allValidationKeywords = array_merge(
            Types::NUMERIC_VALIDATION_KEYWORDS,
            Types::STRING_VALIDATION_KEYWORDS,
            Types::ARRAY_VALIDATION_KEYWORDS,
            Types::OBJECT_VALIDATION_KEYWORDS
        );

        if (!in_array($keyword, $allValidationKeywords, true)) {
            return;
        }

        $fullPath = $path !== '' ? "{$path}/{$keyword}" : $keyword;
        $this->addWarning(
            "Validation extension keyword '{$keyword}' is used but validation extensions are not enabled. " .
            "Add '\"\$uses\": [\"JSONStructureValidation\"]' to enable validation, or this keyword will be ignored.",
            $fullPath,
            ErrorCodes::SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED
        );
    }
}
