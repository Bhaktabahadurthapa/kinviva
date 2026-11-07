cmake_minimum_required(VERSION 3.20)
project(kinviva_whisperd LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
if(APPLE)
  # Matches LSMinimumSystemVersion of the app bundle.
  set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "")
endif()

if(MSVC)
  # One self-contained .exe: static C runtime, UTF-8 sources.
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  add_compile_options(/utf-8)
endif()
if(NOT APPLE)
  # A build made on one machine must run on others: do not tune for this CPU.
  # x86-64 builds assume AVX2 + FMA (any mainstream laptop since about 2014).
  set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "AMD64|x86_64|x64")
    set(GGML_AVX ON CACHE BOOL "" FORCE)
    set(GGML_AVX2 ON CACHE BOOL "" FORCE)
    set(GGML_FMA ON CACHE BOOL "" FORCE)
    set(GGML_F16C ON CACHE BOOL "" FORCE)
  endif()
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

add_executable(kinviva-whisperd src/main.cpp)
# json.hpp (nlohmann/json, MIT) ships with whisper.cpp's examples.
target_include_directories(kinviva-whisperd PRIVATE ${whisper_cpp_SOURCE_DIR}/examples)
target_link_libraries(kinviva-whisperd PRIVATE whisper)
