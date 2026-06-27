# Hand-write IPC types; defer Rust→TS codegen

The Tauri IPC payload shapes exist twice — Rust serde structs (`commands/*.rs`,
`db/orders.rs`) and TypeScript interfaces (`src/lib/types.ts`), kept in sync by
hand and exercised through the wrappers in `src/lib/tauri.ts`. We considered
generating the TS side from Rust (`ts-rs` for types, or `tauri-specta` for types
+ command wrappers) and **decided to keep hand-writing them for now**.

At current scale — one developer, ~17 commands, IPC surface centralized in two
files reviewed together — drift is low-risk and self-correcting: a mismatch
fails loudly the first time the affected screen is exercised. Codegen buys
*compile-time* drift detection, which only pays off when many people touch the
seam or it changes often. Neither holds today; the build-step and annotation
cost isn't worth it yet.

**Revisit when** the command surface roughly doubles **or** a second developer
joins. The lazy first step at that point is `ts-rs` (types only) — it leaves the
hand-written wrappers alone and just makes `types.ts` generated; reach for
`tauri-specta` only if command-name/arg drift also starts biting.
