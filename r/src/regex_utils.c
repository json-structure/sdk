/**
 * @file regex_utils.c
 * @brief Self-contained pure-C regular-expression matcher (ECMAScript subset).
 *
 * This is the R-package build of the JSON Structure regex utilities. The rest
 * of the SDK compiles regex_utils.cpp (C++ std::regex), but that cannot be used
 * inside an R package on Windows: MinGW/Rtools statically links libstdc++, and
 * libstdc++'s lazy std::locale initialization (via __gthread_once) deadlocks the
 * first time std::regex is constructed in a DLL loaded by R. CRAN mandates the
 * static toolchain, so there is no link-flag workaround.
 *
 * To keep the package pure C (no libstdc++, no locale, identical behaviour on
 * every platform), the three-function C ABI declared in regex_utils.h is
 * reimplemented here with a small backtracking engine that supports the subset
 * of ECMAScript regular expressions used by JSON Structure `pattern` keywords:
 *
 *   - literals and the '.' wildcard (any byte except CR/LF)
 *   - anchors '^' and '$' (single-line; no /m multiline flag)
 *   - character classes '[...]' / '[^...]' with ranges and class escapes
 *   - shorthand classes \d \D \w \W \s \S and word boundaries \b \B
 *   - escapes \n \r \t \f \v \0 \xHH \uHHHH and escaped metacharacters
 *   - greedy and lazy quantifiers  *  +  ?  {n}  {n,}  {n,m}  (and *? +? etc.)
 *   - grouping '(...)' and non-capturing '(?:...)', and alternation '|'
 *
 * Constructs that std::regex's ECMAScript grammar rejects (lookbehind,
 * named groups, inline flags such as "(?i)", Unicode property escapes \p{...})
 * are reported as invalid patterns, matching the "throws => invalid" behaviour
 * relied upon by the shared conformance corpus. Matching is byte-oriented, the
 * same as std::regex over `char`.
 *
 * A step budget bounds backtracking so pathological "ReDoS" patterns fail fast
 * instead of hanging.
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "regex_utils.h"

#include <stdlib.h>
#include <string.h>

/* ============================================================================
 * Character sets (256-bit bitmap over byte values)
 * ========================================================================== */

typedef struct {
    unsigned char bits[32];
} CharSet;

static void cs_zero(CharSet *cs) { memset(cs->bits, 0, sizeof(cs->bits)); }

static void cs_set(CharSet *cs, int b) {
    cs->bits[(b & 0xFF) >> 3] |= (unsigned char)(1u << (b & 7));
}

static int cs_get(const CharSet *cs, int b) {
    return (cs->bits[(b & 0xFF) >> 3] >> (b & 7)) & 1;
}

static void cs_add_range(CharSet *cs, int lo, int hi) {
    int i;
    if (lo < 0) lo = 0;
    if (hi > 255) hi = 255;
    for (i = lo; i <= hi; ++i) cs_set(cs, i);
}

static void cs_invert(CharSet *cs) {
    int i;
    for (i = 0; i < 32; ++i) cs->bits[i] = (unsigned char)~cs->bits[i];
}

static int is_word_byte(int b) {
    return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') ||
           (b >= '0' && b <= '9') || b == '_';
}

