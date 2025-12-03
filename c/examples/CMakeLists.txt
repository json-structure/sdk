# Examples CMakeLists.txt

# C example
add_executable(validate_schema_c validate_schema.c)
target_link_libraries(validate_schema_c PRIVATE json_structure)

# C++ example
add_executable(validate_schema_cpp validate_schema.cpp)
target_link_libraries(validate_schema_cpp PRIVATE json_structure_cpp)
