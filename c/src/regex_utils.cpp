/**
 * @file regex_utils.cpp
 * @brief Simple regex utilities implementation using C++ std::regex
 *
 * This file is compiled as C++ to use std::regex, but exposes a C interface.
 * Includes LRU regex cache to avoid repeated compilation of the same patterns.
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "regex_utils.h"
#include <regex>
#include <string>
#include <list>
#include <unordered_map>
#include <mutex>

/* ============================================================================
 * LRU Regex Cache
 * 
 * Regex compilation is expensive (10-100x slower than matching). This cache
 * stores compiled regex objects keyed by pattern string, using LRU eviction.
 * ============================================================================ */

namespace {

constexpr size_t REGEX_CACHE_SIZE = 64;

struct RegexCache {
    using CacheList = std::list<std::pair<std::string, std::regex>>;
    using CacheMap = std::unordered_map<std::string, CacheList::iterator>;
    
    CacheList lru_list;
    CacheMap cache_map;
    std::mutex mutex;
    
    const std::regex* get(const std::string& pattern) {
        std::lock_guard<std::mutex> lock(mutex);
        
        auto it = cache_map.find(pattern);
        if (it != cache_map.end()) {
            /* Move to front (most recently used) */
            lru_list.splice(lru_list.begin(), lru_list, it->second);
            return &it->second->second;
        }
        return nullptr;
    }
    
    const std::regex* insert(const std::string& pattern, std::regex&& re) {
        std::lock_guard<std::mutex> lock(mutex);
        
        /* Check again in case another thread inserted */
        auto it = cache_map.find(pattern);
        if (it != cache_map.end()) {
            lru_list.splice(lru_list.begin(), lru_list, it->second);
            return &it->second->second;
        }
        
        /* Evict LRU if at capacity */
        if (lru_list.size() >= REGEX_CACHE_SIZE) {
            auto& lru = lru_list.back();
            cache_map.erase(lru.first);
            lru_list.pop_back();
        }
        
        /* Insert at front */
        lru_list.emplace_front(pattern, std::move(re));
        cache_map[pattern] = lru_list.begin();
        return &lru_list.front().second;
    }
};

RegexCache& get_cache() {
    static RegexCache cache;
    return cache;
}

const std::regex* get_or_compile_regex(const char* pattern) {
    if (!pattern) return nullptr;
    
    std::string pat(pattern);
    RegexCache& cache = get_cache();
    
    /* Try cache first */
    const std::regex* cached = cache.get(pat);
    if (cached) return cached;
    
    /* Compile and cache */
    try {
        std::regex re(pat, std::regex::ECMAScript);
        return cache.insert(pat, std::move(re));
    } catch (...) {
        return nullptr;
    }
}

} /* anonymous namespace */

extern "C" {

bool js_regex_is_valid(const char* pattern) {
    return get_or_compile_regex(pattern) != nullptr;
}

bool js_regex_match(const char* pattern, const char* text) {
    if (!text) return false;
    
    const std::regex* re = get_or_compile_regex(pattern);
    if (!re) return false;
    
    try {
        return std::regex_search(text, *re);
    } catch (...) {
        return false;
    }
}

void js_regex_cache_clear(void) {
    RegexCache& cache = get_cache();
    std::lock_guard<std::mutex> lock(cache.mutex);
    cache.lru_list.clear();
    cache.cache_map.clear();
}

} /* extern "C" */
