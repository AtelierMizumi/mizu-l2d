// cubism_env.hpp — Cubism Framework process-level environment: allocator,
// log handler, StartUp/Initialize/Dispose. One per process.
#pragma once

namespace mizu {

bool cubism_startup();
void cubism_shutdown();
bool cubism_ready();

} // namespace mizu
