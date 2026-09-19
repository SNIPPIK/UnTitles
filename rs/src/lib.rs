mod structures;
mod utils;

#[cfg(not(target_os = "android"))]
use mimalloc::MiMalloc;

#[cfg(not(target_os = "android"))]
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;