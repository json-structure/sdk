package org.json_structure.avro;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Compiles a JSON Structure document into an Apache Avro schema.
 *
 * <p>The normative mapping is {@code spec/json-structure-to-avro.md}; this class
 * is an implementation of it and the section references in the comments point
 * back at it. It is a faithful port of the Rust reference implementation, and
 * the conformance corpus under {@code test-assets/avro/} holds both to
 * byte-identical output.
 *
 * <p>The compiler is pure: no I/O, no clock, no randomness, no global state. It
 * consumes an already-consolidated document, so resolve {@code $import} before
 * calling it.
 *
 * <p>This class produces a Jackson tree. To get a parsed
 * {@code org.apache.avro.Schema} instead, use {@link JsonStructureAvro}.
 */
public final class AvroCompiler {

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private AvroCompiler() {
    }

    /**
     * Compiles with default options.
     *
     * <p>Both overloads return the warnings. Returning a bare schema from this
     * one would make discarding them the shorter thing to write, and a warning
     * is a report that something was lost in the mapping — the caller who has
     * not thought about that is exactly the caller who should see it.
     *
     * @param document a consolidated JSON Structure document
     * @return the schema and any warnings
     * @throws AvroCompileException the document cannot be represented in Avro
     */
    public static AvroCompileResult compile(JsonNode document) {
        return compile(document, AvroOptions.defaults());
    }

    /**
     * Compiles with explicit options.
     *
     * @param document a consolidated JSON Structure document
     * @param options  compilation options
     * @return the schema and any warnings
     * @throws AvroCompileException the document cannot be represented in Avro
     */
    public static AvroCompileResult compile(JsonNode document, AvroOptions options) {
        Objects.requireNonNull(document, "document");
        Objects.requireNonNull(options, "options");
        return new Worker(document, options).run();
    }

    /**
     * Serializes a compiled schema the way the conformance corpus is written:
     * two-space indent, a trailing newline, and no gratuitous escaping.
     *
     * <p>Byte-for-byte agreement with the other SDKs is a conformance
     * requirement, not a nicety — see §7 of the mapping spec — so the exact
     * writer settings are part of the contract and live here rather than at each
     * call site. That includes the line ending: LF, on every platform.
     *
     * @param schema a schema produced by {@link #compile(JsonNode)}
     * @return the {@code .avsc} text
     */
    public static String toAvsc(JsonNode schema) {
        Objects.requireNonNull(schema, "schema");
        return Js.writePretty(schema) + "\n";
    }

    // -- context and specs -----------------------------------------------------

    /**
     * Naming and error context for a schema node.
     *
     * @param namespace Avro namespace for anonymous types minted at this position
     * @param hint      base for generated names (§6.3)
     * @param pointer   JSON Pointer, for error reporting
     */
    private record Ctx(String namespace, String hint, String pointer) {

        Ctx child(String member, String pointerSegment) {
            return new Ctx(namespace, hint + "_" + member, pointer + "/" + pointerSegment);
        }

        Ctx at(String pointerSegment) {
            return new Ctx(namespace, hint, pointer + "/" + pointerSegment);
        }
    }

    /** One field of a record, after {@code $extends} and add-in flattening. */
    private record FieldSpec(String key, JsonNode schema, boolean required, String pointer) {
    }

    /** An add-in selected via {@link AvroOptions#uses()}. */
    private record AddIn(String target, ObjectNode schema, String pointer) {
    }

    /** A resolved {@code definitions} entry and the path that reached it. */
    private record Resolved(JsonNode value, List<String> path) {
    }

    /** The outcome of applying §3.2 to a field. */
    private record Nullability(JsonNode type, JsonNode defaultValue, boolean hasDefault) {
    }

    /** A {@code required} set, and the note to warn with when it was reduced. */
    private record RequiredSet(Set<String> names, String note) {
    }

    // -- the worker ------------------------------------------------------------

    private static final class Worker {

        private final JsonNode doc;
        private final AvroOptions opts;

        /**
         * Fully-qualified names whose full definition has already been emitted.
         * Membership lookups only — never iterated, per §7.2.
         */
        private final Set<String> emitted = new HashSet<>();

        /** Fully-qualified names taken, for generated-name collision suffixing. */
        private final Set<String> reserved = new HashSet<>();

        private final List<AvroWarning> warnings = new ArrayList<>();
        private final List<AddIn> addins = new ArrayList<>();

        /**
         * Selector names of inline unions. Core §Choice permits the selector to
         * shadow a base-type property, so these names are exempt from the
         * no-redefinition rule. Membership lookups only.
         */
        private Set<String> shadowable = new HashSet<>();

        Worker(JsonNode doc, AvroOptions opts) {
            this.doc = doc;
            this.opts = opts;
        }

        AvroCompileResult run() {
            shadowable = collectSelectors(doc);
            collectAddIns();
            reserveDeclaredNames();
            JsonNode schema = compileRoot();
            return new AvroCompileResult(schema, warnings);
        }

        // -- declared names ----------------------------------------------------

        /**
         * Claims the Avro fullname of every declared type before anything is
         * compiled.
         *
         * <p>Generated helper names are minted with a collision suffix, but the
         * suffixing only works against names already claimed. Reserving lazily —
         * as each type happened to be reached — let a helper minted early take a
         * name a declaration further down the document would later emit verbatim,
         * producing two Avro definitions with one fullname. Avro parsers reject
         * that outright, and a parser that did not would conflate the two types.
         *
         * <p>Reserving up front also makes helper names independent of traversal
         * order, which determinism requires.
         */
        private void reserveDeclaredNames() {
            ObjectNode definitions = Js.obj(Js.get(doc, "definitions"));
            if (definitions == null) {
                return;
            }

            List<String[]> claims = new ArrayList<>();
            walkDefinitions(definitions, List.of(), "#/definitions", claims);
            for (String[] claim : claims) {
                if (!reserved.add(claim[0])) {
                    throw AvroCompileException.invalid(
                        "two declared types both map to the Avro fullname `" + claim[0] + "`",
                        claim[1]);
                }
            }
        }

        private void walkDefinitions(
                ObjectNode node, List<String> ns, String pointer, List<String[]> outClaims) {
            Iterator<Map.Entry<String, JsonNode>> entries = node.fields();
            while (entries.hasNext()) {
                Map.Entry<String, JsonNode> entry = entries.next();
                ObjectNode map = Js.obj(entry.getValue());
                if (map == null) {
                    continue;
                }

                String childPointer = pointer + "/" + entry.getKey();
                if (isTypeDeclaration(map)) {
                    String name = declaredName(map, childPointer);
                    if (name == null) {
                        name = entry.getKey();
                    }
                    outClaims.add(new String[] {qualify(namespaceFor(ns), name), childPointer});
                } else {
                    List<String> nested = new ArrayList<>(ns);
                    nested.add(entry.getKey());
                    walkDefinitions(map, nested, childPointer, outClaims);
                }
            }
        }

        // -- add-ins (§5.5) ----------------------------------------------------

