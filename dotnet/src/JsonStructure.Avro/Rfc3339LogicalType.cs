using Avro;
using Avro.Util;

namespace JsonStructure.Avro;

/// <summary>
/// One of the <c>rfc3339-*</c> logical types that <see cref="AvroMode.Full"/>
/// emits, taught to the Apache Avro runtime.
/// </summary>
/// <remarks>
/// <para>
/// These names are Avrotize's extension rather than reserved Avro logical
/// types. Most Avro implementations ignore a logical type they do not
/// recognize and fall back to the base type, which is precisely why the
/// annotation is safe. Apache.Avro for .NET does not: it throws
/// <c>Logical type 'rfc3339-date' is not supported</c> while parsing. Spec
/// §2.5.1 therefore requires an SDK that offers <c>full</c> mode to register
/// the names with its own runtime, which is what this type exists for.
/// </para>
/// <para>
/// The base type is <c>string</c> and the logical value is the same RFC 3339
/// text, so both conversions are the identity. The annotation says what the
/// string means; it does not change what it is.
/// </para>
/// </remarks>
internal sealed class Rfc3339LogicalType(string name) : LogicalType(name)
{
    /// <inheritdoc/>
    public override object ConvertToBaseValue(object logicalValue, LogicalSchema schema) =>
        logicalValue;

    /// <inheritdoc/>
    public override object ConvertToLogicalValue(object baseValue, LogicalSchema schema) =>
        baseValue;

    /// <inheritdoc/>
    public override Type GetCSharpType(bool nullible) => typeof(string);

    /// <inheritdoc/>
    public override bool IsInstanceOfLogicalType(object logicalValue) => logicalValue is string;

    /// <inheritdoc/>
    public override void ValidateSchema(LogicalSchema schema)
    {
        if (schema.BaseSchema.Tag != Schema.Type.String)
        {
            throw new AvroTypeException(
                $"logical type '{Name}' requires a string base type");
        }
    }
}
