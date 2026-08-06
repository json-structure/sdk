using System.Text.Json;
using System.Text.Json.Nodes;

namespace JsonStructure.Avro;

/// <summary>
/// The result of a compilation: the schema, and everything that did not survive
/// the trip intact.
/// </summary>
/// <param name="Schema">The Avro schema, as a JSON document.</param>
/// <param name="Warnings">What the target could not express, in emission order.</param>
public sealed record AvroCompileResult(JsonNode Schema, IReadOnlyList<AvroWarning> Warnings);

/// <summary>
/// Compiles a JSON Structure document into an Apache Avro schema.
/// </summary>
/// <remarks>
/// <para>
/// The normative mapping is <c>spec/json-structure-to-avro.md</c>; this class is
/// an implementation of it and the section references in the comments point back
/// at it. It is a faithful port of the Rust reference implementation, and the
/// conformance corpus under <c>test-assets/avro/</c> holds both to byte-identical
/// output.
/// </para>
/// <para>
/// The compiler is pure: no I/O, no clock, no randomness, no global state. It
/// consumes an already-consolidated document, so resolve <c>$import</c> before
/// calling it.
/// </para>
/// </remarks>
public static partial class AvroCompiler
{
    /// <summary>Compiles with default options.</summary>
    /// <param name="document">A consolidated JSON Structure document.</param>
    /// <returns>The schema and any warnings.</returns>
    /// <remarks>
    /// Both overloads return the warnings. Returning a bare schema from this one
    /// would make discarding them the shorter thing to write, and a warning is a
    /// report that something was lost in the mapping — the caller who has not
    /// thought about that is exactly the caller who should see it.
    /// </remarks>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static AvroCompileResult Compile(JsonNode document) =>
        Compile(document, AvroOptions.Default);