/* Add a shorthand class (\d \D \w \W \s \S) to a set. Returns 1 on success. */
static int cs_add_shorthand(CharSet *cs, char kind) {
    CharSet tmp;
    cs_zero(&tmp);
    switch (kind) {
    case 'd': cs_add_range(&tmp, '0', '9'); break;
    case 'w':
        cs_add_range(&tmp, 'a', 'z');
        cs_add_range(&tmp, 'A', 'Z');
        cs_add_range(&tmp, '0', '9');
        cs_set(&tmp, '_');
        break;
    case 's':
        cs_set(&tmp, ' ');
        cs_set(&tmp, '\t');
        cs_set(&tmp, '\n');
        cs_set(&tmp, '\r');
        cs_set(&tmp, '\f');
        cs_set(&tmp, '\v');
        break;
    case 'D': cs_add_range(&tmp, '0', '9'); cs_invert(&tmp); break;
    case 'W':
        cs_add_range(&tmp, 'a', 'z');
        cs_add_range(&tmp, 'A', 'Z');
        cs_add_range(&tmp, '0', '9');
        cs_set(&tmp, '_');
        cs_invert(&tmp);
        break;
    case 'S':
        cs_set(&tmp, ' ');
        cs_set(&tmp, '\t');
        cs_set(&tmp, '\n');
        cs_set(&tmp, '\r');
        cs_set(&tmp, '\f');
        cs_set(&tmp, '\v');
        cs_invert(&tmp);
        break;
    default:
        return 0;
    }
    {
        int i;
        for (i = 0; i < 32; ++i) cs->bits[i] |= tmp.bits[i];
    }
    return 1;
}

/* ============================================================================
 * AST
 * ========================================================================== */

enum {
    A_EMPTY, A_LIT, A_ANY, A_SET, A_BOL, A_EOL, A_WORDB, A_CONCAT, A_ALT, A_REPEAT
};

typedef struct {
    int type;
    int c;                /* A_LIT: byte value */
    int set;              /* A_SET: index into Comp.sets */
    int neg;              /* A_WORDB: 1 => \B */
    int min, max, greedy; /* A_REPEAT (max == -1 => unbounded) */
    int child;            /* A_REPEAT: child node index */
    int *kids;            /* A_CONCAT / A_ALT: child node indices */
    int nkids;
} Node;

typedef struct {
    const char *p;
    int pos;
    int len;
    int error;

    Node *nodes;
    int nn, capn;

    CharSet *sets;
    int ns, caps;
} Comp;

static int new_node(Comp *c, int type) {
    if (c->error) return -1;
    if (c->nn >= c->capn) {
        int ncap = c->capn ? c->capn * 2 : 32;
        Node *nn = (Node *)realloc(c->nodes, (size_t)ncap * sizeof(Node));
        if (!nn) { c->error = 1; return -1; }
        c->nodes = nn;
        c->capn = ncap;
    }
    {
        Node *n = &c->nodes[c->nn];
        memset(n, 0, sizeof(*n));
        n->type = type;
        n->min = n->max = 0;
        n->greedy = 1;
        n->child = -1;
        return c->nn++;
    }
}

static void add_kid(Comp *c, int parent, int kid) {
    Node *n;
    if (c->error || parent < 0 || kid < 0) return;
    n = &c->nodes[parent];
    {
        int *nk = (int *)realloc(n->kids, (size_t)(n->nkids + 1) * sizeof(int));
        if (!nk) { c->error = 1; return; }
        n->kids = nk;
        n->kids[n->nkids++] = kid;
    }
}

static int new_set(Comp *c, const CharSet *cs) {
    if (c->error) return -1;
    if (c->ns >= c->caps) {
        int ncap = c->caps ? c->caps * 2 : 16;
        CharSet *nsp = (CharSet *)realloc(c->sets, (size_t)ncap * sizeof(CharSet));
        if (!nsp) { c->error = 1; return -1; }
        c->sets = nsp;
        c->caps = ncap;
    }
    c->sets[c->ns] = *cs;
    return c->ns++;
}

/* ---- parser ---- */

static int parse_alt(Comp *c);

static int hexval(int ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}

/* Decode a backslash escape that resolves to a single byte value inside or
 * outside a character class. On entry c->pos points just past the backslash;
 * the escape letter is `e` and c->pos already advanced past it. Returns the
 * byte value, or -1 if the escape is a shorthand class (caller handles those
 * separately) — but this helper is only called for non-shorthand escapes. */
