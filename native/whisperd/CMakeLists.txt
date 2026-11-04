cmake_minimum_required(VERSION 3.20)
project(meetinglens_whisperd LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
if(APPLE)
  # Matches LSMinimumSystemVersion of the app bundle.
  set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "")
endif()

# Reuse whisper.cpp itself (pinned) rather than writing a speech engine.
# Static libraries and an embedded Metal library give one self-contained
# executable that ships inside the app; users install nothing.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(whisper_cpp
  GIT_REPOSITORY https://github.com/ggml-org/whisper.cpp.git
  GIT_TAG        v1.9.4
  GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(whisper_cpp)

add_executable(meetinglens-whisperd src/main.cpp)
# json.hpp (nlohmann/json, MIT) ships with whisper.cpp's examples.
target_include_directories(meetinglens-whisperd PRIVATE ${whisper_cpp_SOURCE_DIR}/examples)
target_link_libraries(meetinglens-whisperd PRIVATE whisper)