        /**
         * Resolves {@link AvroOptions#uses()} against {@code $offers}.
         *
         * <p>Iteration follows {@code $offers} document order rather than the
         * caller's order; §7.5 requires the output not to depend on how the
         * caller sorted its argument.
         */
        private void collectAddIns() {
            if (opts.uses().isEmpty()) {
                return;
            }

            ObjectNode offers = Js.obj(Js.get(doc, "$offers"));
            Set<String> requested = new HashSet<>(opts.uses());
            Set<String> found = new HashSet<>();

            if (offers != null) {
                Iterator<Map.Entry<String, JsonNode>> entries = offers.fields();
                while (entries.hasNext()) {
                    Map.Entry<String, JsonNode> entry = entries.next();
                    String name = entry.getKey();
                    if (!requested.contains(name)) {
                        continue;
                    }

                    found.add(name);
                    List<JsonNode> pointerValues = new ArrayList<>();
                    ArrayNode items = Js.arr(entry.getValue());
                    if (items != null) {
                        items.forEach(pointerValues::add);
                    } else {
                        pointerValues.add(entry.getValue());
                    }

                    for (JsonNode pointerValue : pointerValues) {
                        String pointer = Js.str(pointerValue);
                        if (pointer == null) {
                            throw AvroCompileException.invalid(
                                "`$offers` values must be JSON Pointers", "#/$offers/" + name);
                        }

                        JsonNode schema = resolve(pointer, "#/$offers/" + name).value();
                        String target = Js.str(Js.get(schema, "$extends"));
                        if (target == null) {
                            throw AvroCompileException.invalid(
                                "add-in '" + name + "' must declare a single `$extends` target",
                                pointer);
                        }

                        ObjectNode map = Js.obj(schema);
                        if (map == null) {
                            throw AvroCompileException.invalid(
                                "add-in must be a type declaration", pointer);
                        }
                        addins.add(new AddIn(target, map, pointer));
                    }
                }
            }

            for (String name : opts.uses()) {
                if (!found.contains(name)) {
                    throw AvroCompileException.unknownAddIn(name);
                }
            }
        }

        // -- roots (§5.1) ------------------------------------------------------

        private JsonNode compileRoot() {
            String rootPointer = Js.str(Js.get(doc, "$root"));
            if (rootPointer != null) {
                return compileDefinition(resolve(rootPointer, "#/$root").path(), null);
            }

            ObjectNode root = Js.obj(doc);
            if (root == null) {
                throw AvroCompileException.invalid("schema document must be a JSON object", "#");
            }

            if (!root.has("type")) {
                throw AvroCompileException.noRootType();
            }

            String name = declaredName(root, "#");
            if (name == null) {
                name = "Root";
            }
            String ns = namespaceFor(List.of());
            return buildNamed(root, name, ns, new Ctx(ns, name, "#"), "#", null);
        }

        // -- named definitions (§5.3) ------------------------------------------

        /**
         * Compiles the type at {@code path} under {@code definitions}, emitting
         * its full definition the first time and a name reference thereafter.
         */
        private JsonNode compileDefinition(List<String> path, String injectSelector) {
            String pointer = definitionPointer(path);
            JsonNode decl = lookup(path);
            if (decl == null) {
                throw AvroCompileException.unresolvedRef(pointer, pointer);
            }
            ObjectNode map = Js.obj(decl);
            if (map == null) {
                throw AvroCompileException.invalid(
                    "type declaration must be a JSON object", pointer);
            }

            if (Boolean.TRUE.equals(Js.bool(Js.get(map, "abstract")))) {
                throw AvroCompileException.invalid(
                    "abstract types cannot be used as a value type", pointer);
            }

            String key = path.isEmpty() ? "" : path.get(path.size() - 1);
            String name = declaredName(map, pointer);
            if (name == null) {
                name = key;
            }
            String ns = namespaceFor(path.subList(0, Math.max(path.size() - 1, 0)));
            String fullName = qualify(ns, name);

            if (emitted.contains(fullName)) {
                return TextNode.valueOf(fullName);
            }

            emitted.add(fullName);
            reserved.add(fullName);

            return buildNamed(map, name, ns, new Ctx(ns, name, pointer), pointer, injectSelector);
        }

        /** Builds the definition body for a type that has a settled name. */
        private JsonNode buildNamed(
                ObjectNode decl,
                String name,
                String ns,
                Ctx ctx,
                String pointer,
                String injectSelector) {
            JsonNode enumSchema = tryEnum(decl, name, ns, pointer);
            if (enumSchema != null) {
                return enumSchema;
            }

            if (!decl.has("type")) {
                throw AvroCompileException.invalid(
                    "type declaration is missing the `type` keyword", pointer);
            }

            String typeName = Js.str(decl.get("type"));
            if (typeName != null) {
                return switch (typeName) {
                    case "object" -> buildRecord(decl, name, ns, ctx, pointer, injectSelector);
                    case "tuple" -> buildTuple(decl, name, ns, ctx, pointer);
                    case "choice" -> buildChoice(decl, name, ns, ctx, pointer);
                    case "any" -> anyRecord(name, ns, pointer);
                    default -> compileInline(decl, ctx);
                };
            }

            return compileInline(decl, ctx);
        }

        // -- records (§3.1, §3.2) ----------------------------------------------

        private JsonNode buildRecord(
                ObjectNode decl,
                String name,
                String ns,
                Ctx ctx,
                String pointer,
                String injectSelector) {
            checkAdditionalProperties(decl, pointer);

            List<FieldSpec> specs = new ArrayList<>();
            Set<String> seen = new LinkedHashSet<>();
            collectFields(decl, pointer, specs, seen);

            // §3.7.2: the inline-union selector is materialized as the first field
            // unless the branch already declares it.
            ArrayNode fields = NODES.arrayNode();
            if (injectSelector != null && !seen.contains(injectSelector)) {
                ObjectNode selectorField = NODES.objectNode();
                selectorField.set("name", TextNode.valueOf(injectSelector));
                selectorField.set("type", TextNode.valueOf("string"));
                fields.add(selectorField);
            }

            for (FieldSpec spec : specs) {
                fields.add(buildField(spec, ctx));
            }

            ObjectNode out = NODES.objectNode();
            out.set("type", TextNode.valueOf("record"));
            out.set("name", TextNode.valueOf(name));
            if (!ns.isEmpty()) {
                out.set("namespace", TextNode.valueOf(ns));
            }
            String doc = docOf(decl);
            if (doc != null) {
                out.set("doc", TextNode.valueOf(doc));
            }
            ObjectNode annotations = annotationsOf(decl, pointer);
            if (annotations != null) {
                out.set("annotations", annotations);
            }
            out.set("fields", fields);
            return out;
        }

        private JsonNode buildField(FieldSpec spec, Ctx ctx) {
            ObjectNode decl = Js.obj(spec.schema());
            if (decl == null) {
                throw AvroCompileException.invalid(
                    "property schema must be a JSON object", spec.pointer());
            }

            String altName = altName(decl, spec.pointer());
            String fieldName = altName != null ? altName : spec.key();
            Ctx child = new Ctx(ctx.namespace(), ctx.hint() + "_" + spec.key(), spec.pointer());
            JsonNode baseType = compileInline(decl, child);

            boolean hasDefault = decl.has("default");
            JsonNode declaredDefault = hasDefault ? decl.get("default") : null;
            Nullability nullability =
                nullable(baseType, spec.required(), hasDefault, declaredDefault, spec.pointer());

            // Avro has no notion of a fixed value. A `const` becomes an ordinary
            // field that any writer may set to anything, which is worth saying out
            // loud rather than dropping on the floor.
            if (decl.has("const")) {
                warnings.add(new AvroWarning(
                    spec.pointer(), "Avro cannot express `const`; the value is not enforced"));
            }

            ObjectNode out = NODES.objectNode();
            out.set("name", TextNode.valueOf(fieldName));
            out.set("type", nullability.type());
            String doc = docOf(decl);
            if (doc != null) {
                out.set("doc", TextNode.valueOf(doc));
            }
            ObjectNode annotations = annotationsOf(decl, spec.pointer());
            if (annotations != null) {
                out.set("annotations", annotations);
            }
            if (nullability.hasDefault()) {
                out.set(
                    "default",
                    nullability.defaultValue() == null
                        ? NODES.nullNode()
                        : nullability.defaultValue());
            }
            return out;
        }

