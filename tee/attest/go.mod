// Pure-Go attestation verifier — the conformance suite that IS the spec
// (docs/tee-hardware-path.md §6). Stdlib-only so `go test` runs it natively and the
// browser WASM client (tee/browser) imports the exact same code that ships. No js/wasm
// build tag anywhere in this package — that is what keeps tested == shipped.
module noema/tee/attest

go 1.25
