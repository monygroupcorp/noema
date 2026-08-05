# Vendored from @mony/design v0.1.21

Copied from the shared design system (`~/projects/design`), a **local, un-gitted
source of truth**. **Do not edit here** — change them in the design module and
re-copy so all businesses stay uniform (see the module's ADOPTION.md + CHANGELOG).

- `primitives.css`, `semantic.css`, `index.css`, `typography.css`, `layout.css` — foundation tokens + type ramp + layout utilities (`foundations/tokens/`)
- `noema-theme.css` — the NOEMA brand skin (`identity/noema/theme.css`)
- `noema-signature.css` — the NOEMA signature devices `.noema-*` (`identity/noema/signature.css`)

`app.css` bridges NOEMA's local token names (`--bg`, `--accent`, …) to the system
tokens. Fonts are self-hosted under `public/fonts/` (incl. `martian-mono/` for
`--font-marquee`); favicon + `og-card.png` under `public/`.

To update: re-copy the files above when the module CHANGELOG moves, then bump this version.