static int decode_char_escape(Comp *c, int e, int in_class) {
    switch (e) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'f': return '\f';
    case 'v': return '\v';
    case '0': return '\0';
    case 'b': return in_class ? 8 /* backspace */ : 'b';
    case 'x': {
        int h1, h2;
        if (c->pos + 1 < c->len &&
            (h1 = hexval((unsigned char)c->p[c->pos])) >= 0 &&
            (h2 = hexval((unsigned char)c->p[c->pos + 1])) >= 0) {
            c->pos += 2;
            return (h1 << 4) | h2;
        }
        return 'x';
    }
    case 'u': {
        int h1, h2, h3, h4;
        if (c->pos + 3 < c->len &&
            (h1 = hexval((unsigned char)c->p[c->pos])) >= 0 &&
            (h2 = hexval((unsigned char)c->p[c->pos + 1])) >= 0 &&
            (h3 = hexval((unsigned char)c->p[c->pos + 2])) >= 0 &&
            (h4 = hexval((unsigned char)c->p[c->pos + 3])) >= 0) {
            int cp = (h1 << 12) | (h2 << 8) | (h3 << 4) | h4;
            c->pos += 4;
            /* Byte-oriented engine: keep the low byte. Multi-byte code points
             * are rare in `pattern` and not exercised by the corpus. */
            return cp & 0xFF;
        }
        return 'u';
    }
    default:
        /* Identity escape: \. \\ \* \+ \? \( \) \[ \] \{ \} \| \^ \$ \/ \- etc.
         * Also lenient for other letters (\a => 'a'). */
        return (unsigned char)e;
    }
}

/* Parse a character class starting at '['. Returns an A_SET node or -1. */
static int parse_class(Comp *c) {
    CharSet cs;
    int negate = 0;
    cs_zero(&cs);
    c->pos++; /* consume '[' */
    if (c->pos < c->len && c->p[c->pos] == '^') {
        negate = 1;
        c->pos++;
    }
    while (c->pos < c->len && c->p[c->pos] != ']') {
        int lo;
        int lo_is_shorthand = 0;
        if (c->p[c->pos] == '\\') {
            int e;
            c->pos++;
            if (c->pos >= c->len) { c->error = 1; return -1; }
            e = (unsigned char)c->p[c->pos++];
            if (e == 'd' || e == 'D' || e == 'w' || e == 'W' || e == 's' || e == 'S') {
                cs_add_shorthand(&cs, (char)e);
                lo_is_shorthand = 1;
                lo = -1;
            } else {
                lo = decode_char_escape(c, e, 1);
            }
        } else {
            lo = (unsigned char)c->p[c->pos++];
        }

        if (lo_is_shorthand) {
            continue; /* shorthand cannot be a range endpoint */
        }

        /* range? "lo - hi" where '-' is not immediately before ']' */
        if (c->pos + 1 < c->len && c->p[c->pos] == '-' && c->p[c->pos + 1] != ']') {
            int hi;
            c->pos++; /* consume '-' */
            if (c->p[c->pos] == '\\') {
                int e;
                c->pos++;
                if (c->pos >= c->len) { c->error = 1; return -1; }
                e = (unsigned char)c->p[c->pos++];
                if (e == 'd' || e == 'D' || e == 'w' || e == 'W' ||
                    e == 's' || e == 'S') {
                    c->error = 1; /* range to shorthand is invalid */
                    return -1;
                }
                hi = decode_char_escape(c, e, 1);
            } else {
                hi = (unsigned char)c->p[c->pos++];
            }
            if (lo > hi) { c->error = 1; return -1; }
            cs_add_range(&cs, lo, hi);
        } else {
            cs_set(&cs, lo);
        }
    }
    if (c->pos >= c->len) { c->error = 1; return -1; } /* unterminated '[' */
    c->pos++;                                          /* consume ']' */
    if (negate) cs_invert(&cs);
    {
        int idx = new_set(c, &cs);
        int node = new_node(c, A_SET);
        if (node < 0) return -1;
        c->nodes[node].set = idx;
        return node;
    }
}

