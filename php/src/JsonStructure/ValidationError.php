<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Represents a validation error with code, message, and location information.
 */
class ValidationError
{
    public function __construct(
        public readonly string $code,
        public readonly string $message,
        public readonly string $path = '',
        public readonly ValidationSeverity $severity = ValidationSeverity::ERROR,
        public readonly ?JsonLocation $location = null,
        public readonly ?string $schemaPath = null
    ) {}

    public function __toString(): string
    {
        $parts = [];

        if ($this->path !== '') {
            $parts[] = $this->path;
        }

        if ($this->location?->isKnown()) {
            $parts[] = (string) $this->location;
        }

        $parts[] = "[{$this->code}]";
        $parts[] = $this->message;

        if ($this->schemaPath !== null) {
            $parts[] = "(schema: {$this->schemaPath})";
        }

        return implode(' ', $parts);
    }
}
