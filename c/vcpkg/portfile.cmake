vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO json-structure/sdk
    REF "v${VERSION}"
    SHA512 a572f5e6dfede6f4f7932f955c114f9f316ba35dafe2570e0a6293a1325b25000b794715d3a11f49c933afc31b64f6a8ce5366f5e1399f0d3c24e4309f62d0a6
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
