## [Testing] Distinguish Application Control Blocks From Rust Test Failures
_Added: 2026-05-09T17:45:00Z_
_Source: verify failure_

**Mistake:** Treating a local `cargo test --lib --quiet` execution failure as equivalent to a Rust assertion failure would misrepresent Dimension 47 evidence when Windows Application Control blocks generated test executables with `os error 4551`.
**Rule:** When Application Control blocks Rust test execution, run `cargo test --lib --no-run` to prove the test binary compiles, record the execution block explicitly, and require CI runner execution before claiming full test evidence.
