<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Severity levels for validation messages.
 */
enum ValidationSeverity: string
{
    case ERROR = 'error';
    case WARNING = 'warning';
}
