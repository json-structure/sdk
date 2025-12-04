vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO json-structure/sdk
    REF "v${VERSION}"
    SHA512 0  # This will need to be updated with the actual SHA512 hash
    HEAD_REF master
)

vcpkg_check_features(OUT_FEATURE_OPTIONS FEATURE_OPTIONS
    FEATURES
        regex JS_ENABLE_REGEX
)

vcpkg_cmake_configure(
    SOURCE_PATH "${SOURCE_PATH}/c"
    OPTIONS
        -DJS_BUILD_TESTS=OFF
        -DJS_BUILD_EXAMPLES=OFF
        -DJS_FETCH_DEPENDENCIES=OFF
        ${FEATURE_OPTIONS}
)

vcpkg_cmake_install()

vcpkg_cmake_config_fixup(
    PACKAGE_NAME json_structure
    CONFIG_PATH lib/cmake/json_structure
)

file(REMOVE_RECURSE "${CURRENT_PACKAGES_DIR}/debug/include")

vcpkg_install_copyright(FILE_LIST "${SOURCE_PATH}/LICENSE")

file(INSTALL "${CMAKE_CURRENT_LIST_DIR}/usage" DESTINATION "${CURRENT_PACKAGES_DIR}/share/${PORT}")