        /**
         * {@code required} for one declaration, warning when Core's alternative
         * sets had to be collapsed to their intersection.
         */
        private Set<String> requiredHere(ObjectNode decl, String pointer) {
            RequiredSet set = requiredSet(decl);
            if (set.note() != null) {
                warnings.add(new AvroWarning(pointer, set.note()));
            }
            return set.names();
        }

        /**
         * Flattens {@code $extends} bases, own properties, and add-ins into one
         * ordered field list (§5.4, §5.5). Base fields come first; with multiple
         * bases the first in the array wins.
         */
        private void collectFields(
                ObjectNode decl, String pointer, List<FieldSpec> outSpecs, Set<String> seen) {
            collectFieldsFrom(decl, pointer, outSpecs, seen, new ArrayList<>());
        }

        private void collectFieldsFrom(
                ObjectNode decl,
                String pointer,
                List<FieldSpec> outSpecs,
                Set<String> seen,
                List<String> chain) {
            // Core forbids `$extends` cycles. Without this the recursion below
            // overflows the stack rather than reporting the schema error.
            if (chain.contains(pointer)) {
                chain.add(pointer);
                throw AvroCompileException.invalid(
                    "`$extends` cycle: " + String.join(" -> ", chain), pointer);
            }
            chain.add(pointer);

            // Names already contributed by an enclosing call or by an earlier
            // sibling base. Core says the first base in the array wins, so a
            // collision against these is legal; a collision against a name from
            // *our own* extends chain is not.
            Set<String> outer = new HashSet<>(seen);

            if (decl.has("$extends")) {
                for (String basePointer : pointerList(decl.get("$extends"), pointer)) {
                    JsonNode baseNode = resolve(basePointer, pointer).value();
                    ObjectNode baseMap = Js.obj(baseNode);
                    if (baseMap == null) {
                        throw AvroCompileException.invalid(
                            "`$extends` must point at a type declaration", pointer);
                    }
                    collectFieldsFrom(baseMap, basePointer, outSpecs, seen, chain);
                }
            }

            Set<String> required = requiredHere(decl, pointer);
            ObjectNode properties = Js.obj(Js.get(decl, "properties"));
            if (properties != null) {
                Iterator<Map.Entry<String, JsonNode>> entries = properties.fields();
                while (entries.hasNext()) {
                    Map.Entry<String, JsonNode> entry = entries.next();
                    String key = entry.getKey();
                    if (seen.contains(key)) {
                        // Core: an extending type MUST NOT redefine an inherited
                        // property. The one exception is an inline union's
                        // selector, which MAY shadow a base property.
                        if (!outer.contains(key) && !shadowable.contains(key)) {
                            throw AvroCompileException.invalid(
                                "property '" + key
                                    + "' is inherited through `$extends` and MUST NOT be redefined",
                                pointer + "/properties/" + key);
                        }
                        continue;
                    }

                    seen.add(key);
                    JsonNode schema = entry.getValue();
                    if (schema == null || schema.isNull()) {
                        throw AvroCompileException.invalid(
                            "property schema must be a JSON object",
                            pointer + "/properties/" + key);
                    }
                    outSpecs.add(new FieldSpec(
                        key,
                        schema.deepCopy(),
                        required.contains(key),
                        pointer + "/properties/" + key));
                }
            }

            // Add-ins targeting this exact type append after its own properties.
            for (AddIn addin : addins) {
                if (!addin.target().equals(pointer)) {
                    continue;
                }
                Set<String> addinRequired = requiredHere(addin.schema(), addin.pointer());
                ObjectNode addinProperties = Js.obj(Js.get(addin.schema(), "properties"));
                if (addinProperties == null) {
                    continue;
                }
                Iterator<Map.Entry<String, JsonNode>> entries = addinProperties.fields();
                while (entries.hasNext()) {
                    Map.Entry<String, JsonNode> entry = entries.next();
                    String key = entry.getKey();
                    if (seen.contains(key)) {
                        continue;
                    }
                    seen.add(key);
                    JsonNode prop = entry.getValue();
                    if (prop == null || prop.isNull()) {
                        throw AvroCompileException.invalid(
                            "property schema must be a JSON object",
                            addin.pointer() + "/properties/" + key);
                    }
                    outSpecs.add(new FieldSpec(
                        key,
                        prop.deepCopy(),
                        addinRequired.contains(key),
                        addin.pointer() + "/properties/" + key));
                }
            }

            // `chain` tracks ancestors only. Popping here is what lets a diamond
            // (two bases sharing a grandparent) through while a true cycle fails.
            chain.remove(chain.size() - 1);
        }

        // -- tuples (§3.5) -----------------------------------------------------

        private JsonNode buildTuple(
                ObjectNode decl, String name, String ns, Ctx ctx, String pointer) {
            ArrayNode order = Js.arr(Js.get(decl, "tuple"));
            if (order == null) {
                throw AvroCompileException.invalid(
                    "`tuple` types require the `tuple` keyword", pointer);
            }

            List<FieldSpec> specs = new ArrayList<>();
            collectFields(decl, pointer, specs, new LinkedHashSet<>());

            ArrayNode fields = NODES.arrayNode();
            for (JsonNode entry : order) {
                String key = Js.str(entry);
                if (key == null) {
                    throw AvroCompileException.invalid(
                        "`tuple` entries must be property names", pointer);
                }

                FieldSpec spec = null;
                for (FieldSpec candidate : specs) {
                    if (candidate.key().equals(key)) {
                        spec = candidate;
                        break;
                    }
                }
                if (spec == null) {
                    throw AvroCompileException.invalid(
                        "`tuple` names unknown property '" + key + "'", pointer);
                }

                // All tuple properties are implicitly required (§3.5).
                fields.add(buildField(
                    new FieldSpec(spec.key(), spec.schema(), true, spec.pointer()), ctx));
            }

            ObjectNode out = NODES.objectNode();
            out.set("type", TextNode.valueOf("record"));
            out.set("name", TextNode.valueOf(name));
            if (!ns.isEmpty()) {
                out.set("namespace", TextNode.valueOf(ns));
            }
            String doc = docOf(decl);
            if (doc != null) {
                out.set("doc", TextNode.valueOf(doc));
            }
            ObjectNode annotations = annotationsOf(decl, pointer);
            if (annotations != null) {
                out.set("annotations", annotations);
            }
            out.set("fields", fields);
            return out;
        }

        // -- choices (§3.7) ----------------------------------------------------

        private JsonNode buildChoice(
                ObjectNode decl, String name, String ns, Ctx ctx, String pointer) {
            ObjectNode choices = Js.obj(Js.get(decl, "choices"));
            if (choices == null) {
                throw AvroCompileException.invalid(
                    "`choice` types require the `choices` keyword", pointer);
            }

            String selector = Js.str(Js.get(decl, "selector"));
            boolean inline = decl.has("$extends") && selector != null;

            List<JsonNode> branches = new ArrayList<>();
            Iterator<Map.Entry<String, JsonNode>> entries = choices.fields();
            while (entries.hasNext()) {
                Map.Entry<String, JsonNode> entry = entries.next();
                String key = entry.getKey();
                JsonNode branch = entry.getValue();
                String branchPointer = pointer + "/choices/" + key;

                if (inline) {
                    String branchRef = Js.str(Js.get(Js.get(branch, "type"), "$ref"));
                    if (branchRef == null) {
                        throw AvroCompileException.invalid(
                            "inline union choices must be `$ref` to a named type", branchPointer);
                    }
                    branches.add(
                        compileDefinition(resolve(branchRef, branchPointer).path(), selector));
                    continue;
                }

                ObjectNode branchMap = Js.obj(branch);
                if (branchMap == null) {
                    throw AvroCompileException.invalid(
                        "choice branches must be schema objects", branchPointer);
                }

                Ctx child = new Ctx(ns, ctx.hint() + "_" + key, branchPointer);
                JsonNode compiled = compileInline(branchMap, child);

                // §3.7.1: use the branch directly when its Avro name already equals
                // the choice key, otherwise wrap it in a record named for the key.
                if (key.equals(unqualifiedName(compiled))) {
                    branches.add(compiled);
                } else {
                    ObjectNode wrapper = NODES.objectNode();
                    wrapper.set("type", TextNode.valueOf("record"));
                    wrapper.set("name", TextNode.valueOf(mintNamed(key, child)));
                    if (!ns.isEmpty()) {
                        wrapper.set("namespace", TextNode.valueOf(ns));
                    }
                    ObjectNode valueField = NODES.objectNode();
                    valueField.set("name", TextNode.valueOf("value"));
                    valueField.set("type", compiled);
                    ArrayNode wrapperFields = NODES.arrayNode();
                    wrapperFields.add(valueField);
                    wrapper.set("fields", wrapperFields);
                    branches.add(wrapper);
                }
            }

            // A choice is a union, and Avro unions are not named. The choice's own
            // name survives only through the branch wrappers.
            return unionOf(branches);
        }