static int parse_atom(Comp *c) {
    int ch;
    if (c->pos >= c->len) return new_node(c, A_EMPTY);
    ch = (unsigned char)c->p[c->pos];
    switch (ch) {
    case '(': {
        int inner;
        c->pos++;
        if (c->pos < c->len && c->p[c->pos] == '?') {
            /* Only "(?:" non-capturing groups are supported. Everything else
             * ((?=, (?!, (?<, (?<name>, (?i) ...) is reported as invalid. */
            if (c->pos + 1 < c->len && c->p[c->pos + 1] == ':') {
                c->pos += 2;
            } else {
                c->error = 1;
                return -1;
            }
        }
        inner = parse_alt(c);
        if (c->error) return -1;
        if (c->pos >= c->len || c->p[c->pos] != ')') { c->error = 1; return -1; }
        c->pos++; /* consume ')' */
        return inner;
    }
    case '[':
        return parse_class(c);
    case '.':
        c->pos++;
        return new_node(c, A_ANY);
    case '^':
        c->pos++;
        return new_node(c, A_BOL);
    case '$':
        c->pos++;
        return new_node(c, A_EOL);
    case '*':
    case '+':
    case '?':
        /* quantifier with nothing to repeat */
        c->error = 1;
        return -1;
    case '\\': {
        int e;
        c->pos++;
        if (c->pos >= c->len) { c->error = 1; return -1; } /* dangling backslash */
        e = (unsigned char)c->p[c->pos++];
        if (e == 'd' || e == 'D' || e == 'w' || e == 'W' || e == 's' || e == 'S') {
            CharSet cs;
            int idx, node;
            cs_zero(&cs);
            cs_add_shorthand(&cs, (char)e);
            idx = new_set(c, &cs);
            node = new_node(c, A_SET);
            if (node < 0) return -1;
            c->nodes[node].set = idx;
            return node;
        }
        if (e == 'b' || e == 'B') {
            int node = new_node(c, A_WORDB);
            if (node < 0) return -1;
            c->nodes[node].neg = (e == 'B');
            return node;
        }
        if (e == 'p' || e == 'P') {
            /* Unicode property escapes are not part of the ECMAScript grammar
             * accepted by std::regex; treat as invalid for parity. */
            c->error = 1;
            return -1;
        }
        {
            int val = decode_char_escape(c, e, 0);
            int node = new_node(c, A_LIT);
            if (node < 0) return -1;
            c->nodes[node].c = val;
            return node;
        }
    }
    default: {
        int node = new_node(c, A_LIT);
        c->pos++;
        if (node < 0) return -1;
        c->nodes[node].c = ch;
        return node;
    }
    }
}

/* Parse an optional quantifier following an atom. */
static int parse_quant(Comp *c) {
    int atom = parse_atom(c);
    int min, max, greedy;
    if (c->error || atom < 0) return atom;
    if (c->pos >= c->len) return atom;

    switch (c->p[c->pos]) {
    case '*': min = 0; max = -1; c->pos++; break;
    case '+': min = 1; max = -1; c->pos++; break;
    case '?': min = 0; max = 1; c->pos++; break;
    case '{': {
        int save = c->pos;
        int n = 0, m, have = 0;
        c->pos++;
        while (c->pos < c->len && c->p[c->pos] >= '0' && c->p[c->pos] <= '9') {
            n = n * 10 + (c->p[c->pos] - '0');
            if (n > 1000000000) n = 1000000000;
            c->pos++;
            have = 1;
        }
        if (!have) { c->pos = save; return atom; } /* literal '{' */
        min = n;
        max = n;
        if (c->pos < c->len && c->p[c->pos] == ',') {
            c->pos++;
            if (c->pos < c->len && c->p[c->pos] == '}') {
                max = -1; /* {n,} */
            } else {
                m = 0;
                have = 0;
                while (c->pos < c->len && c->p[c->pos] >= '0' && c->p[c->pos] <= '9') {
                    m = m * 10 + (c->p[c->pos] - '0');
                    if (m > 1000000000) m = 1000000000;
                    c->pos++;
                    have = 1;
                }
                if (!have) { c->pos = save; return atom; }
                max = m;
            }
        }
        if (c->pos >= c->len || c->p[c->pos] != '}') {
            c->pos = save;
            return atom; /* not a valid quantifier: treat '{' as literal */
        }
        c->pos++; /* consume '}' */
        if (max != -1 && max < min) { c->error = 1; return -1; }
        break;
    }
    default:
        return atom;
    }

    greedy = 1;
    if (c->pos < c->len && c->p[c->pos] == '?') {
        greedy = 0;
        c->pos++;
    }
    /* reject stacked quantifiers such as a**, a+*, a?+ */
    if (c->pos < c->len &&
        (c->p[c->pos] == '*' || c->p[c->pos] == '+' || c->p[c->pos] == '?')) {
        c->error = 1;
        return -1;
    }

    {
        int rep = new_node(c, A_REPEAT);
        if (rep < 0) return -1;
        c->nodes[rep].child = atom;
        c->nodes[rep].min = min;
        c->nodes[rep].max = max;
        c->nodes[rep].greedy = greedy;
        return rep;
    }
}

