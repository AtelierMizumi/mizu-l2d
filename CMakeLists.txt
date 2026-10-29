cmake_minimum_required(VERSION 3.24)
project(mizu-l2d LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra)

find_package(PkgConfig REQUIRED)
pkg_check_modules(WL REQUIRED IMPORTED_TARGET wayland-client wayland-egl egl glesv2)
find_program(WAYLAND_SCANNER wayland-scanner REQUIRED)

# --- vendored Wayland protocols: zwlr_layer_shell_v1 (v5) + xdg-shell (v7) ---
# layer-shell's private code references xdg_surface/xdg_popup interfaces, so
# xdg-shell is generated and linked alongside even though we never use popups.
set(PROTO_DIR ${CMAKE_CURRENT_BINARY_DIR}/protocols)
file(MAKE_DIRECTORY ${PROTO_DIR})
set(PROTOS
  zwlr-layer-shell-unstable-v1
  wlr-virtual-pointer-unstable-v1
  xdg-shell)
set(PROTO_LIB_SRCS)
foreach(P ${PROTOS})
  set(XML ${CMAKE_CURRENT_SOURCE_DIR}/third_party/protocols/${P}.xml)
  set(HDR ${PROTO_DIR}/${P}-client-protocol.h)
  set(SRC ${PROTO_DIR}/${P}-protocol.c)
  add_custom_command(
    OUTPUT ${HDR}
    COMMAND ${WAYLAND_SCANNER} client-header ${XML} ${HDR}
    DEPENDS ${XML} VERBATIM)
  add_custom_command(
    OUTPUT ${SRC}
    COMMAND ${WAYLAND_SCANNER} private-code ${XML} ${SRC}
    DEPENDS ${XML} VERBATIM)
  list(APPEND PROTO_LIB_SRCS ${HDR} ${SRC})
endforeach()
add_library(layer_shell_proto STATIC ${PROTO_LIB_SRCS})
target_include_directories(layer_shell_proto PUBLIC ${PROTO_DIR})
target_link_libraries(layer_shell_proto PUBLIC PkgConfig::WL)

# --- spikes ---
add_executable(mizu-s1 spikes/s1-pointer/main.c)
target_link_libraries(mizu-s1 PRIVATE layer_shell_proto m)

# --- Cubism SDK (downloaded by scripts/fetch-thirdparty.sh; never committed) ---
# Core ships prebuilt; the Framework compiles as a vendor static lib. The GLEW
# shim redirects the Framework's CSM_TARGET_LINUX_GL includes to system GLES.
set(CUBISM_ROOT ${CMAKE_SOURCE_DIR}/third_party/cubism)
if(EXISTS ${CUBISM_ROOT}/Core/lib/linux/x86_64/libLive2DCubismCore.a)
  file(GLOB_RECURSE CUBISM_FW_SRC ${CUBISM_ROOT}/Framework/src/*.cpp)
  list(FILTER CUBISM_FW_SRC EXCLUDE REGEX "Rendering/(D3D9|D3D11|Metal|Vulkan)/")
  add_library(cubism_framework STATIC ${CUBISM_FW_SRC})
  target_include_directories(cubism_framework SYSTEM PUBLIC
    ${CUBISM_ROOT}/Core/include
    ${CUBISM_ROOT}/Framework/src
    ${CMAKE_SOURCE_DIR}/third_party/stb)
  target_compile_definitions(cubism_framework PUBLIC CSM_TARGET_LINUX_GLES2)
  target_compile_options(cubism_framework PRIVATE -Wno-everything)
  target_link_libraries(cubism_framework PUBLIC PkgConfig::WL
    ${CUBISM_ROOT}/Core/lib/linux/x86_64/libLive2DCubismCore.a)
  add_compile_definitions(CUBISM_AVAILABLE=1)
else()
  message(WARNING "Cubism SDK missing — run scripts/fetch-thirdparty.sh; building placeholder only")
endif()

# --- daemon + ctl ---
pkg_check_modules(TOMLPP REQUIRED IMPORTED_TARGET tomlplusplus)
add_executable(mizu-l2d
  src/main.cpp
  src/app.cpp
  src/gl_core.cpp
  src/scene.cpp
  src/ipc.cpp
  src/config.cpp)
target_link_libraries(mizu-l2d PRIVATE layer_shell_proto PkgConfig::TOMLPP m)
target_include_directories(mizu-l2d PRIVATE src third_party/stb)
if(TARGET cubism_framework)
  target_compile_definitions(mizu-l2d PRIVATE CUBISM_AVAILABLE=1)
  target_sources(mizu-l2d PRIVATE src/model/model_runtime.cpp
  src/model/cubism_env.cpp)
  target_link_libraries(mizu-l2d PRIVATE cubism_framework)
endif()
add_executable(mizu-l2d-ctl src/ctl.cpp)