        // -- inline schemas ----------------------------------------------------

        /** Compiles a schema node that is not itself a {@code definitions} entry. */
        private JsonNode compileInline(ObjectNode decl, Ctx ctx) {
            ObjectNode inner = Js.obj(Js.get(decl, "type"));
            if (inner != null) {
                String inlineRef = Js.str(Js.get(inner, "$ref"));
                if (inlineRef != null) {
                    return compileDefinition(resolve(inlineRef, ctx.pointer()).path(), null);
                }
            }

            // An anonymous enum needs a minted name.
            if (decl.has("enum")) {
                JsonNode enumSchema =
                    tryEnum(decl, mintName(ctx), ctx.namespace(), ctx.pointer());
                if (enumSchema != null) {
                    return enumSchema;
                }
            }

            if (!decl.has("type")) {
                throw AvroCompileException.invalid(
                    "schema is missing the `type` keyword", ctx.pointer());
            }

            JsonNode typeValue = decl.get("type");
            String typeName = Js.str(typeValue);
            if (typeName != null) {
                return compileTypeName(typeName, decl, ctx);
            }

            ArrayNode unionBranches = Js.arr(typeValue);
            if (unionBranches != null) {
                List<JsonNode> compiled = new ArrayList<>();
                for (int index = 0; index < unionBranches.size(); index++) {
                    compiled.add(
                        compileUnionBranch(unionBranches.get(index), ctx.at("type/" + index)));
                }
                return unionOf(compiled);
            }

            throw AvroCompileException.invalid(
                "unsupported `type` value: " + Js.compact(typeValue), ctx.pointer());
        }

        private JsonNode compileUnionBranch(JsonNode branch, Ctx ctx) {
            String primitiveName = Js.str(branch);
            if (primitiveName != null) {
                return compileTypeName(primitiveName, NODES.objectNode(), ctx);
            }

            ObjectNode map = Js.obj(branch);
            if (map != null) {
                String reference = Js.str(Js.get(map, "$ref"));
                if (reference != null) {
                    return compileDefinition(resolve(reference, ctx.pointer()).path(), null);
                }
                return compileInline(map, ctx);
            }

            throw AvroCompileException.invalid(
                "unsupported union branch: " + Js.compact(branch), ctx.pointer());
        }

        private JsonNode compileTypeName(String typeName, ObjectNode decl, Ctx ctx) {
            String primitive = avroPrimitive(typeName);
            if (primitive != null) {
                return primitiveValue(typeName, primitive, decl, ctx);
            }

            switch (typeName) {
                case "array", "set" -> {
                    if (typeName.equals("set")) {
                        // Avro has no set type. The values survive; the uniqueness
                        // constraint does not.
                        warnings.add(new AvroWarning(
                            ctx.pointer(),
                            "Avro has no set type; uniqueness is not enforced on the wire"));
                    }

                    ObjectNode items = Js.obj(Js.get(decl, "items"));
                    if (items == null) {
                        throw AvroCompileException.invalid(
                            "`" + typeName + "` requires `items`", ctx.pointer());
                    }
                    ObjectNode out = NODES.objectNode();
                    out.set("type", TextNode.valueOf("array"));
                    out.set("items", compileInline(items, ctx.child("item", "items")));
                    return out;
                }
                case "map" -> {
                    ObjectNode values = Js.obj(Js.get(decl, "values"));
                    if (values == null) {
                        throw AvroCompileException.invalid(
                            "`map` requires `values`", ctx.pointer());
                    }
                    ObjectNode out = NODES.objectNode();
                    out.set("type", TextNode.valueOf("map"));
                    out.set("values", compileInline(values, ctx.child("value", "values")));
                    return out;
                }
                case "object" -> {
                    return buildRecord(
                        decl, mintName(ctx), ctx.namespace(), ctx, ctx.pointer(), null);
                }
                case "tuple" -> {
                    return buildTuple(decl, mintName(ctx), ctx.namespace(), ctx, ctx.pointer());
                }
                case "choice" -> {
                    return buildChoice(decl, mintName(ctx), ctx.namespace(), ctx, ctx.pointer());
                }
                case "any" -> {
                    return anyRecord(mintName(ctx), ctx.namespace(), ctx.pointer());
                }
                default -> throw AvroCompileException.invalid(
                    "unknown type '" + typeName + "'", ctx.pointer());
            }
        }

        // -- any (§3.6) --------------------------------------------------------

        /**
         * {@code any} compiles to a zero-field record: a hole a writer schema
         * fills in and a reader schema steps over.
         *
         * <p>This is asymmetric, and the asymmetry is the whole point, so it is
         * worth stating plainly. Avro resolves records by name and ignores writer
         * fields the reader does not declare. A reader holding this empty record
         * therefore accepts <em>whatever</em> the writer put there and hands back
         * an empty record — the data is read as if the reader did not know its
         * shape, which is exactly what {@code any} means.
         *
         * <p>What you cannot do is write through the hole. The compiled schema is
         * a reader schema at this position. To produce data, compile or
         * hand-write a writer schema in which the hole is filled with the
         * concrete type.
         */
        private JsonNode anyRecord(String name, String ns, String pointer) {
            warnings.add(new AvroWarning(
                pointer,
                "`any` compiles to an empty Avro record: readable but not writable at this "
                    + "position. A writer must supply a schema that fills the hole with a "
                    + "concrete type; inside `array`/`map` every element must share that one "
                    + "type, because Avro collections are homogeneous"));
            return emptyRecord(name, ns);
        }

        // -- enums (§4.1) ------------------------------------------------------

