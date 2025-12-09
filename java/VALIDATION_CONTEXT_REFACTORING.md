# ValidationContext Refactoring Design

## Overview

This document outlines the technical approach for completing the thread-safety refactoring of the Java SDK validators using the ValidationContext pattern.

## Goals

1. Make `InstanceValidator` and `SchemaValidator` fully thread-safe for concurrent use
2. Enable safe usage as Spring singleton beans without restrictions
3. Maintain backward compatibility for existing API users
4. Minimize performance impact

## Current State

### InstanceValidator Mutable State
- `resolvedRefs: Map<String, JsonNode>` - Cache of resolved $ref references
- `sourceLocator: JsonSourceLocator` - Tracks source locations for error reporting

### SchemaValidator Mutable State
- `rootSchema: JsonNode` - Root schema for resolving local references
- `sourceLocator: JsonSourceLocator` - Tracks source locations for error reporting
- `definedRefs: Set<String>` - Set of defined schema references
- `importNamespaces: Set<String>` - Namespaces with $import/$importdefs
- `visitedExtends: Set<String>` - Tracks visited $extends for cycle detection
- `validationExtensionEnabled: boolean` - Whether validation extensions are enabled

## Proposed Solution

### Step 1: Create ValidationContext Classes

Create private static inner classes to hold per-validation state:

```java
public final class InstanceValidator {
    private final ValidationOptions options;
    private final ObjectMapper objectMapper;

    /**
     * Context for a single validation operation.
     * Contains mutable state that is specific to one validation.
     */
    private static final class ValidationContext {
        final Map<String, JsonNode> resolvedRefs = new HashMap<>();
        JsonSourceLocator sourceLocator;
    }
    
    // ... rest of class
}
```

```java
public final class SchemaValidator {
    private final ValidationOptions options;
    private final ObjectMapper objectMapper;
    private final Map<String, JsonNode> externalSchemaMap;

    /**
     * Context for a single schema validation operation.
     * Contains mutable state that is specific to one validation.
     */
    private static final class ValidationContext {
        JsonNode rootSchema;
        JsonSourceLocator sourceLocator;
        Set<String> definedRefs;
        Set<String> importNamespaces;
        Set<String> visitedExtends = new HashSet<>();
        boolean validationExtensionEnabled;
    }
    
    // ... rest of class
}
```

### Step 2: Update Public validate() Methods

Modify public validate methods to create a new context for each validation:

```java
// InstanceValidator
public ValidationResult validate(JsonNode instance, JsonNode schema) {
    ValidationContext context = new ValidationContext();
    context.sourceLocator = null;
    ValidationResult result = new ValidationResult();
    
    // ... validation logic using context
    
    return result;
}

// SchemaValidator  
public ValidationResult validate(JsonNode schema) {
    ValidationContext context = new ValidationContext();
    context.sourceLocator = null;
    context.visitedExtends = new HashSet<>();
    // ... initialize other context fields
    
    ValidationResult result = new ValidationResult();
    
    // ... validation logic using context
    
    return result;
}
```

### Step 3: Update All Private Methods

Add `ValidationContext context` parameter to all private validation methods:

#### InstanceValidator Methods to Update
```java
private void validateInstance(..., ValidationContext context)
private void validateConditionals(..., ValidationContext context)
private void validateType(..., ValidationContext context)
private void validateObject(..., ValidationContext context)
private void validateArray(..., ValidationContext context)
private void validateString(..., ValidationContext context)
private void validateNumber(..., ValidationContext context)
// ... all other validate* methods

private JsonNode resolveRef(String reference, JsonNode rootSchema, ValidationContext context)
private JsonLocation getLocation(String path, ValidationContext context)
private void addError(..., ValidationContext context)
```

#### SchemaValidator Methods to Update
```java
private ValidationResult validateCore(JsonNode schema, ValidationContext context)
private void validateSchemaCore(..., ValidationContext context)
private void validateType(..., ValidationContext context)
private void validateObjectSchema(..., ValidationContext context)
private void validateArraySchema(..., ValidationContext context)
// ... all other validation methods

private JsonNode resolveLocalRef(String refStr, ValidationContext context)
private void addError(..., ValidationContext context)
```

### Step 4: Update Field Access

Replace all direct field access with context access:

```java
// Before:
if (resolvedRefs.containsKey(reference)) {
    return resolvedRefs.get(reference);
}

// After:
if (context.resolvedRefs.containsKey(reference)) {
    return context.resolvedRefs.get(reference);
}

// Before:
if (sourceLocator == null) {
    return JsonLocation.UNKNOWN;
}
return sourceLocator.getLocation(path);

// After:
if (context.sourceLocator == null) {
    return JsonLocation.UNKNOWN;
}
return context.sourceLocator.getLocation(path);
```

### Step 5: Remove Instance Fields

After all methods are updated, remove the old instance fields:

```java
// DELETE THESE:
// private final Map<String, JsonNode> resolvedRefs = new HashMap<>();
// private JsonSourceLocator sourceLocator;
```

## Implementation Strategy

### Phase 1: Automated Script
Create a Python script to handle bulk of refactoring:
1. Add ValidationContext classes
2. Update method signatures
3. Update method calls to pass context
4. Replace field access patterns

### Phase 2: Manual Cleanup
1. Fix any compilation errors from the script
2. Verify correct context propagation
3. Ensure no context is shared between validations

### Phase 3: Testing
1. Run existing unit tests
2. Run thread-safety tests
3. Add stress tests with higher concurrency
4. Performance benchmark to verify no regression

### Phase 4: Documentation
1. Update Javadoc to indicate full thread safety
2. Update README with simplified usage examples
3. Remove warnings about concurrent usage

## Testing Strategy

### Existing Tests
All existing tests should pass without modification after refactoring.

### Thread-Safety Tests
The existing ThreadSafetyTests.java should pass with increased confidence:
- Concurrent validations
- Sequential reuse
- No error cross-contamination

### Additional Tests
Add stress tests:
```java
@Test
void highConcurrencyStressTest() {
    InstanceValidator validator = new InstanceValidator();
    ExecutorService executor = Executors.newFixedThreadPool(100);
    
    List<Future<ValidationResult>> futures = new ArrayList<>();
    for (int i = 0; i < 10000; i++) {
        futures.add(executor.submit(() -> 
            validator.validate(randomInstance(), randomSchema())
        ));
    }
    
    // Verify all complete successfully
    for (Future<ValidationResult> future : futures) {
        assertThat(future.get()).isNotNull();
    }
}
```

## Backward Compatibility

### API Compatibility
- All public methods remain unchanged
- ValidationOptions behavior unchanged
- No breaking changes for existing users

### Behavioral Compatibility
- Validation results should be identical
- Error messages and codes unchanged
- Performance characteristics similar or better

## Performance Considerations

### Memory
- Each validation creates a small ValidationContext object
- Context objects are short-lived and garbage collected quickly
- No significant memory overhead expected

### CPU
- No additional CPU overhead
- May actually improve performance by reducing synchronization needs

### Benchmarking
Before and after refactoring, measure:
- Single-threaded validation throughput
- Multi-threaded validation throughput  
- Memory allocation rates
- GC pressure

## Rollout Plan

1. Complete refactoring in feature branch
2. Run full test suite including thread-safety tests
3. Performance benchmark comparison
4. Code review
5. Merge to main
6. Release as minor version (no breaking changes)

## Future Enhancements

After completing the refactoring:

### ValidationOptions Builder
Make ValidationOptions truly immutable:
```java
public final class ValidationOptions {
    public static Builder builder() {
        return new Builder();
    }
    
    public static class Builder {
        private int maxValidationDepth = 64;
        // ... other fields
        
        public Builder maxValidationDepth(int depth) {
            this.maxValidationDepth = depth;
            return this;
        }
        
        public ValidationOptions build() {
            return new ValidationOptions(this);
        }
    }
    
    private ValidationOptions(Builder builder) {
        this.maxValidationDepth = builder.maxValidationDepth;
        // ... initialize all fields from builder
    }
    
    // Only getters, no setters
}
```

### Validator Builder
Provide a fluent API for validator configuration:
```java
InstanceValidator validator = InstanceValidator.builder()
    .options(options)
    .referenceResolver(myResolver)
    .build();
```

## References

- Issue: [Java SDK: Make validators thread-safe](link-to-issue)
- Thread Safety Tests: `ThreadSafetyTests.java`
- ValidationOptions: `ValidationOptions.java`
- README: Thread Safety section