static int parse_concat(Comp *c) {
    int node = new_node(c, A_CONCAT);
    if (node < 0) return -1;
    while (c->pos < c->len && c->p[c->pos] != '|' && c->p[c->pos] != ')') {
        int a = parse_quant(c);
        if (c->error) return -1;
        add_kid(c, node, a);
        if (c->error) return -1;
    }
    return node;
}

static int parse_alt(Comp *c) {
    int first = parse_concat(c);
    if (c->error) return -1;
    if (c->pos >= c->len || c->p[c->pos] != '|') return first;
    {
        int node = new_node(c, A_ALT);
        if (node < 0) return -1;
        add_kid(c, node, first);
        while (c->pos < c->len && c->p[c->pos] == '|') {
            int n;
            c->pos++;
            n = parse_concat(c);
            if (c->error) return -1;
            add_kid(c, node, n);
        }
        return node;
    }
}

/* ============================================================================
 * Program (backtracking bytecode)
 * ========================================================================== */

enum {
    OP_LIT, OP_ANY, OP_SET, OP_BOL, OP_EOL, OP_WORDB, OP_JMP, OP_SPLIT, OP_MATCH
};

typedef struct {
    int op;
    int c;   /* OP_LIT */
    int set; /* OP_SET */
    int neg; /* OP_WORDB */
    int x, y;/* OP_JMP / OP_SPLIT targets */
} Inst;

struct js_regex_program {
    Inst *inst;
    int ninst, capinst;
    CharSet *sets;
    int nsets;
    int anchored_bol;
    int ok;
};
typedef struct js_regex_program Program;

static int emit(Program *pr, int op) {
    if (!pr->ok) return -1;
    if (pr->ninst >= pr->capinst) {
        int ncap = pr->capinst ? pr->capinst * 2 : 64;
        Inst *ni = (Inst *)realloc(pr->inst, (size_t)ncap * sizeof(Inst));
        if (!ni) { pr->ok = 0; return -1; }
        pr->inst = ni;
        pr->capinst = ncap;
    }
    {
        Inst *in = &pr->inst[pr->ninst];
        memset(in, 0, sizeof(*in));
        in->op = op;
        return pr->ninst++;
    }
}

/* Expansion cap: mandatory copies and finite optional ranges beyond this are
 * approximated with an unbounded loop to keep the program small (only matters
 * for pathological bounds like {1,1000000}). */
#define REGEX_EXPAND_CAP 1000

static void emit_node(Comp *c, Program *pr, int idx);

static void emit_star(Comp *c, Program *pr, int child, int greedy) {
    int l1 = emit(pr, OP_SPLIT);
    if (l1 < 0) return;
    emit_node(c, pr, child);
    {
        int j = emit(pr, OP_JMP);
        int l3;
        if (j < 0) return;
        pr->inst[j].x = l1;
        l3 = pr->ninst;
        if (greedy) {
            pr->inst[l1].x = l1 + 1;
            pr->inst[l1].y = l3;
        } else {
            pr->inst[l1].x = l3;
            pr->inst[l1].y = l1 + 1;
        }
    }
}

