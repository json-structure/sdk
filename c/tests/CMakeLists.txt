cmake_minimum_required(VERSION 3.14)

# Test executable
add_executable(json_structure_tests
    test_types.c
    test_schema_validator.c
    test_instance_validator.c
    test_conformance.c
    test_assets.c
    test_thread_safety.c
    main.c
)

target_link_libraries(json_structure_tests PRIVATE json_structure)

# Link pthread on Unix systems for thread safety tests
if(NOT WIN32)
    find_package(Threads REQUIRED)
    target_link_libraries(json_structure_tests PRIVATE Threads::Threads)
endif()

# Add tests
add_test(NAME json_structure_tests COMMAND json_structure_tests)