    /// <summary>Compiles with explicit options.</summary>
    /// <param name="document">A consolidated JSON Structure document.</param>
    /// <param name="options">Compilation options.</param>
    /// <returns>The schema and any warnings.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static AvroCompileResult Compile(JsonNode document, AvroOptions options)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(options);
        return new Worker(document, options).Run();
    }

    /// <summary>Naming and error context for a schema node.</summary>
    private readonly struct Ctx(string ns, string hint, string pointer)
    {
        /// <summary>Avro namespace for anonymous types minted at this position.</summary>
        public string Namespace { get; } = ns;

        /// <summary>Base for generated names (§6.3).</summary>
        public string Hint { get; } = hint;

        /// <summary>JSON Pointer, for error reporting.</summary>
        public string Pointer { get; } = pointer;

        public Ctx Child(string member, string pointerSegment) =>
            new(Namespace, $"{Hint}_{member}", $"{Pointer}/{pointerSegment}");

        public Ctx At(string pointerSegment) =>
            new(Namespace, Hint, $"{Pointer}/{pointerSegment}");
    }

    /// <summary>One field of a record, after <c>$extends</c> and add-in flattening.</summary>
    private sealed class FieldSpec
    {
        public required string Key { get; init; }
        public required JsonNode Schema { get; init; }
        public required bool Required { get; init; }
        public required string Pointer { get; init; }
    }

    /// <summary>An add-in selected via <see cref="AvroOptions.Uses"/>.</summary>
    private sealed class AddIn
    {
        public required string Target { get; init; }
        public required JsonObject Schema { get; init; }
        public required string Pointer { get; init; }
    }

    private sealed class Worker(JsonNode doc, AvroOptions opts)
    {
        private readonly JsonNode _doc = doc;
        private readonly AvroOptions _opts = opts;

        /// <summary>
        /// Fully-qualified names whose full definition has already been emitted.
        /// Membership lookups only — never iterated, per §7.2.
        /// </summary>
        private readonly HashSet<string> _emitted = [];

        /// <summary>Fully-qualified names taken, for generated-name collision suffixing.</summary>
        private readonly HashSet<string> _reserved = [];

        private readonly List<AvroWarning> _warnings = [];
        private readonly List<AddIn> _addins = [];

        /// <summary>
        /// Selector names of inline unions. Core §Choice permits the selector to
        /// shadow a base-type property, so these names are exempt from the
        /// no-redefinition rule. Membership lookups only.
        /// </summary>
        private HashSet<string> _shadowable = [];

        public AvroCompileResult Run()
        {
            _shadowable = CollectSelectors(_doc);
            CollectAddIns();
            ReserveDeclaredNames();
            var schema = CompileRoot();
            return new AvroCompileResult(schema, _warnings);
        }

        // -- declared names ----------------------------------------------------

        /// <summary>
        /// Claims the Avro fullname of every declared type before anything is
        /// compiled.
        /// </summary>
        /// <remarks>
        /// Generated helper names are minted with a collision suffix, but the
        /// suffixing only works against names already claimed. Reserving lazily —
        /// as each type happened to be reached — let a helper minted early take a
        /// name a declaration further down the document would later emit verbatim,
        /// producing two Avro definitions with one fullname. Avro parsers reject
        /// that outright, and a parser that did not would conflate the two types.
        /// <para>
        /// Reserving up front also makes helper names independent of traversal
        /// order, which determinism requires.
        /// </para>
        /// </remarks>
        private void ReserveDeclaredNames()
        {
            if (Js.Obj(Js.Get(_doc, "definitions")) is not { } definitions)
            {
                return;
            }

            var claims = new List<(string FullName, string Pointer)>();
            WalkDefinitions(definitions, [], "#/definitions", claims);
            foreach (var (fullName, pointer) in claims)
            {
                if (!_reserved.Add(fullName))
                {
                    throw AvroCompileException.Invalid(
                        $"two declared types both map to the Avro fullname `{fullName}`",
                        pointer);
                }
            }
        }

        private void WalkDefinitions(
            JsonObject node,
            IReadOnlyList<string> ns,
            string pointer,
            List<(string, string)> outClaims)
        {
            foreach (var (key, value) in node)
            {
                if (value is not JsonObject map)
                {
                    continue;
                }

                var childPointer = $"{pointer}/{key}";
                if (IsTypeDeclaration(map))
                {
                    var name = DeclaredName(map, childPointer) ?? key;
                    outClaims.Add((Qualify(NamespaceFor(ns), name), childPointer));
                }
                else
                {
                    var nested = new List<string>(ns) { key };
                    WalkDefinitions(map, nested, childPointer, outClaims);
                }
            }
        }

        // -- add-ins (§5.5) ----------------------------------------------------

        /// <summary>
        /// Resolves <see cref="AvroOptions.Uses"/> against <c>$offers</c>.
        /// </summary>
        /// <remarks>
        /// Iteration follows <c>$offers</c> document order rather than the caller's
        /// order; §7.5 requires the output not to depend on how the caller sorted
        /// its argument.
        /// </remarks>
        private void CollectAddIns()
        {
            if (_opts.Uses.Count == 0)
            {
                return;
            }

            var offers = Js.Obj(Js.Get(_doc, "$offers"));
            var requested = new HashSet<string>(_opts.Uses, StringComparer.Ordinal);
            var found = new HashSet<string>(StringComparer.Ordinal);

            if (offers is not null)
            {
                foreach (var (name, value) in offers)
                {
                    if (!requested.Contains(name))
                    {
                        continue;
                    }

                    found.Add(name);
                    var pointerValues = value is JsonArray items
                        ? items.ToList()
                        : [value];

                    foreach (var pointerValue in pointerValues)
                    {
                        var pointer = Js.Str(pointerValue)
                            ?? throw AvroCompileException.Invalid(
                                "`$offers` values must be JSON Pointers",
                                $"#/$offers/{name}");

                        var (schema, _) = Resolve(pointer, $"#/$offers/{name}");
                        var target = Js.Str(Js.Get(schema, "$extends"))
                            ?? throw AvroCompileException.Invalid(
                                $"add-in '{name}' must declare a single `$extends` target",
                                pointer);

                        _addins.Add(new AddIn
                        {
                            Target = target,
                            Schema = Js.Obj(schema) ?? throw AvroCompileException.Invalid(
                                "add-in must be a type declaration", pointer),
                            Pointer = pointer,
                        });
                    }
                }
            }

            foreach (var name in _opts.Uses)
            {
                if (!found.Contains(name))
                {
                    throw AvroCompileException.UnknownAddIn(name);
                }
            }
        }

        // -- roots (§5.1) ------------------------------------------------------

        private JsonNode CompileRoot()
        {
            if (Js.Str(Js.Get(_doc, "$root")) is { } rootPointer)
            {
                var (_, path) = Resolve(rootPointer, "#/$root");
                return CompileDefinition(path, null);
            }

            var root = _doc as JsonObject
                ?? throw AvroCompileException.Invalid("schema document must be a JSON object", "#");

            if (!root.ContainsKey("type"))
            {
                throw AvroCompileException.NoRootType();
            }

            var name = DeclaredName(root, "#") ?? "Root";
            var ns = NamespaceFor([]);
            var ctx = new Ctx(ns, name, "#");
            return BuildNamed(root, name, ns, ctx, "#", null);
        }

        // -- named definitions (§5.3) ------------------------------------------

        /// <summary>
        /// Compiles the type at <paramref name="path"/> under <c>definitions</c>,
        /// emitting its full definition the first time and a name reference
        /// thereafter.
        /// </summary>
        private JsonNode CompileDefinition(IReadOnlyList<string> path, string? injectSelector)
        {
            var pointer = DefinitionPointer(path);
            var decl = Lookup(path)
                ?? throw AvroCompileException.UnresolvedRef(pointer, pointer);
            var map = Js.Obj(decl)
                ?? throw AvroCompileException.Invalid(
                    "type declaration must be a JSON object", pointer);

            if (Js.Bool(Js.Get(map, "abstract")) == true)
            {
                throw AvroCompileException.Invalid(
                    "abstract types cannot be used as a value type", pointer);
            }

            var key = path.Count > 0 ? path[^1] : string.Empty;
            var name = DeclaredName(map, pointer) ?? key;
            var ns = NamespaceFor(path.Take(Math.Max(path.Count - 1, 0)).ToList());
            var fullName = Qualify(ns, name);

            if (_emitted.Contains(fullName))
            {
                return JsonValue.Create(fullName)!;
            }

            _emitted.Add(fullName);
            _reserved.Add(fullName);

            var ctx = new Ctx(ns, name, pointer);
            return BuildNamed(map, name, ns, ctx, pointer, injectSelector);
        }

        /// <summary>Builds the definition body for a type that has a settled name.</summary>
        private JsonNode BuildNamed(
            JsonObject decl,
            string name,
            string ns,
            Ctx ctx,
            string pointer,
            string? injectSelector)
        {
            if (TryEnum(decl, name, ns, pointer) is { } enumSchema)
            {
                return enumSchema;
            }

            if (!decl.TryGetPropertyValue("type", out var typeValue))
            {
                throw AvroCompileException.Invalid(
                    "type declaration is missing the `type` keyword", pointer);
            }

            if (Js.Str(typeValue) is { } typeName)
            {
                return typeName switch
                {
                    "object" => BuildRecord(decl, name, ns, ctx, pointer, injectSelector),
                    "tuple" => BuildTuple(decl, name, ns, ctx, pointer),
                    "choice" => BuildChoice(decl, name, ns, ctx, pointer),
                    "any" => AnyRecord(name, ns, pointer),
                    _ => CompileInline(decl, ctx),
                };
            }

            return CompileInline(decl, ctx);
        }

        // -- records (§3.1, §3.2) ----------------------------------------------

        private JsonNode BuildRecord(
            JsonObject decl,
            string name,
            string ns,
            Ctx ctx,
            string pointer,
            string? injectSelector)
        {
            CheckAdditionalProperties(decl, pointer);

            var specs = new List<FieldSpec>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            CollectFields(decl, pointer, specs, seen);

            // §3.7.2: the inline-union selector is materialized as the first field
            // unless the branch already declares it.
            var fields = new JsonArray();
            if (injectSelector is not null && !seen.Contains(injectSelector))
            {
                fields.Add(new JsonObject
                {
                    ["name"] = injectSelector,
                    ["type"] = "string",
                });
            }

            foreach (var spec in specs)
            {
                fields.Add(BuildField(spec, ctx));
            }

            var outNode = new JsonObject
            {
                ["type"] = "record",
                ["name"] = name,
            };
            if (ns.Length > 0)
            {
                outNode["namespace"] = ns;
            }
            if (DocOf(decl) is { } doc)
            {
                outNode["doc"] = doc;
            }
            if (ConstraintsOf(decl) is { } constraints)
            {
                outNode["jsonStructure"] = constraints;
            }
            outNode["fields"] = fields;
            return outNode;
        }

        private JsonNode BuildField(FieldSpec spec, Ctx ctx)
        {
            var decl = Js.Obj(spec.Schema)
                ?? throw AvroCompileException.Invalid(
                    "property schema must be a JSON object", spec.Pointer);

            var fieldName = AltName(decl, spec.Pointer) ?? spec.Key;
            var child = new Ctx(ctx.Namespace, $"{ctx.Hint}_{spec.Key}", spec.Pointer);
            var baseType = CompileInline(decl, child);

            var hasDefault = decl.TryGetPropertyValue("default", out var declaredDefault);
            var (fieldType, defaultValue, hasEmittedDefault) =
                Nullable(baseType, spec.Required, hasDefault, declaredDefault, spec.Pointer);

            // Avro has no notion of a fixed value. A `const` becomes an ordinary
            // field that any writer may set to anything, which is worth saying out
            // loud rather than dropping on the floor.
            if (decl.ContainsKey("const"))
            {
                _warnings.Add(new AvroWarning(
                    spec.Pointer,
                    "Avro cannot express `const`; the value is not enforced"));
            }

            var outNode = new JsonObject
            {
                ["name"] = fieldName,
                ["type"] = fieldType,
            };
            if (DocOf(decl) is { } doc)
            {
                outNode["doc"] = doc;
            }
            if (ConstraintsOf(decl) is { } constraints)
            {
                outNode["jsonStructure"] = constraints;
            }
            if (hasEmittedDefault)
            {
                outNode["default"] = defaultValue;
            }
            return outNode;
        }

        /// <summary>
        /// <c>required</c> for one declaration, warning when Core's alternative
        /// sets had to be collapsed to their intersection.
        /// </summary>
        private HashSet<string> RequiredHere(JsonObject decl, string pointer)
        {
            var (required, note) = RequiredSet(decl);
            if (note is not null)
            {
                _warnings.Add(new AvroWarning(pointer, note));
            }
            return required;
        }

        /// <summary>
        /// Flattens <c>$extends</c> bases, own properties, and add-ins into one
        /// ordered field list (§5.4, §5.5). Base fields come first; with multiple
        /// bases the first in the array wins.
        /// </summary>
        private void CollectFields(
            JsonObject decl,
            string pointer,
            List<FieldSpec> outSpecs,
            HashSet<string> seen)
        {
            var chain = new List<string>();
            CollectFieldsFrom(decl, pointer, outSpecs, seen, chain);
        }

        private void CollectFieldsFrom(
            JsonObject decl,
            string pointer,
            List<FieldSpec> outSpecs,
            HashSet<string> seen,
            List<string> chain)
        {
            // Core forbids `$extends` cycles. Without this the recursion below
            // overflows the stack rather than reporting the schema error.
            if (chain.Contains(pointer, StringComparer.Ordinal))
            {
                chain.Add(pointer);
                throw AvroCompileException.Invalid(
                    $"`$extends` cycle: {string.Join(" -> ", chain)}", pointer);
            }
            chain.Add(pointer);

            // Names already contributed by an enclosing call or by an earlier
            // sibling base. Core says the first base in the array wins, so a
            // collision against these is legal; a collision against a name from
            // *our own* extends chain is not.
            var outer = new HashSet<string>(seen, StringComparer.Ordinal);

            if (decl.TryGetPropertyValue("$extends", out var extends))
            {
                foreach (var basePointer in PointerList(extends, pointer))
                {
                    var (baseNode, _) = Resolve(basePointer, pointer);
                    var baseMap = Js.Obj(baseNode)
                        ?? throw AvroCompileException.Invalid(
                            "`$extends` must point at a type declaration", pointer);
                    CollectFieldsFrom(baseMap, basePointer, outSpecs, seen, chain);
                }
            }

            var required = RequiredHere(decl, pointer);
            if (Js.Obj(Js.Get(decl, "properties")) is { } properties)
            {
                foreach (var (key, schema) in properties)
                {
                    if (seen.Contains(key))
                    {
                        // Core: an extending type MUST NOT redefine an inherited
                        // property. The one exception is an inline union's
                        // selector, which MAY shadow a base property.
                        if (!outer.Contains(key) && !_shadowable.Contains(key))
                        {
                            throw AvroCompileException.Invalid(
                                $"property '{key}' is inherited through `$extends` and MUST NOT be redefined",
                                $"{pointer}/properties/{key}");
                        }
                        continue;
                    }

                    seen.Add(key);
                    outSpecs.Add(new FieldSpec
                    {
                        Key = key,
                        Schema = schema?.DeepClone()
                            ?? throw AvroCompileException.Invalid(
                                "property schema must be a JSON object",
                                $"{pointer}/properties/{key}"),
                        Required = required.Contains(key),
                        Pointer = $"{pointer}/properties/{key}",
                    });
                }
            }

            // Add-ins targeting this exact type append after its own properties.
            var applicable = _addins
                .Where(a => string.Equals(a.Target, pointer, StringComparison.Ordinal))
                .Select(a => (Schema: a.Schema, Pointer: a.Pointer))
                .ToList();

            foreach (var (schema, addinPointer) in applicable)
            {
                var addinRequired = RequiredHere(schema, addinPointer);
                if (Js.Obj(Js.Get(schema, "properties")) is { } addinProperties)
                {
                    foreach (var (key, prop) in addinProperties)
                    {
                        if (seen.Contains(key))
                        {
                            continue;
                        }
                        seen.Add(key);
                        outSpecs.Add(new FieldSpec
                        {
                            Key = key,
                            Schema = prop?.DeepClone()
                                ?? throw AvroCompileException.Invalid(
                                    "property schema must be a JSON object",
                                    $"{addinPointer}/properties/{key}"),
                            Required = addinRequired.Contains(key),
                            Pointer = $"{addinPointer}/properties/{key}",
                        });
                    }
                }
            }

            // `chain` tracks ancestors only. Popping here is what lets a diamond
            // (two bases sharing a grandparent) through while a true cycle fails.
            chain.RemoveAt(chain.Count - 1);
        }

        // -- tuples (§3.5) -----------------------------------------------------

        private JsonNode BuildTuple(
            JsonObject decl,
            string name,
            string ns,
            Ctx ctx,
            string pointer)
        {
            var order = Js.Arr(Js.Get(decl, "tuple"))
                ?? throw AvroCompileException.Invalid(
                    "`tuple` types require the `tuple` keyword", pointer);

            var specs = new List<FieldSpec>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            CollectFields(decl, pointer, specs, seen);

            var fields = new JsonArray();
            foreach (var entry in order)
            {
                var key = Js.Str(entry)
                    ?? throw AvroCompileException.Invalid(
                        "`tuple` entries must be property names", pointer);

                var spec = specs.FirstOrDefault(s => string.Equals(s.Key, key, StringComparison.Ordinal))
                    ?? throw AvroCompileException.Invalid(
                        $"`tuple` names unknown property '{key}'", pointer);

                // All tuple properties are implicitly required (§3.5).
                fields.Add(BuildField(
                    new FieldSpec
                    {
                        Key = spec.Key,
                        Schema = spec.Schema,
                        Required = true,
                        Pointer = spec.Pointer,
                    },
                    ctx));
            }

            var outNode = new JsonObject
            {
                ["type"] = "record",
                ["name"] = name,
            };
            if (ns.Length > 0)
            {
                outNode["namespace"] = ns;
            }
            if (DocOf(decl) is { } doc)
            {
                outNode["doc"] = doc;
            }
            if (ConstraintsOf(decl) is { } constraints)
            {
                outNode["jsonStructure"] = constraints;
            }
            outNode["fields"] = fields;
            return outNode;
        }

        // -- choices (§3.7) ----------------------------------------------------

        private JsonNode BuildChoice(
            JsonObject decl,
            string name,
            string ns,
            Ctx ctx,
            string pointer)
        {
            var choices = Js.Obj(Js.Get(decl, "choices"))
                ?? throw AvroCompileException.Invalid(
                    "`choice` types require the `choices` keyword", pointer);

            var selector = Js.Str(Js.Get(decl, "selector"));
            var inline = decl.ContainsKey("$extends") && selector is not null;

            var branches = new List<JsonNode>();
            foreach (var (key, branch) in choices)
            {
                var branchPointer = $"{pointer}/choices/{key}";
                if (inline)
                {
                    var branchRef = Js.Str(Js.Get(Js.Get(branch, "type"), "$ref"))
                        ?? throw AvroCompileException.Invalid(
                            "inline union choices must be `$ref` to a named type", branchPointer);
                    var (_, path) = Resolve(branchRef, branchPointer);
                    branches.Add(CompileDefinition(path, selector));
                    continue;
                }

                var branchMap = Js.Obj(branch)
                    ?? throw AvroCompileException.Invalid(
                        "choice branches must be schema objects", branchPointer);

                var child = new Ctx(ns, $"{ctx.Hint}_{key}", branchPointer);
                var compiled = CompileInline(branchMap, child);

                // §3.7.1: use the branch directly when its Avro name already equals
                // the choice key, otherwise wrap it in a record named for the key.
                if (string.Equals(UnqualifiedName(compiled), key, StringComparison.Ordinal))
                {
                    branches.Add(compiled);
                }
                else
                {
                    var wrapper = new JsonObject
                    {
                        ["type"] = "record",
                        ["name"] = MintNamed(key, child),
                    };
                    if (ns.Length > 0)
                    {
                        wrapper["namespace"] = ns;
                    }
                    wrapper["fields"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["name"] = "value",
                            ["type"] = compiled,
                        },
                    };
                    branches.Add(wrapper);
                }
            }

            // A choice is a union, and Avro unions are not named. The choice's own
            // name survives only through the branch wrappers.
            _ = name;
            return UnionOf(branches);
        }

        // -- inline schemas ----------------------------------------------------

        /// <summary>Compiles a schema node that is not itself a <c>definitions</c> entry.</summary>
        private JsonNode CompileInline(JsonObject decl, Ctx ctx)
        {
            if (Js.Obj(Js.Get(decl, "type")) is { } inner
                && Js.Str(Js.Get(inner, "$ref")) is { } inlineRef)
            {
                var (_, refPath) = Resolve(inlineRef, ctx.Pointer);
                return CompileDefinition(refPath, null);
            }

            // An anonymous enum needs a minted name.
            if (decl.ContainsKey("enum"))
            {
                var minted = MintName(ctx);
                if (TryEnum(decl, minted, ctx.Namespace, ctx.Pointer) is { } enumSchema)
                {
                    return enumSchema;
                }
            }

            if (!decl.TryGetPropertyValue("type", out var typeValue))
            {
                throw AvroCompileException.Invalid(
                    "schema is missing the `type` keyword", ctx.Pointer);
            }

            if (Js.Str(typeValue) is { } typeName)
            {
                return CompileTypeName(typeName, decl, ctx);
            }

            if (Js.Arr(typeValue) is { } unionBranches)
            {
                var compiled = new List<JsonNode>();
                for (var index = 0; index < unionBranches.Count; index++)
                {
                    var child = ctx.At($"type/{index}");
                    compiled.Add(CompileUnionBranch(unionBranches[index], child));
                }
                return UnionOf(compiled);
            }

            throw AvroCompileException.Invalid(
                $"unsupported `type` value: {Js.Compact(typeValue)}", ctx.Pointer);
        }

        private JsonNode CompileUnionBranch(JsonNode? branch, Ctx ctx)
        {
            if (Js.Str(branch) is { } primitiveName)
            {
                return CompileTypeName(primitiveName, new JsonObject(), ctx);
            }

            if (branch is JsonObject map)
            {
                if (Js.Str(Js.Get(map, "$ref")) is { } reference)
                {
                    var (_, path) = Resolve(reference, ctx.Pointer);
                    return CompileDefinition(path, null);
                }
                return CompileInline(map, ctx);
            }

            throw AvroCompileException.Invalid(
                $"unsupported union branch: {Js.Compact(branch)}", ctx.Pointer);
        }

        private JsonNode CompileTypeName(string typeName, JsonObject decl, Ctx ctx)
        {
            if (AvroPrimitive(typeName) is { } primitive)
            {
                return PrimitiveValue(typeName, primitive, decl, ctx);
            }

            switch (typeName)
            {
                case "array":
                case "set":
                {
                    if (typeName == "set")
                    {
                        // Avro has no set type. The values survive; the uniqueness
                        // constraint does not.
                        _warnings.Add(new AvroWarning(
                            ctx.Pointer,
                            "Avro has no set type; uniqueness is not enforced on the wire"));
                    }

                    var items = Js.Obj(Js.Get(decl, "items"))
                        ?? throw AvroCompileException.Invalid(
                            $"`{typeName}` requires `items`", ctx.Pointer);
                    var itemType = CompileInline(items, ctx.Child("item", "items"));
                    return new JsonObject { ["type"] = "array", ["items"] = itemType };
                }

                case "map":
                {
                    var values = Js.Obj(Js.Get(decl, "values"))
                        ?? throw AvroCompileException.Invalid(
                            "`map` requires `values`", ctx.Pointer);
                    var valueType = CompileInline(values, ctx.Child("value", "values"));
                    return new JsonObject { ["type"] = "map", ["values"] = valueType };
                }

                case "object":
                    return BuildRecord(decl, MintName(ctx), ctx.Namespace, ctx, ctx.Pointer, null);

                case "tuple":
                    return BuildTuple(decl, MintName(ctx), ctx.Namespace, ctx, ctx.Pointer);

                case "choice":
                    return BuildChoice(decl, MintName(ctx), ctx.Namespace, ctx, ctx.Pointer);

                case "any":
                    return AnyRecord(MintName(ctx), ctx.Namespace, ctx.Pointer);

                default:
                    throw AvroCompileException.Invalid(
                        $"unknown type '{typeName}'", ctx.Pointer);
            }
        }

        // -- any (§3.6) --------------------------------------------------------

        /// <summary>
        /// <c>any</c> compiles to a zero-field record: a hole a writer schema
        /// fills in and a reader schema steps over.
        /// </summary>
        /// <remarks>
        /// This is asymmetric, and the asymmetry is the whole point, so it is
        /// worth stating plainly. Avro resolves records by name and ignores writer
        /// fields the reader does not declare. A reader holding this empty record
        /// therefore accepts <em>whatever</em> the writer put there and hands back
        /// an empty record — the data is read as if the reader did not know its
        /// shape, which is exactly what <c>any</c> means.
        /// <para>
        /// What you cannot do is write through the hole. The compiled schema is a
        /// reader schema at this position. To produce data, compile or hand-write a
        /// writer schema in which the hole is filled with the concrete type.
        /// </para>
        /// </remarks>
        private JsonNode AnyRecord(string name, string ns, string pointer)
        {
            _warnings.Add(new AvroWarning(
                pointer,
                "`any` compiles to an empty Avro record: readable but not writable at this "
                + "position. A writer must supply a schema that fills the hole with a concrete "
                + "type; inside `array`/`map` every element must share that one type, because "
                + "Avro collections are homogeneous"));
            return EmptyRecord(name, ns);
        }

        // -- enums (§4.1) ------------------------------------------------------

        private JsonNode? TryEnum(JsonObject decl, string name, string ns, string pointer)
        {
            if (Js.Arr(Js.Get(decl, "enum")) is not { } values)
            {
                return null;
            }
            if (Js.Str(Js.Get(decl, "type")) != "string")
            {
                return null;
            }

            var overrides = Js.Obj(Js.Get(Js.Get(decl, "altenums"), "avro"));

            var symbols = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in values)
            {
                if (Js.Str(value) is not { } raw)
                {
                    return null;
                }

                string symbol;
                if (overrides is not null && Js.Str(Js.Get(overrides, raw)) is { } mapped)
                {
                    if (!IsAvroName(mapped))
                    {
                        throw AvroCompileException.IllegalName(
                            mapped, $"{pointer}/altenums/avro/{raw}");
                    }
                    symbol = mapped;
                }
                else
                {
                    // Not expressible as an Avro enum; fall back to `string`.
                    if (!IsAvroName(raw))
                    {
                        return null;
                    }
                    symbol = raw;
                }

                if (!seen.Add(symbol))
                {
                    return null;
                }
                symbols.Add(symbol);
            }

            if (symbols.Count == 0)
            {
                return null;
            }

            var outNode = new JsonObject
            {
                ["type"] = "enum",
                ["name"] = name,
            };
            if (ns.Length > 0)
            {
                outNode["namespace"] = ns;
            }
            if (DocOf(decl) is { } doc)
            {
                outNode["doc"] = doc;
            }
            if (ConstraintsOf(decl) is { } constraints)
            {
                outNode["jsonStructure"] = constraints;
            }

            var symbolArray = new JsonArray();
            foreach (var symbol in symbols)
            {
                // The non-generic overload matters: JsonArray.Add<T> on .NET 8
                // wraps even a string in a JsonValueCustomized<T>, which cannot be
                // written without a reflection-based type-info resolver. The
                // string overload produces a plain primitive node.
                symbolArray.Add(JsonValue.Create(symbol));
            }
            outNode["symbols"] = symbolArray;

            // An Avro reader fails on an unknown symbol unless the enum has a
            // default, so carry one through whenever the schema offers it.
            if (Js.Str(Js.Get(decl, "default")) is { } declaredDefault)
            {
                var mappedDefault = overrides is not null
                    ? Js.Str(Js.Get(overrides, declaredDefault)) ?? declaredDefault
                    : declaredDefault;
                if (symbols.Contains(mappedDefault, StringComparer.Ordinal))
                {
                    outNode["default"] = mappedDefault;
                }
            }

            _reserved.Add(Qualify(ns, name));
            return outNode;
        }

        // -- helpers -----------------------------------------------------------

        /// <summary>Applies §3.2: nullability, union flattening, and default placement.</summary>
        private (JsonNode Type, JsonNode? Default, bool HasDefault) Nullable(
            JsonNode baseType,
            bool required,
            bool hasDeclaredDefault,
            JsonNode? declaredDefault,
            string pointer)
        {
            var branches = FlattenUnion(baseType);

            // A required field keeps its declared type untouched.
            if (!hasDeclaredDefault && required)
            {
                return (UnionOf(branches), null, false);
            }

            var haveDefault = hasDeclaredDefault;
            JsonNode? defaultValue = declaredDefault;
            if (hasDeclaredDefault && declaredDefault is null && !required)
            {
                haveDefault = false;
                defaultValue = null;
            }

            if (!haveDefault)
            {
                if (required)
                {
                    return (UnionOf(branches), null, false);
                }
                // Optional with no usable default: `null` leads and defaults to null.
                branches.RemoveAll(IsNullBranch);
                branches.Insert(0, JsonValue.Create("null")!);
                return (UnionOf(branches), null, true);
            }

            // Avro validates a field default against the **first** branch of a union
            // and nothing else. A JSON Structure default that names a later branch
            // is not wrong, it is merely in the wrong place, so move the branch it
            // names to the front instead of emitting a default that parses cleanly
            // and then fails at read-time resolution.
            var placed = PlaceDefault(branches, defaultValue, pointer);

            if (!required && !branches.Any(IsNullBranch))
            {
                branches.Add(JsonValue.Create("null")!);
            }

            // A lone branch collapses to the bare type, where the default is checked
            // against the type itself rather than against a first branch.
            return (UnionOf(branches), placed, true);
        }

        private void CheckAdditionalProperties(JsonObject decl, string pointer)
        {
            var open = decl.TryGetPropertyValue("additionalProperties", out var value)
                && Js.Bool(value) != false;
            if (!open)
            {
                return;
            }

            const string Message =
                "Avro records are closed; `additionalProperties` cannot be carried "
                + "and undeclared properties will not be transmitted";

            if (_opts.AdditionalProperties == AdditionalPropertiesPolicy.Error)
            {
                throw AvroCompileException.Invalid(Message, pointer);
            }
            _warnings.Add(new AvroWarning(pointer, Message));
        }

        /// <summary>The declared Avro name of a type: <c>altnames.avro</c>, else <c>name</c> (§6.1).</summary>
        private string? DeclaredName(JsonObject decl, string pointer) =>
            AltName(decl, pointer) ?? Js.Str(Js.Get(decl, "name"));

        private string? AltName(JsonObject decl, string pointer)
        {
            if (Js.Obj(Js.Get(decl, "altnames")) is not { } altnames
                || !altnames.TryGetPropertyValue("avro", out var alt))
            {
                return null;
            }

            var name = Js.Str(alt)
                ?? throw AvroCompileException.Invalid(
                    "`altnames.avro` must be a string", $"{pointer}/altnames/avro");

            if (!IsAvroName(name))
            {
                throw AvroCompileException.IllegalName(name, $"{pointer}/altnames/avro");
            }
            return name;
        }

        private string? DocOf(JsonObject decl) =>
            _opts.EmitDoc ? Js.Str(Js.Get(decl, "description")) : null;

        /// <summary>
        /// §6.4.1: the <c>jsonStructure</c> attribute <c>full</c> mode emits
        /// alongside <c>doc</c>.
        /// </summary>
        /// <remarks>
        /// <para>
        /// These are the constraints Avro's type system has no place for. Putting
        /// them in an attribute rather than appending them to <c>doc</c> keeps
        /// them in the form they were written — a number stays a number, a
        /// pattern stays something a regex engine can compile — and Avro requires
        /// a parser to ignore an attribute it does not recognize, so it costs a
        /// reader that has never heard of JSON Structure nothing.
        /// </para>
        /// <para>
        /// Governed by <c>Mode</c> alone. <c>EmitDoc</c> is about prose for a
        /// human; this is metadata for a program, and coupling the two would make
        /// one option mean two things.
        /// </para>
        /// </remarks>
        private JsonObject? ConstraintsOf(JsonObject decl)
        {
            if (_opts.Mode != AvroMode.Full)
            {
                return null;
            }

            // Avro's own decimal logical type already carries these, in Avro's
            // own vocabulary. A second copy could only ever disagree with it.
            var decimalCarries = CarriesDecimalConstraints(decl);

            var out_ = new JsonObject();
            foreach (var keyword in ConstraintAnnotations)
            {
                if (decimalCarries && keyword is "precision" or "scale")
                {
                    continue;
                }
                if (Js.Get(decl, keyword) is { } value)
                {
                    out_[keyword] = value.DeepClone();
                }
            }

            return out_.Count == 0 ? null : out_;
        }

        /// <summary>
        /// Renders a primitive. <c>decimal</c> is resolved in both modes (§2.3);
        /// the <c>full</c>-mode annotations of §2.5 ride on top of the base type
        /// without changing it.
        /// </summary>
        private JsonNode PrimitiveValue(string typeName, string primitive, JsonObject decl, Ctx ctx)
        {
            if (typeName == "decimal")
            {
                return DecimalValue(decl, ctx);
            }

            if (_opts.Mode == AvroMode.Full && AvroLogical(typeName) is { } logical)
            {
                return new JsonObject
                {
                    ["type"] = JsonValue.Create(primitive),
                    ["logicalType"] = JsonValue.Create(logical),
                };
            }

            return JsonValue.Create(primitive)!;
        }

        /// <summary>
        /// §2.3: <c>decimal</c> carries Avro's own <c>decimal</c> logical type on
        /// a <c>bytes</c> base, in both modes. Avro is exactly right here, so the
        /// choice does not belong to a mode.
        /// </summary>
        /// <remarks>
        /// Avro requires a <c>precision</c> and forbids a <c>scale</c> above it.
        /// Neither can be invented, so a declaration that satisfies neither falls
        /// back to a lexical <c>string</c> with a warning.
        /// </remarks>
        private JsonNode DecimalValue(JsonObject decl, Ctx ctx)
        {
            if (Js.Get(decl, "precision") is not { } precisionNode
                || precisionNode.GetValueKind() != JsonValueKind.Number
                || !precisionNode.AsValue().TryGetValue<ulong>(out var precision))
            {
                _warnings.Add(new AvroWarning(
                    ctx.Pointer,
                    "`decimal` declares no `precision`, which Avro's decimal logical type "
                    + "requires; the value is carried as a lexical string"));
                return JsonValue.Create("string")!;
            }

            ulong scale = 0;
            if (Js.Get(decl, "scale") is { } scaleNode
                && scaleNode.GetValueKind() == JsonValueKind.Number)
            {
                scaleNode.AsValue().TryGetValue(out scale);
            }

            if (scale > precision)
            {
                _warnings.Add(new AvroWarning(
                    ctx.Pointer,
                    $"`decimal` declares scale {scale} greater than precision {precision}, "
                    + "which Avro forbids; the value is carried as a lexical string"));
                return JsonValue.Create("string")!;
            }

            return new JsonObject
            {
                ["type"] = JsonValue.Create("bytes"),
                ["logicalType"] = JsonValue.Create("decimal"),
                ["precision"] = JsonValue.Create(precision),
                ["scale"] = JsonValue.Create(scale),
            };
        }

        /// <summary>Mints a generated name, suffixing on collision (§6.3).</summary>
        private string MintName(Ctx ctx) => MintNamed(ctx.Hint, ctx);

        /// <summary>
        /// Mints a generated name from an explicit base rather than the context
        /// hint. Tagged-union branch wrappers use this: §3.7.1 wants them named
        /// for the choice key, but the name still has to be reserved like any
        /// other.
        /// </summary>
        private string MintNamed(string baseName, Ctx ctx)
        {
            var ns = ctx.Namespace;
            var candidate = baseName;
            var counter = 2;
            while (_reserved.Contains(Qualify(ns, candidate)))
            {
                candidate = $"{baseName}_{counter}";
                counter++;
            }

            if (!string.Equals(candidate, baseName, StringComparison.Ordinal))
            {
                _warnings.Add(new AvroWarning(
                    ctx.Pointer,
                    $"generated name `{Qualify(ns, baseName)}` is already taken; "
                    + $"this anonymous type is named `{Qualify(ns, candidate)}` instead"));
            }

            _reserved.Add(Qualify(ns, candidate));
            return candidate;
        }

        private static string NamespaceFor(IReadOnlyList<string> path) => string.Join(".", path);

        private (JsonNode Value, IReadOnlyList<string> Path) Resolve(string pointer, string from)
        {
            var path = DefinitionPath(pointer)
                ?? throw AvroCompileException.UnresolvedRef(pointer, from);
            var value = Lookup(path)
                ?? throw AvroCompileException.UnresolvedRef(pointer, from);
            return (value, path);
        }

        private JsonNode? Lookup(IReadOnlyList<string> path)
        {
            var current = Js.Get(_doc, "definitions");
            foreach (var segment in path)
            {
                if (current is null)
                {
                    return null;
                }
                current = Js.Get(current, segment);
            }
            return current;
        }
    }
}
