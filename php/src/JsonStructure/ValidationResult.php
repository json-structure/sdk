<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Result of a validation operation containing errors and warnings.
 */
class ValidationResult
{
    /** @var ValidationError[] */
    private array $errors = [];

    /** @var ValidationError[] */
    private array $warnings = [];

    public function addError(ValidationError $error): void
    {
        $this->errors[] = $error;
    }

    public function addWarning(ValidationError $warning): void
    {
        $this->warnings[] = $warning;
    }

    /**
     * @return ValidationError[]
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * @return ValidationError[]
     */
    public function getWarnings(): array
    {
        return $this->warnings;
    }

    public function isValid(): bool
    {
        return count($this->errors) === 0;
    }

    public function hasErrors(): bool
    {
        return count($this->errors) > 0;
    }

    public function hasWarnings(): bool
    {
        return count($this->warnings) > 0;
    }

    public function merge(ValidationResult $other): void
    {
        foreach ($other->getErrors() as $error) {
            $this->errors[] = $error;
        }
        foreach ($other->getWarnings() as $warning) {
            $this->warnings[] = $warning;
        }
    }
}
