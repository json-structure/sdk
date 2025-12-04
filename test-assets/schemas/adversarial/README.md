# Adversarial Test Assets

This directory contains adversarial test cases designed to stress-test JSON Structure SDK implementations for potential bugs, including:

- **Infinite loops** (circular references, deep recursion)
- **Crashes/Exceptions** (malformed input, edge cases)
- **Performance issues** (ReDoS, quadratic blowup)
- **Incorrect validation results** (ambiguous schemas, conflicting constraints)

## Schema Categories

### Recursion and Reference Tests
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `deep-nesting-100.struct.json` | 20 levels of nested objects | Should validate without stack overflow |
| `indirect-circular-ref.struct.json` | A→B→C→A cycle | Should detect and report circular reference |
| `self-referencing-extends.struct.json` | Type extends itself | Should detect infinite loop in $extends |
| `extends-circular-chain.struct.json` | Circular $extends chain | Should detect and report circular $extends |
| `recursive-array-items.struct.json` | Tree structure with self-referencing items | Should handle gracefully without infinite recursion |
| `quadratic-blowup.struct.json` | Multiple refs to same deep chain | Should resolve efficiently without O(n²) behavior |

### Regular Expression Tests
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `redos-pattern.struct.json` | ReDoS pattern `^(a+)+$` | Should timeout or have protection |
| `redos-catastrophic-backtracking.struct.json` | Aggressive ReDoS `^([a-zA-Z0-9]+)*$` | Should timeout or have protection |
| `pattern-with-flags.struct.json` | Non-portable regex flags | Should handle gracefully |

### Type Composition Tests
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `allof-conflicting-types.struct.json` | allOf with incompatible types (string AND int32) | Should detect unsatisfiable constraint |
| `oneof-all-match.struct.json` | oneOf where all branches match | Should fail validation (oneOf requires exactly one match) |
| `anyof-none-match.struct.json` | anyOf where no branch matches | Should fail validation |
| `deeply-nested-allof.struct.json` | Exponential complexity composition | Should complete in reasonable time |
| `type-union-ambiguous.struct.json` | Ambiguous type unions | Should use consistent first-match semantics |

### Numeric Edge Cases
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `integer-boundary-values.struct.json` | Type limits (int8, int16, int32, int64) | Should correctly validate boundary values |
| `int64-precision-loss.struct.json` | Values beyond JS Number.MAX_SAFE_INTEGER | Language-specific; should handle or warn |
| `floating-point-precision.struct.json` | IEEE754 edge cases | Should handle denormalized, -0.0, precision loss |
| `conflicting-constraints.struct.json` | min > max, minLength > maxLength | Should detect impossible constraints |

### String and Unicode Tests
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `unicode-edge-cases.struct.json` | BOM, surrogates, zero-width, RTL | Should handle all Unicode correctly |
| `string-length-surrogate.struct.json` | Length counting with emojis | Should count code points consistently |
| `extremely-long-string.struct.json` | Very long strings and patterns | Should not exhaust memory |

### Property Name Edge Cases
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `property-name-edge-cases.struct.json` | `__proto__`, `constructor`, empty string, etc. | Should not be vulnerable to prototype pollution |
| `ref-vs-property.struct.json` | `$ref` as property vs reference | Should distinguish context correctly |

### Reference Edge Cases
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `ref-to-nowhere.struct.json` | References to non-existent definitions | Should report missing reference errors |
| `malformed-json-pointer.struct.json` | Invalid JSON Pointer syntax | Should report parse errors |

### Collection Edge Cases
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `empty-arrays-objects.struct.json` | Empty collections with constraints | Should validate constraints correctly |
| `null-edge-cases.struct.json` | Null handling in various contexts | Should handle nullable types correctly |
| `massive-enum.struct.json` | Enum with 100 values | Should perform efficient lookup |

### Inheritance Tests
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `extends-with-overrides.struct.json` | Conflicting property definitions in derived type | Should merge or report conflict |
| `additionalProperties-combined.struct.json` | Nested additionalProperties | Should validate all levels correctly |

### Format Validation
| File | Purpose | Expected Behavior |
|------|---------|-------------------|
| `format-edge-cases.struct.json` | Various format strings including unknown | Should validate known formats, ignore unknown |
| `default-vs-required.struct.json` | Interaction of default and required | Should apply correct semantics |

## Instance Files

Corresponding instance files in `../instances/adversarial/` test the runtime validation behavior against these schemas.

## Running Tests

```powershell
# Run all adversarial tests
.\run-adversarial-tests.ps1

# Or test individual SDK manually:
cd typescript
npx vitest run --grep adversarial
```

## Adding New Tests

When adding new adversarial tests:

1. Create the schema in `schemas/adversarial/`
2. Create matching instance(s) in `instances/adversarial/`
3. Document the test purpose in this README
4. Consider both valid and invalid instances to test both positive and negative cases