        private JsonNode tryEnum(ObjectNode decl, String name, String ns, String pointer) {
            ArrayNode values = Js.arr(Js.get(decl, "enum"));
            if (values == null) {
                return null;
            }
            if (!"string".equals(Js.str(Js.get(decl, "type")))) {
                return null;
            }

            ObjectNode overrides = Js.obj(Js.get(Js.get(decl, "altenums"), "avro"));

            List<String> symbols = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (JsonNode value : values) {
                String raw = Js.str(value);
                if (raw == null) {
                    return null;
                }

                String symbol;
                String mapped = overrides == null ? null : Js.str(Js.get(overrides, raw));
                if (mapped != null) {
                    if (!isAvroName(mapped)) {
                        throw AvroCompileException.illegalName(
                            mapped, pointer + "/altenums/avro/" + raw);
                    }
                    symbol = mapped;
                } else {
                    // Not expressible as an Avro enum; fall back to `string`.
                    if (!isAvroName(raw)) {
                        return null;
                    }
                    symbol = raw;
                }

                if (!seen.add(symbol)) {
                    return null;
                }
                symbols.add(symbol);
            }

            if (symbols.isEmpty()) {
                return null;
            }

            ObjectNode out = NODES.objectNode();
            out.set("type", TextNode.valueOf("enum"));
            out.set("name", TextNode.valueOf(name));
            if (!ns.isEmpty()) {
                out.set("namespace", TextNode.valueOf(ns));
            }
            String doc = docOf(decl);
            if (doc != null) {
                out.set("doc", TextNode.valueOf(doc));
            }
            ObjectNode annotations = annotationsOf(decl, pointer);
            if (annotations != null) {
                out.set("annotations", annotations);
            }

            ArrayNode symbolArray = NODES.arrayNode();
            for (String symbol : symbols) {
                symbolArray.add(TextNode.valueOf(symbol));
            }
            out.set("symbols", symbolArray);

            // An Avro reader fails on an unknown symbol unless the enum has a
            // default, so carry one through whenever the schema offers it.
            String declaredDefault = Js.str(Js.get(decl, "default"));
            if (declaredDefault != null) {
                String mappedDefault = declaredDefault;
                if (overrides != null) {
                    String override = Js.str(Js.get(overrides, declaredDefault));
                    if (override != null) {
                        mappedDefault = override;
                    }
                }
                if (symbols.contains(mappedDefault)) {
                    out.set("default", TextNode.valueOf(mappedDefault));
                }
            }

            reserved.add(qualify(ns, name));
            return out;
        }

        // -- helpers -----------------------------------------------------------

        /** Applies §3.2: nullability, union flattening, and default placement. */
        private Nullability nullable(
                JsonNode baseType,
                boolean required,
                boolean hasDeclaredDefault,
                JsonNode declaredDefault,
                String pointer) {
            List<JsonNode> branches = flattenUnion(baseType);

            // A required field keeps its declared type untouched.
            if (!hasDeclaredDefault && required) {
                return new Nullability(unionOf(branches), null, false);
            }

            boolean haveDefault = hasDeclaredDefault;
            JsonNode defaultValue = declaredDefault;
            if (hasDeclaredDefault && isJsonNull(declaredDefault) && !required) {
                haveDefault = false;
                defaultValue = null;
            }

            if (!haveDefault) {
                if (required) {
                    return new Nullability(unionOf(branches), null, false);
                }
                // Optional with no usable default: `null` leads and defaults to null.
                branches.removeIf(AvroCompiler::isNullBranch);
                branches.add(0, TextNode.valueOf("null"));
                return new Nullability(unionOf(branches), null, true);
            }

            // Avro validates a field default against the **first** branch of a union
            // and nothing else. A JSON Structure default that names a later branch
            // is not wrong, it is merely in the wrong place, so move the branch it
            // names to the front instead of emitting a default that parses cleanly
            // and then fails at read-time resolution.
            JsonNode placed = placeDefault(branches, defaultValue, pointer);

            if (!required && branches.stream().noneMatch(AvroCompiler::isNullBranch)) {
                branches.add(TextNode.valueOf("null"));
            }

            // A lone branch collapses to the bare type, where the default is checked
            // against the type itself rather than against a first branch.
            return new Nullability(unionOf(branches), placed, true);
        }

        private void checkAdditionalProperties(ObjectNode decl, String pointer) {
            boolean open = decl.has("additionalProperties")
                && !Boolean.FALSE.equals(Js.bool(decl.get("additionalProperties")));
            if (!open) {
                return;
            }

            String message = "Avro records are closed; `additionalProperties` cannot be carried "
                + "and undeclared properties will not be transmitted";

            if (opts.additionalProperties() == AdditionalPropertiesPolicy.ERROR) {
                throw AvroCompileException.invalid(message, pointer);
            }
            warnings.add(new AvroWarning(pointer, message));
        }

        /**
         * The declared Avro name of a type: {@code altnames.avro}, else
         * {@code name} (§6.1).
         */
        private String declaredName(ObjectNode decl, String pointer) {
            String alt = altName(decl, pointer);
            return alt != null ? alt : Js.str(Js.get(decl, "name"));
        }

        private String altName(ObjectNode decl, String pointer) {
            ObjectNode altnames = Js.obj(Js.get(decl, "altnames"));
            if (altnames == null || !altnames.has("avro")) {
                return null;
            }

            String name = Js.str(altnames.get("avro"));
            if (name == null) {
                throw AvroCompileException.invalid(
                    "`altnames.avro` must be a string", pointer + "/altnames/avro");
            }

            if (!isAvroName(name)) {
                throw AvroCompileException.illegalName(name, pointer + "/altnames/avro");
            }
            return name;
        }

        private String docOf(ObjectNode decl) {
            return opts.emitDoc() ? Js.str(Js.get(decl, "description")) : null;
        }

        /**
         * §6.4.1: the {@code annotations} attribute {@code full} mode emits
         * alongside {@code doc}.
         *
         * <p>These are the things Avro's type system has no place for: the
         * constraints, the unit and currency annotations, and the semantic
         * annotations that carry no property names. Putting them in an attribute
         * rather than appending them to {@code doc} keeps them in the form they
         * were written — a number stays a number, a pattern stays something a
         * regex engine can compile — and Avro requires a parser to ignore an
         * attribute it does not recognize, so it costs a reader that has never
         * heard of JSON Structure nothing.
         *
         * <p>Emitted on whatever object carries {@code doc}, which for a record
         * or enum is the type object. {@code concepts} and
         * {@code observedProperty} annotate a type, so the type object is not a
         * theoretical case.
         *
         * <p>Governed by the mode alone. {@code emitDoc} is about prose for a
         * human; this is metadata for a program, and coupling the two would make
         * one option mean two things.
         */
        private ObjectNode annotationsOf(ObjectNode decl, String pointer) {
            // A name-binding annotation is lost in both modes, so it is reported
            // in both. Unlike a constraint, `full` mode cannot rescue it.
            for (String keyword : NAME_BINDING_ANNOTATIONS) {
                if (decl.has(keyword)) {
                    warnings.add(new AvroWarning(
                        pointer,
                        "`" + keyword + "` names properties of the annotated type, and Avro "
                            + "field names are not the names it binds; the annotation is "
                            + "dropped"));
                }
            }

            if (opts.mode() != AvroMode.FULL) {
                return null;
            }

            // Avro's own decimal logical type already carries these, in Avro's
            // own vocabulary. A second copy could only ever disagree with it.
            boolean decimalCarries = carriesDecimalConstraints(decl);

            ObjectNode out = NODES.objectNode();
            for (String keyword : ANNOTATION_KEYWORDS) {
                if (decimalCarries && (keyword.equals("precision") || keyword.equals("scale"))) {
                    continue;
                }
                JsonNode value = Js.get(decl, keyword);
                if (value != null) {
                    out.set(keyword, value.deepCopy());
                }
            }

            return out.isEmpty() ? null : out;
        }

        /**
         * Renders a primitive. {@code decimal} is resolved in both modes (§2.3);
         * the {@code full}-mode annotations of §2.5 ride on top of the base type
         * without changing it.
         */
        private JsonNode primitiveValue(
                String typeName, String primitive, ObjectNode decl, Ctx ctx) {
            if (typeName.equals("decimal")) {
                return decimalValue(decl, ctx);
            }

            if (opts.mode() == AvroMode.FULL) {
                String logical = avroLogical(typeName);
                if (logical != null) {
                    ObjectNode out = NODES.objectNode();
                    out.set("type", TextNode.valueOf(primitive));
                    out.set("logicalType", TextNode.valueOf(logical));
                    return out;
                }
            }

            return TextNode.valueOf(primitive);
        }

