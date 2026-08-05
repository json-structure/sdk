This case's $root is an enum, so the generated file declares no message at all.
protoc --encode requires a message, so there is nothing to put on the wire.
The enum is still exercised as a field type by the `enums` and `collections-of-types` cases.
