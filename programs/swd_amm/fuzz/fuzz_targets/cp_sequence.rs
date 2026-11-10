#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    swd_amm_fuzz::run_cp_sequence(data);
});