        /**
         * §2.3: {@code decimal} carries Avro's own {@code decimal} logical type
         * on a {@code bytes} base, in both modes. Avro is exactly right here, so
         * the choice does not belong to a mode.
         *
         * <p>Avro requires a {@code precision} and forbids a {@code scale} above
         * it. Neither can be invented, so a declaration that satisfies neither
         * falls back to a lexical {@code string} with a warning.
         */
        private JsonNode decimalValue(ObjectNode decl, Ctx ctx) {
            BigInteger precision = unsigned(Js.get(decl, "precision"));
            if (precision == null) {
                warnings.add(new AvroWarning(
                    ctx.pointer(),
                    "`decimal` declares no `precision`, which Avro's decimal logical type "
                        + "requires; the value is carried as a lexical string"));
                return TextNode.valueOf("string");
            }

            BigInteger scale = unsigned(Js.get(decl, "scale"));
            if (scale == null) {
                scale = BigInteger.ZERO;
            }

            if (scale.compareTo(precision) > 0) {
                warnings.add(new AvroWarning(
                    ctx.pointer(),
                    "`decimal` declares scale " + scale + " greater than precision " + precision
                        + ", which Avro forbids; the value is carried as a lexical string"));
                return TextNode.valueOf("string");
            }

            ObjectNode out = NODES.objectNode();
            out.set("type", TextNode.valueOf("bytes"));
            out.set("logicalType", TextNode.valueOf("decimal"));
            out.set("precision", NODES.numberNode(precision));
            out.set("scale", NODES.numberNode(scale));
            return out;
        }

        /** Mints a generated name, suffixing on collision (§6.3). */
        private String mintName(Ctx ctx) {
            return mintNamed(ctx.hint(), ctx);
        }

        /**
         * Mints a generated name from an explicit base rather than the context
         * hint. Tagged-union branch wrappers use this: §3.7.1 wants them named
         * for the choice key, but the name still has to be reserved like any
         * other.
         */
        private String mintNamed(String baseName, Ctx ctx) {
            String ns = ctx.namespace();
            String candidate = baseName;
            int counter = 2;
            while (reserved.contains(qualify(ns, candidate))) {
                candidate = baseName + "_" + counter;
                counter++;
            }

            if (!candidate.equals(baseName)) {
                warnings.add(new AvroWarning(
                    ctx.pointer(),
                    "generated name `" + qualify(ns, baseName) + "` is already taken; "
                        + "this anonymous type is named `" + qualify(ns, candidate)
                        + "` instead"));
            }

            reserved.add(qualify(ns, candidate));
            return candidate;
        }

        private Resolved resolve(String pointer, String from) {
            List<String> path = definitionPath(pointer);
            if (path == null) {
                throw AvroCompileException.unresolvedRef(pointer, from);
            }
            JsonNode value = lookup(path);
            if (value == null) {
                throw AvroCompileException.unresolvedRef(pointer, from);
            }
            return new Resolved(value, path);
        }

        private JsonNode lookup(List<String> path) {
            JsonNode current = Js.get(doc, "definitions");
            for (String segment : path) {
                if (current == null) {
                    return null;
                }
                current = Js.get(current, segment);
            }
            return current;
        }
    }

    // -- static tables and pure helpers ----------------------------------------

    /** The primitive mapping table of §2. {@code null} means the name is not a primitive. */
    private static String avroPrimitive(String typeName) {
        return switch (typeName) {
            case "null" -> "null";
            case "boolean" -> "boolean";
            case "string" -> "string";
            case "number" -> "double";
            case "integer", "int8", "int16", "int32", "uint8", "uint16" -> "int";
            case "int64", "uint32" -> "long";
            // Lossless by construction: these exceed a signed 64-bit range or have
            // no bounded binary form, so they travel in their lexical form (§2.2).
            case "int128", "uint64", "uint128" -> "string";
            case "float8", "float" -> "float";
            case "double" -> "double";
            // Avro has no offset-carrying temporal type; RFC 3339 text keeps it.
            case "date", "time", "datetime", "duration" -> "string";
            case "uuid", "uri", "jsonpointer" -> "string";
            case "binary" -> "bytes";
            // §2.3: the base for Avro's own `decimal` logical type, in both modes.
            // `decimalValue` may still fall back to `string` when the declaration
            // gives Avro nothing it can work with.
            case "decimal" -> "bytes";
            default -> null;
        };
    }

    /**
     * The {@code full}-mode annotation for a primitive (§2.5), or {@code null}
     * where the mode adds nothing. Purely additive: it rides on top of the base
     * type {@link #avroPrimitive} already chose.
     *
     * <p>The {@code rfc3339-*} names are Avrotize's extension, and are not
     * reserved Avro logical types. That is exactly the point: a reader that does
     * not know the name sees the {@code string} base and is correct, so the two
     * modes describe byte-identical data.
     */
    private static String avroLogical(String typeName) {
        return switch (typeName) {
            case "date" -> "rfc3339-date";
            case "time" -> "rfc3339-time-micros";
            case "datetime" -> "rfc3339-timestamp-micros";
            case "duration" -> "rfc3339-duration";
            case "uuid" -> "uuid";
            default -> null;
        };
    }

    /**
     * The keywords §6.4.1 carries in the {@code annotations} attribute in
     * {@code full} mode, in their fixed emission order.
     *
     * <p>Three groups, in this order: the constraints Avro's type system cannot
     * express, the unit and symbol annotations of JSON Structure Units, and the
     * semantic annotations that carry no property names. The order is fixed
     * rather than derived from the source document so that two conforming
     * implementations emit the same bytes.
     */
    private static final List<String> ANNOTATION_KEYWORDS = List.of(
        // Constraints (JSON Structure Core and Validation).
        "maxLength",
        "minLength",
        "precision",
        "scale",
        "pattern",
        "minimum",
        "maximum",
        "contentEncoding",
        "contentMediaType",
        "contentCompression",
        // Symbols, units, and currencies.
        "symbol",
        "symbols",
        "unit",
        "ucumUnit",
        "currency",
        // Semantic annotations whose values are self-contained.
        "concepts",
        "observedProperty",
        "semanticRole",
        "derivation",
        "statistic",
        "phenomenonTimeRelation",
        "supportPeriod",
        "cadence",
        "codedValues",
        "measurementConditioning");

    /**
     * The semantic annotations that bind <em>property names</em> of the type
     * they annotate, and are therefore dropped with a warning rather than
     * copied.
     *
     * <p>{@code coordinateReferenceSystem}, for instance, carries a
     * {@code coordinates} array naming the properties that form a coordinate.
     * Those are JSON Structure property names, and JSON Structure Semantic
     * Annotations is explicit that an alternate name does not change the
     * identity an annotation binds. Avro is the renamed world:
     * {@code altnames.avro} and the name rules of §6 mean a field can reach the
     * schema under a different name, or as a member of a different record after
     * flattening. Copying the annotation verbatim would leave it naming fields
     * that do not exist, silently, which is worse than not carrying it at all.
     */
    private static final List<String> NAME_BINDING_ANNOTATIONS = List.of(
        "coordinateReferenceSystem",
        "vectorReferenceFrames",
        "tensorReferenceFrames",
        "frameTransforms",
        "linearReferenceSystem",
        "colorSpaces",
        "audioChannels",
        "spectralBands",
        "temporalReferenceSystem",
        "referenceRole");

    /**
     * Whether this declaration's {@code precision} and {@code scale} reached the
     * wire as Avro {@code decimal} attributes, in which case §6.4.1 forbids
     * repeating them.
     *
     * <p>Mirrors the fallback conditions of {@code decimalValue}: a
     * {@code decimal} with no {@code precision}, or a {@code scale} above it, is
     * carried as a lexical string and its constraints are annotated like anyone
     * else's.
     */
    private static boolean carriesDecimalConstraints(ObjectNode decl) {
        if (!"decimal".equals(Js.str(Js.get(decl, "type")))) {
            return false;
        }
        BigInteger precision = unsigned(Js.get(decl, "precision"));
        if (precision == null) {
            return false;
        }
        BigInteger scale = unsigned(Js.get(decl, "scale"));
        return (scale == null ? BigInteger.ZERO : scale).compareTo(precision) <= 0;
    }