static void emit_repeat(Comp *c, Program *pr, int child, int min, int max, int greedy) {
    int i;
    int m = min;
    if (m > REGEX_EXPAND_CAP) m = REGEX_EXPAND_CAP;
    for (i = 0; i < m && pr->ok; ++i) emit_node(c, pr, child);

    if (max == -1) {
        emit_star(c, pr, child, greedy);
        return;
    }
    {
        int opt = max - min;
        if (opt < 0) opt = 0;
        if (opt > REGEX_EXPAND_CAP) {
            emit_star(c, pr, child, greedy);
            return;
        }
        {
            int *splits = NULL;
            int nsplits = 0;
            for (i = 0; i < opt && pr->ok; ++i) {
                int sp = emit(pr, OP_SPLIT);
                int *tmp;
                if (sp < 0) break;
                tmp = (int *)realloc(splits, (size_t)(nsplits + 1) * sizeof(int));
                if (!tmp) { pr->ok = 0; break; }
                splits = tmp;
                splits[nsplits++] = sp;
                emit_node(c, pr, child);
            }
            {
                int end = pr->ninst;
                for (i = 0; i < nsplits; ++i) {
                    int sp = splits[i];
                    if (greedy) {
                        pr->inst[sp].x = sp + 1; /* prefer taking the copy */
                        pr->inst[sp].y = end;    /* backtrack: stop early */
                    } else {
                        pr->inst[sp].x = end;
                        pr->inst[sp].y = sp + 1;
                    }
                }
            }
            free(splits);
        }
    }
}

static void emit_node(Comp *c, Program *pr, int idx) {
    Node *n;
    if (!pr->ok || idx < 0) return;
    n = &c->nodes[idx];
    switch (n->type) {
    case A_EMPTY:
        break;
    case A_LIT: {
        int k = emit(pr, OP_LIT);
        if (k >= 0) pr->inst[k].c = n->c;
        break;
    }
    case A_ANY:
        emit(pr, OP_ANY);
        break;
    case A_SET: {
        int k = emit(pr, OP_SET);
        if (k >= 0) pr->inst[k].set = n->set;
        break;
    }
    case A_BOL:
        emit(pr, OP_BOL);
        break;
    case A_EOL:
        emit(pr, OP_EOL);
        break;
    case A_WORDB: {
        int k = emit(pr, OP_WORDB);
        if (k >= 0) pr->inst[k].neg = n->neg;
        break;
    }
    case A_CONCAT: {
        int i;
        for (i = 0; i < n->nkids && pr->ok; ++i) emit_node(c, pr, n->kids[i]);
        break;
    }
    case A_ALT: {
        /* k0 | k1 | ... | k_{m-1} */
        int m = n->nkids;
        int i;
        int *jmps = NULL;
        int njmps = 0;
        if (m == 0) break;
        for (i = 0; i < m - 1 && pr->ok; ++i) {
            int sp = emit(pr, OP_SPLIT);
            int j, *tmp;
            if (sp < 0) break;
            pr->inst[sp].x = sp + 1;
            emit_node(c, pr, n->kids[i]);
            j = emit(pr, OP_JMP);
            if (j < 0) break;
            pr->inst[sp].y = pr->ninst; /* next alternative starts here */
            tmp = (int *)realloc(jmps, (size_t)(njmps + 1) * sizeof(int));
            if (!tmp) { pr->ok = 0; break; }
            jmps = tmp;
            jmps[njmps++] = j;
        }
        emit_node(c, pr, n->kids[m - 1]);
        {
            int end = pr->ninst;
            for (i = 0; i < njmps; ++i) pr->inst[jmps[i]].x = end;
        }
        free(jmps);
        break;
    }
    case A_REPEAT:
        emit_repeat(c, pr, n->child, n->min, n->max, n->greedy);
        break;
    default:
        break;
    }
}

static void comp_free(Comp *c) {
    int i;
    if (c->nodes) {
        for (i = 0; i < c->nn; ++i) free(c->nodes[i].kids);
        free(c->nodes);
    }
    free(c->sets);
    c->nodes = NULL;
    c->sets = NULL;
}

