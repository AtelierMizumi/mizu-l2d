// cubism_env.cpp — malloc-backed allocator for the Cubism Framework.
#include "cubism_env.hpp"
#include "common.hpp"

#include <CubismFramework.hpp>
#include <ICubismAllocator.hpp>
#include <cstdlib>

using namespace Csm;

namespace {

class MizuAllocator : public ICubismAllocator {
public:
    void *Allocate(const csmSizeType size) override { return malloc(size); }
    void Deallocate(void *memory) override { free(memory); }
    void *AllocateAligned(const csmSizeType size, const csmUint32 alignment) override {
        void *p = std::aligned_alloc(alignment, (size + alignment - 1) / alignment * alignment);
        return p;
    }
    void DeallocateAligned(void *alignedMemory) override { free(alignedMemory); }
};

MizuAllocator g_allocator;
bool g_ready = false;

void cubism_log(const csmChar *message) { LOGI("[cubism] %s", message); }

} // namespace

namespace mizu {

bool cubism_startup() {
    if (g_ready) return true;
    CubismFramework::Option opt;
    opt.LogFunction = cubism_log;
    opt.LoggingLevel = CubismFramework::Option::LogLevel_Warning;
    if (!CubismFramework::StartUp(&g_allocator, &opt)) {
        LOGE("cubism: StartUp failed");
        return false;
    }
    CubismFramework::Initialize();
    g_ready = true;
    return true;
}

void cubism_shutdown() {
    if (!g_ready) return;
    CubismFramework::Dispose();
    g_ready = false;
}

bool cubism_ready() { return g_ready; }

} // namespace mizu