    /** Reads a JSON node as a non-negative integer, or {@code null}. */
    private static BigInteger unsigned(JsonNode node) {
        if (node == null || !node.isIntegralNumber()) {
            return null;
        }
        BigInteger value = node.bigIntegerValue();
        return value.signum() < 0 ? null : value;
    }

    /** Avro identifier rule, which is also JSON Structure's identifier rule. */
    private static boolean isAvroName(String name) {
        if (name.isEmpty()) {
            return false;
        }
        char first = name.charAt(0);
        if (!(isAsciiLetter(first) || first == '_')) {
            return false;
        }
        for (int i = 1; i < name.length(); i++) {
            char c = name.charAt(i);
            if (!(isAsciiLetter(c) || isAsciiDigit(c) || c == '_')) {
                return false;
            }
        }
        return true;
    }

    private static boolean isAsciiLetter(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    private static boolean isAsciiDigit(char c) {
        return c >= '0' && c <= '9';
    }

    private static String qualify(String ns, String name) {
        return ns.isEmpty() ? name : ns + "." + name;
    }

    private static String namespaceFor(List<String> path) {
        return String.join(".", path);
    }

    private static String definitionPointer(List<String> path) {
        return path.isEmpty() ? "#/definitions" : "#/definitions/" + String.join("/", path);
    }

    private static List<String> definitionPath(String pointer) {
        String prefix = "#/definitions/";
        if (!pointer.startsWith(prefix)) {
            return null;
        }
        String rest = pointer.substring(prefix.length());
        return rest.isEmpty() ? null : new ArrayList<>(Arrays.asList(rest.split("/")));
    }

    private static List<String> pointerList(JsonNode value, String path) {
        String single = Js.str(value);
        if (single != null) {
            return List.of(single);
        }

        ArrayNode items = Js.arr(value);
        if (items != null) {
            List<String> result = new ArrayList<>(items.size());
            for (JsonNode item : items) {
                String pointer = Js.str(item);
                if (pointer == null) {
                    throw AvroCompileException.invalid(
                        "`$extends` entries must be JSON Pointers", path);
                }
                result.add(pointer);
            }
            return result;
        }

        throw AvroCompileException.invalid(
            "`$extends` must be a JSON Pointer or an array of them", path);
    }

    /**
     * Core lets {@code required} be either a flat list of names or a list of
     * <em>alternative</em> sets, any one of which satisfies the type. Neither
     * Avro nor Protobuf can express that disjunction.
     *
     * <p>The sound reduction is the <strong>intersection</strong>: a property in
     * every alternative is present no matter which alternative holds, so it can
     * be a non-null field. A property in only some alternatives may legitimately
     * be absent, so it must stay optional. Taking the union instead would emit
     * non-null fields for data that is allowed to omit them, which fails at
     * write time; dropping the keyword quietly retypes every field in the
     * record.
     */
    private static RequiredSet requiredSet(ObjectNode decl) {
        ArrayNode items = Js.arr(Js.get(decl, "required"));
        if (items == null) {
            return new RequiredSet(new HashSet<>(), null);
        }

        List<Set<String>> alternatives = new ArrayList<>();
        for (JsonNode item : items) {
            ArrayNode set = Js.arr(item);
            if (set == null) {
                continue;
            }
            Set<String> names = new HashSet<>();
            for (JsonNode entry : set) {
                String name = Js.str(entry);
                if (name != null) {
                    names.add(name);
                }
            }
            alternatives.add(names);
        }

        if (alternatives.isEmpty()) {
            Set<String> flat = new HashSet<>();
            for (JsonNode item : items) {
                String name = Js.str(item);
                if (name != null) {
                    flat.add(name);
                }
            }
            return new RequiredSet(flat, null);
        }

        Set<String> intersection = new HashSet<>(alternatives.get(0));
        for (int i = 1; i < alternatives.size(); i++) {
            intersection.retainAll(alternatives.get(i));
        }

        List<String> shared = new ArrayList<>(intersection);
        shared.sort(null);
        String note = "`required` declares " + alternatives.size()
            + " alternative sets; the target has no way to express that choice. Only the "
            + "properties common to every alternative [" + String.join(", ", shared)
            + "] are emitted as non-null, and the alternatives are not enforced on the wire";
        return new RequiredSet(intersection, note);
    }

    /**
     * Every {@code selector} name belonging to an inline union anywhere in the
     * document. Core permits an inline union's selector to shadow a base-type
     * property, so these names are exempt from the no-redefinition rule.
     */
    private static Set<String> collectSelectors(JsonNode doc) {
        Set<String> found = new HashSet<>();
        walkSelectors(doc, found);
        return found;
    }

    private static void walkSelectors(JsonNode node, Set<String> outNames) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            if (node.has("$extends")) {
                String selector = Js.str(Js.get(node, "selector"));
                if (selector != null) {
                    outNames.add(selector);
                }
            }
            Iterator<Map.Entry<String, JsonNode>> entries = node.fields();
            while (entries.hasNext()) {
                walkSelectors(entries.next().getValue(), outNames);
            }
            return;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                walkSelectors(item, outNames);
            }
        }
    }

    private static ObjectNode emptyRecord(String name, String ns) {
        ObjectNode out = NODES.objectNode();
        out.set("type", TextNode.valueOf("record"));
        out.set("name", TextNode.valueOf(name));
        if (!ns.isEmpty()) {
            out.set("namespace", TextNode.valueOf(ns));
        }
        out.set("fields", NODES.arrayNode());
        return out;
    }

    /**
     * Whether this node declares a type, as opposed to being a namespace holding
     * further definitions.
     */
    private static boolean isTypeDeclaration(ObjectNode node) {
        return node.has("type") || node.has("$extends") || node.has("abstract");
    }

    private static boolean isNullBranch(JsonNode value) {
        return "null".equals(Js.str(value));
    }

    private static boolean isJsonNull(JsonNode value) {
        return value == null || value.isNull();
    }

    private static List<JsonNode> flattenUnion(JsonNode value) {
        ArrayNode items = Js.arr(value);
        if (items == null) {
            List<JsonNode> single = new ArrayList<>(1);
            single.add(value);
            return single;
        }

        List<JsonNode> flat = new ArrayList<>();
        for (JsonNode item : items) {
            if (item == null) {
                continue;
            }
            flat.addAll(flattenUnion(item.deepCopy()));
        }
        return flat;
    }

    /**
     * Positions {@code defaultValue} so that Avro will accept it, reordering
     * {@code branches} if it has to, and rejects it if no branch can hold it.
     *
     * <p>Avro checks a field default against exactly one schema: the first branch
     * of a union, or the type itself when there is no union. That is a placement
     * rule, not a value rule, so a default naming some other branch is fixed by
     * moving the branch, not by dropping the default. Emitting the default anyway
     * is the dangerous option — the schema parses cleanly and the failure
     * surfaces much later as a resolution error against real data.
     *
     * <p>A JSON Structure tagged-union default arrives as
     * <code>{"&lt;branch&gt;": value}</code>; the tag is consumed here because
     * Avro writes a union default as the bare value of its first branch.
     */
    private static JsonNode placeDefault(
            List<JsonNode> branches, JsonNode defaultValue, String pointer) {
        // A tagged default names its branch outright, which is more reliable than
        // inferring one from the JSON shape.
        if (branches.size() > 1
                && defaultValue != null
                && defaultValue.isObject()
                && defaultValue.size() == 1) {
            Map.Entry<String, JsonNode> only = defaultValue.fields().next();
            int index = indexOfBranchTagged(branches, only.getKey());
            if (index >= 0) {
                JsonNode inner = only.getValue() == null ? null : only.getValue().deepCopy();
                // A branch whose Avro name did not already match the choice key was
                // wrapped in a single-field record (§3.7.1), so the default has to be
                // wrapped the same way.
                if (!defaultMatches(branches.get(index), inner)
                        && isBranchWrapper(branches.get(index))) {
                    ObjectNode wrapped = NODES.objectNode();
                    wrapped.set("value", inner == null ? NODES.nullNode() : inner);
                    inner = wrapped;
                }
                if (!defaultMatches(branches.get(index), inner)) {
                    throw rejectDefault(inner, branches, pointer);
                }
                rotateToFront(branches, index);
                return inner;
            }
        }

        int match = -1;
        for (int index = 0; index < branches.size(); index++) {
            if (defaultMatches(branches.get(index), defaultValue)) {
                match = index;
                break;
            }
        }
        if (match < 0) {
            throw rejectDefault(defaultValue, branches, pointer);
        }
        rotateToFront(branches, match);
        return defaultValue == null ? null : defaultValue.deepCopy();
    }

    private static int indexOfBranchTagged(List<JsonNode> branches, String tag) {
        for (int index = 0; index < branches.size(); index++) {
            if (tag.equals(branchTag(branches.get(index)))) {
                return index;
            }
        }
        return -1;
    }

    /** Moves the branch at {@code index} to the front, keeping the rest in order. */
    private static void rotateToFront(List<JsonNode> branches, int index) {
        if (index <= 0) {
            return;
        }
        branches.add(0, branches.remove(index));
    }

    private static AvroCompileException rejectDefault(
            JsonNode value, List<JsonNode> branches, String pointer) {
        List<String> tags = new ArrayList<>(branches.size());
        for (JsonNode branch : branches) {
            String tag = branchTag(branch);
            tags.add(tag == null ? "?" : tag);
        }
        return AvroCompileException.invalid(
            "`default` " + Js.compact(value) + " matches no branch of the generated Avro type ["
                + String.join(", ", tags)
                + "]; Avro validates a default against the first branch only",
            pointer);
    }

    /**
     * Whether this branch is the single-field record §3.7.1 generates for a
     * choice key that did not already name an Avro type.
     */
    private static boolean isBranchWrapper(JsonNode branch) {
        ObjectNode map = Js.obj(branch);
        if (map == null || !"record".equals(Js.str(Js.get(map, "type")))) {
            return false;
        }
        ArrayNode fields = Js.arr(Js.get(map, "fields"));
        if (fields == null || fields.size() != 1) {
            return false;
        }
        return "value".equals(Js.str(Js.get(fields.get(0), "name")));
    }

    /**
     * The name a tagged union value would use for this branch: the unqualified
     * Avro name.
     */
    private static String branchTag(JsonNode branch) {
        String name;
        String literal = Js.str(branch);
        if (literal != null) {
            name = literal;
        } else {
            ObjectNode map = Js.obj(branch);
            if (map == null) {
                return null;
            }
            name = Js.str(Js.get(map, "name"));
            if (name == null) {
                name = Js.str(Js.get(map, "type"));
            }
        }

        if (name == null) {
            return null;
        }
        int cut = name.lastIndexOf('.');
        return cut < 0 ? name : name.substring(cut + 1);
    }

    /**
     * Whether a JSON default <em>could</em> be an Avro value of this schema.
     *
     * <p>Deliberately structural rather than exhaustive: it catches the
     * mismatches that corrupt reads — an object where a number belongs, a tagged
     * union value left wrapped — without reimplementing Avro's validator.
     */
    private static boolean defaultMatches(JsonNode branch, JsonNode defaultValue) {
        String typeName;
        String literal = Js.str(branch);
        if (literal != null) {
            typeName = literal;
        } else {
            ObjectNode map = Js.obj(branch);
            if (map == null) {
                // An array here is a union, which flattenUnion has already removed.
                return true;
            }
            typeName = Js.str(Js.get(map, "type"));
            if (typeName == null) {
                // A nested union in a branch position; Avro forbids it, and
                // flattenUnion has already removed it.
                return true;
            }
        }

        return switch (typeName) {
            case "null" -> isJsonNull(defaultValue);
            case "boolean" -> defaultValue != null && defaultValue.isBoolean();
            case "int", "long" -> isIntegral(defaultValue);
            case "float", "double" -> defaultValue != null && defaultValue.isNumber();
            // Avro encodes `bytes` and `fixed` defaults as strings.
            case "string", "bytes", "fixed", "enum" ->
                defaultValue != null && defaultValue.isTextual();
            case "array" -> defaultValue != null && defaultValue.isArray();
            case "record", "map" -> defaultValue != null && defaultValue.isObject();
            // A bare name referring to a previously defined type. The definition is
            // not in hand here, so accept anything but a plainly impossible shape.
            default -> true;
        };
    }

    /**
     * Whether a node is a JSON number with no fractional or exponent part.
     *
     * <p>Jackson answers this from the token it parsed rather than from a
     * conversion, which is what makes it right: {@code 3.0} is a number that is
     * not an Avro {@code int}, and every numeric widening would happily round
     * it.
     */
    private static boolean isIntegral(JsonNode node) {
        return node != null && node.isIntegralNumber();
    }

    /**
     * Builds a union from {@code branches}, deduplicating by Avro type identity
     * and collapsing a single branch to the bare type (§3.8).
     */
    private static JsonNode unionOf(List<JsonNode> branches) {
        Set<String> seen = new HashSet<>();
        List<JsonNode> kept = new ArrayList<>();
        for (JsonNode branch : branches) {
            for (JsonNode flat : flattenUnion(branch)) {
                if (seen.add(typeKey(flat))) {
                    kept.add(flat);
                }
            }
        }

        if (kept.size() == 1) {
            return kept.get(0);
        }

        ArrayNode union = NODES.arrayNode();
        for (JsonNode branch : kept) {
            union.add(branch);
        }
        return union;
    }

    /**
     * Identity of an Avro type for union deduplication. Named types are
     * identified by their fully-qualified name so a definition and a later
     * reference to it collapse to one branch.
     *
     * <p>Everything else is identified by its Avro <i>type</i>, which is exactly
     * the rule Avro states: a union may not hold two schemas of the same type
     * unless they are {@code record}, {@code enum}, or {@code fixed}. That
     * matters in {@code full} mode, where an annotated {@code date} would
     * otherwise sit beside a plain {@code string} in a union no Avro parser will
     * accept.
     */
    private static String typeKey(JsonNode value) {
        String literal = Js.str(value);
        if (literal != null) {
            return literal;
        }

        ObjectNode map = Js.obj(value);
        if (map != null) {
            String typeName = Js.str(Js.get(map, "type"));
            if (typeName != null) {
                if (typeName.equals("record")
                        || typeName.equals("enum")
                        || typeName.equals("fixed")) {
                    String name = Js.str(Js.get(map, "name"));
                    String ns = Js.str(Js.get(map, "namespace"));
                    return qualify(ns == null ? "" : ns, name == null ? "" : name);
                }
                return typeName;
            }
        }

        return Js.compact(value);
    }

    /** The unqualified Avro name of a compiled type, if it has one. */
    private static String unqualifiedName(JsonNode value) {
        String literal = Js.str(value);
        if (literal != null) {
            int cut = literal.lastIndexOf('.');
            return cut < 0 ? literal : literal.substring(cut + 1);
        }
        ObjectNode map = Js.obj(value);
        return map == null ? null : Js.str(Js.get(map, "name"));
    }
}