static void program_free(Program *pr) {
    if (!pr) return;
    free(pr->inst);
    free(pr->sets);
    free(pr);
}

/* Compile a pattern into a Program. Returns NULL on invalid/OOM. */
static Program *program_compile(const char *pattern) {
    Comp c;
    Program *pr;
    int root;

    memset(&c, 0, sizeof(c));
    c.p = pattern;
    c.len = (int)strlen(pattern);
    c.pos = 0;

    root = parse_alt(&c);
    if (c.error || root < 0 || c.pos != c.len) {
        comp_free(&c);
        return NULL;
    }

    pr = (Program *)calloc(1, sizeof(Program));
    if (!pr) { comp_free(&c); return NULL; }
    pr->ok = 1;

    emit_node(&c, pr, root);
    emit(pr, OP_MATCH);

    if (!pr->ok) {
        comp_free(&c);
        program_free(pr);
        return NULL;
    }

    /* transfer character sets to the program */
    if (c.ns > 0) {
        pr->sets = (CharSet *)malloc((size_t)c.ns * sizeof(CharSet));
        if (!pr->sets) { comp_free(&c); program_free(pr); return NULL; }
        memcpy(pr->sets, c.sets, (size_t)c.ns * sizeof(CharSet));
        pr->nsets = c.ns;
    }
    pr->anchored_bol = (pr->ninst > 0 && pr->inst[0].op == OP_BOL);

    comp_free(&c);
    return pr;
}

/* ============================================================================
 * Backtracking VM
 * ========================================================================== */

#define REGEX_STEP_BUDGET 2000000L
#define REGEX_STACK_CAP   200000

typedef struct { int pc, sp; } Frame;

static int word_boundary(const char *t, int len, int sp) {
    int a = (sp > 0) ? is_word_byte((unsigned char)t[sp - 1]) : 0;
    int b = (sp < len) ? is_word_byte((unsigned char)t[sp]) : 0;
    return a != b;
}

static int vm_run(const Program *pr, const char *t, int len, int start, long *budget) {
    Frame *stack = (Frame *)malloc(sizeof(Frame) * 256);
    int cap = 256, n = 0;
    int result = 0;
    if (!stack) return 0;

    stack[n].pc = 0;
    stack[n].sp = start;
    n++;

    while (n > 0) {
        int pc, sp;
        n--;
        pc = stack[n].pc;
        sp = stack[n].sp;
        for (;;) {
            const Inst *in;
            if (--(*budget) < 0) { goto done; }
            in = &pr->inst[pc];
            switch (in->op) {
            case OP_LIT:
                if (sp < len && (unsigned char)t[sp] == (unsigned char)in->c) {
                    pc++; sp++; continue;
                }
                goto backtrack;
            case OP_ANY:
                if (sp < len && t[sp] != '\n' && t[sp] != '\r') { pc++; sp++; continue; }
                goto backtrack;
            case OP_SET:
                if (sp < len && cs_get(&pr->sets[in->set], (unsigned char)t[sp])) {
                    pc++; sp++; continue;
                }
                goto backtrack;
            case OP_BOL:
                if (sp == 0) { pc++; continue; }
                goto backtrack;
            case OP_EOL:
                if (sp == len) { pc++; continue; }
                goto backtrack;
            case OP_WORDB:
                if (word_boundary(t, len, sp) != in->neg) { pc++; continue; }
                goto backtrack;
            case OP_JMP:
                pc = in->x;
                continue;
            case OP_SPLIT:
                if (n >= cap) {
                    int ncap = cap * 2;
                    Frame *ns;
                    if (ncap > REGEX_STACK_CAP) { goto done; }
                    ns = (Frame *)realloc(stack, sizeof(Frame) * (size_t)ncap);
                    if (!ns) { goto done; }
                    stack = ns;
                    cap = ncap;
                }
                stack[n].pc = in->y;
                stack[n].sp = sp;
                n++;
                pc = in->x;
                continue;
            case OP_MATCH:
                result = 1;
                goto done;
            default:
                goto done;
            }
        backtrack:;
            break; /* pop next frame */
        }
    }
done:
    free(stack);
    return result;
}

