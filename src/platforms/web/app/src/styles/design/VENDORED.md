# Vendored from @mony/design v0.1.21

Copied in from the shared design system, which lives outside this repo and is its
own source of truth. **Do not edit them here** — change them at the source and
re-copy, so every app on the system stays uniform (see the design system's own
ADOPTION notes + CHANGELOG).

- `primitives.css`, `semantic.css`, `index.css`, `typography.css`, `layout.css` — foundation tokens + type ramp + layout utilities (`foundations/tokens/`)
- `noema-theme.css` — the NOEMA brand skin (`identity/noema/theme.css` at the source)
- `noema-signature.css` — the NOEMA signature devices `.noema-*` (`identity/noema/signature.css` at the source)

`app.css` bridges NOEMA's local token names (`--bg`, `--accent`, …) to the system
tokens. Fonts are self-hosted under `public/fonts/` (incl. `martian-mono/` for
`--font-marquee`); favicon + `og-card.png` under `public/`.

To update: re-copy the files above when the design system's CHANGELOG moves, then
bump this version.
