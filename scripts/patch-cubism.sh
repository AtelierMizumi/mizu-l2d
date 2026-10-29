#!/usr/bin/env bash
# patch-cubism.sh — minimal vendor patch (kept small and reviewable).
#
# The SDK's Linux path assumes desktop GL: #version 120 shaders + GLEW, which
# does not work on Wayland/EGL (GLEW needs GLX). We render through GLES2, so
# this patch teaches the GLES2 renderer/shaders a desktop-Linux target,
# CSM_TARGET_LINUX_GLES2, which selects the GLSL ES 1.00 (#version 100) shader
# variants and GLES2 system headers. Applied by fetch-thirdparty.sh; idempotent.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHADER="$REPO_ROOT/third_party/cubism/Framework/src/Rendering/OpenGL/CubismShader_OpenGLES2.cpp"
RHPP="$REPO_ROOT/third_party/cubism/Framework/src/Rendering/OpenGL/CubismRenderer_OpenGLES2.hpp"
OHPP="$REPO_ROOT/third_party/cubism/Framework/src/Rendering/OpenGL/CubismOffscreenSurface_OpenGLES2.hpp"

for f in "$SHADER" "$RHPP" "$OHPP"; do
    [ -f "$f" ] || { echo "patch: $f missing — run fetch-thirdparty.sh first"; exit 1; }
done

if grep -q CSM_TARGET_LINUX_GLES2 "$SHADER"; then
    echo "patch: already applied"
    exit 0
fi

# 1) shader sources: our target uses the GLSL ES 1.00 variants
sed -i 's/#if defined(CSM_TARGET_IPHONE_ES2) || defined(CSM_TARGET_ANDROID_ES2) || defined(CSM_TARGET_HARMONYOS_ES3)/#if defined(CSM_TARGET_IPHONE_ES2) || defined(CSM_TARGET_ANDROID_ES2) || defined(CSM_TARGET_HARMONYOS_ES3) || defined(CSM_TARGET_LINUX_GLES2)/g' "$SHADER"

# 2) headers: GLES2 includes for our target (both headers share the same shape)
python3 - "$RHPP" "$OHPP" <<'EOF'
import sys
for p in sys.argv[1:]:
    s = open(p).read()
    old = """#if defined(CSM_TARGET_WIN_GL) || defined(CSM_TARGET_LINUX_GL)
#include <GL/glew.h>
#include <GL/gl.h>
#endif"""
    new = """#if defined(CSM_TARGET_WIN_GL) || defined(CSM_TARGET_LINUX_GL)
#include <GL/glew.h>
#include <GL/gl.h>
#elif defined(CSM_TARGET_LINUX_GLES2)
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#endif"""
    assert old in s, f"pattern not found in {p}"
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)
EOF

echo "patch: CSM_TARGET_LINUX_GLES2 added to shader + header include paths"