static int program_search(const Program *pr, const char *text) {
    int len = (int)strlen(text);
    long budget = REGEX_STEP_BUDGET;
    int start;
    for (start = 0; start <= len; ++start) {
        if (vm_run(pr, text, len, start, &budget)) return 1;
        if (budget < 0) return 0;
        if (pr->anchored_bol) break; /* '^' can match only at position 0 */
    }
    return 0;
}

/* ============================================================================
 * Compiled-program cache (single-threaded; R calls the binding on one thread)
 * ========================================================================== */

#define REGEX_CACHE_SIZE 32

typedef struct {
    char *pattern;
    Program *program; /* NULL sentinel for a cached "invalid pattern" */
    int invalid;
    unsigned long stamp;
} CacheEntry;

static CacheEntry g_cache[REGEX_CACHE_SIZE];
static unsigned long g_clock = 0;

/* Returns the cached/compiled program for `pattern`, or NULL if invalid.
 * `*out_invalid` distinguishes "invalid pattern" from "not looked up". */
static Program *cache_lookup(const char *pattern, int *out_invalid) {
    int i, victim = 0;
    unsigned long oldest;

    *out_invalid = 0;
    for (i = 0; i < REGEX_CACHE_SIZE; ++i) {
        if (g_cache[i].pattern && strcmp(g_cache[i].pattern, pattern) == 0) {
            g_cache[i].stamp = ++g_clock;
            *out_invalid = g_cache[i].invalid;
            return g_cache[i].program;
        }
    }

    /* not cached: compile */
    {
        Program *pr = program_compile(pattern);
        int invalid = (pr == NULL);

        /* choose an LRU victim (prefer an empty slot) */
        oldest = ~0UL;
        for (i = 0; i < REGEX_CACHE_SIZE; ++i) {
            if (!g_cache[i].pattern) { victim = i; break; }
            if (g_cache[i].stamp < oldest) { oldest = g_cache[i].stamp; victim = i; }
        }
        if (g_cache[victim].pattern) {
            free(g_cache[victim].pattern);
            program_free(g_cache[victim].program);
            g_cache[victim].pattern = NULL;
            g_cache[victim].program = NULL;
        }
        {
            size_t plen = strlen(pattern) + 1;
            char *copy = (char *)malloc(plen);
            if (copy) {
                memcpy(copy, pattern, plen);
                g_cache[victim].pattern = copy;
                g_cache[victim].program = pr;
                g_cache[victim].invalid = invalid;
                g_cache[victim].stamp = ++g_clock;
            } else {
                /* cannot cache; still return the freshly compiled program.
                 * Leak-avoidance: without a cache slot we must free it, so the
                 * caller re-compiles next time. */
                program_free(pr);
                pr = NULL;
                if (!invalid) { *out_invalid = 0; return NULL; }
            }
        }
        *out_invalid = invalid;
        return pr;
    }
}

/* ============================================================================
 * Public C ABI (matches regex_utils.h)
 * ========================================================================== */

bool js_regex_is_valid(const char *pattern) {
    int invalid;
    if (!pattern) return false;
    (void)cache_lookup(pattern, &invalid);
    return invalid ? false : true;
}

bool js_regex_match(const char *pattern, const char *text) {
    int invalid;
    Program *pr;
    if (!pattern || !text) return false;
    pr = cache_lookup(pattern, &invalid);
    if (!pr) return false; /* invalid pattern (or transient OOM) => no match */
    return program_search(pr, text) ? true : false;
}

void js_regex_cache_clear(void) {
    int i;
    for (i = 0; i < REGEX_CACHE_SIZE; ++i) {
        if (g_cache[i].pattern) {
            free(g_cache[i].pattern);
            program_free(g_cache[i].program);
            g_cache[i].pattern = NULL;
            g_cache[i].program = NULL;
            g_cache[i].invalid = 0;
            g_cache[i].stamp = 0;
        }
    }
    g_clock = 0;
}
