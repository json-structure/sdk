<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Represents a location in a JSON document with line and column information.
 */
readonly class JsonLocation
{
    public function __construct(
        public int $line,
        public int $column
    ) {}

    /**
     * Returns an unknown location (line 0, column 0).
     */
    public static function unknown(): self
    {
        return new self(0, 0);
    }

    /**
     * Returns True if the location is known (non-zero).
     */
    public function isKnown(): bool
    {
        return $this->line > 0 && $this->column > 0;
    }

    public function __toString(): string
    {
        return $this->isKnown() ? "({$this->line}:{$this->column})" : '';
    }
}
