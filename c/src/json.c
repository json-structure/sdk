/**
 * @file json.c
 * @brief Compact JSON parser implementation
 * 
 * Zero-copy JSON parser optimized for validation. Parses JSON lazily,
 * only allocating when iterating objects/arrays.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/json.h"
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include <ctype.h>

/* ============================================================================
 * Internal helpers
 * ============================================================================ */

static inline bool is_ws(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

static inline bool is_digit(char c) {
    return c >= '0' && c <= '9';
}

static void skip_ws(js_parser_t* p) {
    while (p->pos < p->len) {
        char c = p->json[p->pos];
        if (!is_ws(c)) break;
        if (c == '\n') {
            p->line++;
            p->column = 1;
        } else {
            p->column++;
        }
        p->pos++;
    }
}

static inline char peek(js_parser_t* p) {
    return p->pos < p->len ? p->json[p->pos] : '\0';
}

static inline char advance(js_parser_t* p) {
    if (p->pos >= p->len) return '\0';
    char c = p->json[p->pos++];
    if (c == '\n') {
        p->line++;
        p->column = 1;
    } else {
        p->column++;
    }
    return c;
}

static bool expect(js_parser_t* p, char c) {
    skip_ws(p);
    if (peek(p) != c) return false;
    advance(p);
    return true;
}

static bool match_keyword(js_parser_t* p, const char* kw, size_t len) {
    if (p->pos + len > p->len) return false;
    if (memcmp(p->json + p->pos, kw, len) != 0) return false;
    /* Ensure it's not a prefix of a longer token */
    if (p->pos + len < p->len) {
        char next = p->json[p->pos + len];
        if (isalnum((unsigned char)next) || next == '_') return false;
    }
    p->pos += len;
    p->column += (uint32_t)len;
    return true;
}

/* ============================================================================
 * Parser initialization
 * ============================================================================ */

void js_parser_init(js_parser_t* parser, const char* json, size_t len,
                    const js_allocator_t* alloc) {
    if (!parser) return;
    memset(parser, 0, sizeof(*parser));
    parser->json = json;
    parser->len = len;
    parser->pos = 0;
    parser->line = 1;
    parser->column = 1;
    parser->alloc = alloc ? alloc : js_default_allocator();
}

js_location_t js_parser_location(const js_parser_t* parser) {
    if (!parser) return JS_LOCATION_UNKNOWN;
    return (js_location_t){parser->line, parser->column};
}

/* ============================================================================
 * Value parsing
 * ============================================================================ */

/* Forward declaration */
static bool parse_value(js_parser_t* p, js_json_t* out);

static bool parse_string(js_parser_t* p, js_json_t* out) {
    if (peek(p) != '"') {
        snprintf(p->error, sizeof(p->error), "Expected '\"' at line %u", p->line);
        return false;
    }
    
    size_t start = p->pos;
    advance(p); /* skip opening quote */
    
    const char* str_start = p->json + p->pos;
    size_t str_len = 0;
    
    while (p->pos < p->len) {
        char c = p->json[p->pos];
        if (c == '"') {
            str_len = p->pos - (str_start - p->json);
            advance(p); /* skip closing quote */
            
            out->type = JS_JSON_STRING;
            out->raw.data = p->json + start;
            out->raw.len = p->pos - start;
            out->data.string.data = str_start;
            out->data.string.len = str_len;
            return true;
        }
        if (c == '\\') {
            advance(p);
            if (p->pos >= p->len) break;
            char escaped = p->json[p->pos];
            if (escaped == 'u') {
                /* Unicode escape: \uXXXX */
                for (int i = 0; i < 4 && p->pos < p->len; i++) {
                    advance(p);
                }
            }
        }
        advance(p);
    }
    
    snprintf(p->error, sizeof(p->error), "Unterminated string at line %u", p->line);
    return false;
}

static bool parse_number(js_parser_t* p, js_json_t* out) {
    size_t start = p->pos;
    
    /* Optional minus */
    if (peek(p) == '-') advance(p);
    
    /* Integer part */
    if (peek(p) == '0') {
        advance(p);
    } else if (is_digit(peek(p))) {
        while (is_digit(peek(p))) advance(p);
    } else {
        snprintf(p->error, sizeof(p->error), "Invalid number at line %u", p->line);
        return false;
    }
    
    /* Fractional part */
    if (peek(p) == '.') {
        advance(p);
        if (!is_digit(peek(p))) {
            snprintf(p->error, sizeof(p->error), "Expected digit after '.' at line %u", p->line);
            return false;
        }
        while (is_digit(peek(p))) advance(p);
    }
    
    /* Exponent */
    if (peek(p) == 'e' || peek(p) == 'E') {
        advance(p);
        if (peek(p) == '+' || peek(p) == '-') advance(p);
        if (!is_digit(peek(p))) {
            snprintf(p->error, sizeof(p->error), "Expected digit in exponent at line %u", p->line);
            return false;
        }
        while (is_digit(peek(p))) advance(p);
    }
    
    /* Parse the number */
    size_t num_len = p->pos - start;
    char buf[64];
    if (num_len >= sizeof(buf)) num_len = sizeof(buf) - 1;
    memcpy(buf, p->json + start, num_len);
    buf[num_len] = '\0';
    
    out->type = JS_JSON_NUMBER;
    out->raw.data = p->json + start;
    out->raw.len = p->pos - start;
    out->data.number = strtod(buf, NULL);
    return true;
}

static bool parse_array(js_parser_t* p, js_json_t* out) {
    if (peek(p) != '[') {
        snprintf(p->error, sizeof(p->error), "Expected '[' at line %u", p->line);
        return false;
    }
    
    size_t start = p->pos;
    advance(p); /* skip '[' */
    skip_ws(p);
    
    uint32_t count = 0;
    
    if (peek(p) != ']') {
        /* Count elements by parsing them */
        size_t saved_pos = p->pos;
        uint32_t saved_line = p->line;
        uint32_t saved_col = p->column;
        
        do {
            skip_ws(p);
            js_json_t elem;
            if (!parse_value(p, &elem)) return false;
            count++;
            skip_ws(p);
        } while (expect(p, ','));
        
        /* Note: We've already parsed to the end, position is after last element */
    }
    
    if (!expect(p, ']')) {
        snprintf(p->error, sizeof(p->error), "Expected ']' at line %u", p->line);
        return false;
    }
    
    out->type = JS_JSON_ARRAY;
    out->raw.data = p->json + start;
    out->raw.len = p->pos - start;
    out->data.container.count = count;
    return true;
}

static bool parse_object(js_parser_t* p, js_json_t* out) {
    if (peek(p) != '{') {
        snprintf(p->error, sizeof(p->error), "Expected '{' at line %u", p->line);
        return false;
    }
    
    size_t start = p->pos;
    advance(p); /* skip '{' */
    skip_ws(p);
    
    uint32_t count = 0;
    
    if (peek(p) != '}') {
        do {
            skip_ws(p);
            
            /* Parse key */
            js_json_t key;
            if (!parse_string(p, &key)) return false;
            
            skip_ws(p);
            if (!expect(p, ':')) {
                snprintf(p->error, sizeof(p->error), "Expected ':' at line %u", p->line);
                return false;
            }
            
            /* Parse value */
            skip_ws(p);
            js_json_t val;
            if (!parse_value(p, &val)) return false;
            
            count++;
            skip_ws(p);
        } while (expect(p, ','));
    }
    
    if (!expect(p, '}')) {
        snprintf(p->error, sizeof(p->error), "Expected '}' at line %u", p->line);
        return false;
    }
    
    out->type = JS_JSON_OBJECT;
    out->raw.data = p->json + start;
    out->raw.len = p->pos - start;
    out->data.container.count = count;
    return true;
}

static bool parse_value(js_parser_t* p, js_json_t* out) {
    skip_ws(p);
    
    if (p->pos >= p->len) {
        snprintf(p->error, sizeof(p->error), "Unexpected end of input");
        return false;
    }
    
    char c = peek(p);
    
    switch (c) {
        case 'n':
            if (match_keyword(p, "null", 4)) {
                out->type = JS_JSON_NULL;
                out->raw = (js_str_t){p->json + p->pos - 4, 4};
                return true;
            }
            break;
            
        case 't':
            if (match_keyword(p, "true", 4)) {
                out->type = JS_JSON_BOOL;
                out->raw = (js_str_t){p->json + p->pos - 4, 4};
                out->data.boolean = true;
                return true;
            }
            break;
            
        case 'f':
            if (match_keyword(p, "false", 5)) {
                out->type = JS_JSON_BOOL;
                out->raw = (js_str_t){p->json + p->pos - 5, 5};
                out->data.boolean = false;
                return true;
            }
            break;
            
        case '"':
            return parse_string(p, out);
            
        case '[':
            return parse_array(p, out);
            
        case '{':
            return parse_object(p, out);
            
        case '-':
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
            return parse_number(p, out);
    }
    
    snprintf(p->error, sizeof(p->error), "Unexpected character '%c' at line %u", c, p->line);
    return false;
}

bool js_parser_parse(js_parser_t* parser, js_json_t* out) {
    if (!parser || !out) return false;
    memset(out, 0, sizeof(*out));
    return parse_value(parser, out);
}

/* ============================================================================
 * Iterator
 * ============================================================================ */

bool js_json_iter_init(js_json_iter_t* iter, const js_json_t* value) {
    if (!iter || !value) return false;
    if (value->type != JS_JSON_ARRAY && value->type != JS_JSON_OBJECT) {
        return false;
    }
    
    memset(iter, 0, sizeof(*iter));
    
    /* Initialize parser to start after the opening bracket */
    js_parser_init(&iter->parser, value->raw.data, value->raw.len, NULL);
    advance(&iter->parser); /* skip '[' or '{' */
    
    iter->count = value->data.container.count;
    iter->is_object = (value->type == JS_JSON_OBJECT);
    iter->index = 0;
    
    return true;
}

bool js_json_iter_next(js_json_iter_t* iter, js_str_t* key, js_json_t* value) {
    if (!iter || !value) return false;
    if (iter->index >= iter->count) return false;
    
    skip_ws(&iter->parser);
    
    /* Skip comma if not first element */
    if (iter->index > 0) {
        expect(&iter->parser, ',');
        skip_ws(&iter->parser);
    }
    
    if (iter->is_object) {
        /* Parse key */
        js_json_t key_val;
        if (!parse_string(&iter->parser, &key_val)) return false;
        if (key) *key = key_val.data.string;
        
        skip_ws(&iter->parser);
        if (!expect(&iter->parser, ':')) return false;
        skip_ws(&iter->parser);
    } else if (key) {
        *key = JS_STR_EMPTY;
    }
    
    /* Parse value */
    if (!parse_value(&iter->parser, value)) return false;
    
    iter->index++;
    return true;
}

/* ============================================================================
 * Property/Element Access
 * ============================================================================ */

bool js_json_get(const js_json_t* obj, js_str_t key, js_json_t* out) {
    if (!obj || obj->type != JS_JSON_OBJECT || !out) return false;
    
    js_json_iter_t iter;
    if (!js_json_iter_init(&iter, obj)) return false;
    
    js_str_t prop_key;
    js_json_t prop_val;
    while (js_json_iter_next(&iter, &prop_key, &prop_val)) {
        if (js_str_eq(prop_key, key)) {
            *out = prop_val;
            return true;
        }
    }
    
    return false;
}

bool js_json_get_cstr(const js_json_t* obj, const char* key, js_json_t* out) {
    return js_json_get(obj, JS_STR(key), out);
}

bool js_json_has(const js_json_t* obj, js_str_t key) {
    js_json_t dummy;
    return js_json_get(obj, key, &dummy);
}

bool js_json_has_cstr(const js_json_t* obj, const char* key) {
    return js_json_has(obj, JS_STR(key));
}

bool js_json_get_index(const js_json_t* arr, uint32_t index, js_json_t* out) {
    if (!arr || arr->type != JS_JSON_ARRAY || !out) return false;
    if (index >= arr->data.container.count) return false;
    
    js_json_iter_t iter;
    if (!js_json_iter_init(&iter, arr)) return false;
    
    js_json_t val;
    uint32_t i = 0;
    while (js_json_iter_next(&iter, NULL, &val)) {
        if (i == index) {
            *out = val;
            return true;
        }
        i++;
    }
    
    return false;
}

/* ============================================================================
 * String utilities
 * ============================================================================ */

bool js_json_str_eq(const js_json_t* v, const char* cstr) {
    if (!v || v->type != JS_JSON_STRING) return false;
    return js_str_eq_cstr(v->data.string, cstr);
}

size_t js_json_unescape(js_str_t str, char* buf, size_t buf_size) {
    if (str.len == 0 || !str.data) {
        if (buf && buf_size > 0) buf[0] = '\0';
        return 0;
    }
    
    size_t out_len = 0;
    size_t i = 0;
    
    while (i < str.len) {
        char c = str.data[i++];
        
        if (c == '\\' && i < str.len) {
            char esc = str.data[i++];
            switch (esc) {
                case '"':  c = '"'; break;
                case '\\': c = '\\'; break;
                case '/':  c = '/'; break;
                case 'b':  c = '\b'; break;
                case 'f':  c = '\f'; break;
                case 'n':  c = '\n'; break;
                case 'r':  c = '\r'; break;
                case 't':  c = '\t'; break;
                case 'u':
                    /* Unicode escape - simplified: just output as-is for now */
                    if (buf && out_len < buf_size - 1) {
                        buf[out_len++] = '\\';
                        c = 'u';
                    } else {
                        out_len++;
                        c = 'u';
                    }
                    break;
                default:
                    /* Invalid escape, keep as-is */
                    if (buf && out_len < buf_size - 1) {
                        buf[out_len++] = '\\';
                    } else {
                        out_len++;
                    }
                    c = esc;
                    break;
            }
        }
        
        if (buf && out_len < buf_size - 1) {
            buf[out_len] = c;
        }
        out_len++;
    }
    
    if (buf && buf_size > 0) {
        buf[out_len < buf_size ? out_len : buf_size - 1] = '\0';
    }
    
    return out_len;
}

/* ============================================================================
 * Source Locator
 * ============================================================================ */

void js_locator_init(js_locator_t* loc, const char* json, size_t len,
                     const js_allocator_t* alloc) {
    if (!loc) return;
    memset(loc, 0, sizeof(*loc));
    loc->json = json;
    loc->len = len;
    loc->alloc = alloc ? alloc : js_default_allocator();
}

void js_locator_cleanup(js_locator_t* loc) {
    if (!loc) return;
    if (loc->_cache && loc->alloc) {
        loc->alloc->free(loc->_cache, loc->alloc->user_data);
    }
    memset(loc, 0, sizeof(*loc));
}

/* Simple path-based location finder - walks JSON to find path */
js_location_t js_locator_find(js_locator_t* loc, const char* path) {
    if (!loc || !loc->json || !path) return JS_LOCATION_UNKNOWN;
    
    js_parser_t parser;
    js_parser_init(&parser, loc->json, loc->len, loc->alloc);
    
    js_json_t root;
    if (!js_parser_parse(&parser, &root)) {
        return JS_LOCATION_UNKNOWN;
    }
    
    /* Empty path = root */
    if (path[0] == '\0') {
        return (js_location_t){1, 1};
    }
    
    /* Parse path and navigate */
    const char* p = path;
    js_json_t current = root;
    uint32_t line = 1, col = 1;
    
    while (*p) {
        if (*p != '/') {
            return JS_LOCATION_UNKNOWN;
        }
        p++;
        
        /* Extract segment */
        const char* seg_start = p;
        while (*p && *p != '/') p++;
        size_t seg_len = p - seg_start;
        
        if (seg_len == 0) continue;
        
        if (current.type == JS_JSON_OBJECT) {
            /* Find property */
            js_json_iter_t iter;
            if (!js_json_iter_init(&iter, &current)) {
                return JS_LOCATION_UNKNOWN;
            }
            
            js_str_t key;
            js_json_t val;
            bool found = false;
            while (js_json_iter_next(&iter, &key, &val)) {
                if (key.len == seg_len && memcmp(key.data, seg_start, seg_len) == 0) {
                    current = val;
                    found = true;
                    break;
                }
            }
            if (!found) return JS_LOCATION_UNKNOWN;
            
        } else if (current.type == JS_JSON_ARRAY) {
            /* Parse index */
            uint32_t idx = 0;
            for (size_t i = 0; i < seg_len; i++) {
                if (!is_digit(seg_start[i])) return JS_LOCATION_UNKNOWN;
                idx = idx * 10 + (seg_start[i] - '0');
            }
            
            if (!js_json_get_index(&current, idx, &current)) {
                return JS_LOCATION_UNKNOWN;
            }
        } else {
            return JS_LOCATION_UNKNOWN;
        }
    }
    
    /* Calculate location from raw position */
    if (current.raw.data && current.raw.data >= loc->json) {
        size_t offset = current.raw.data - loc->json;
        line = 1;
        col = 1;
        for (size_t i = 0; i < offset && i < loc->len; i++) {
            if (loc->json[i] == '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
    }
    
    return (js_location_t){line, col};
}
