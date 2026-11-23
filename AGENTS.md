# AGENTS.md – ha-card-for-alphaess

Dashboard card for [AlphaESS Modbus TCP](https://github.com/senalse/ha-alphaess-modbus)
inverters, distributed through HACS as a **Dashboard** (plugin) repository.
It is not shipped inside the integration.

## Working agreement

- Work on a feature branch. Commit locally, never push. Push, tags on remotes
  and GitHub releases only on explicit request.
- Commit as the agent with the attribution trailers the session provides.
- Release = two commits: the change, then `vX.Y.Z -- <summary>` that bumps
  `VERSION` in `dist/alphaess-card.js` and moves the CHANGELOG entry from
  *Unreleased* to the new version. Annotated tag `vX.Y.Z` locally.
  The release workflow refuses a tag that does not match `VERSION`.
- Semver: feature = minor, fix = patch.
- TDD: every bug gets a regression test that fails on the old code (check it).
- Never claim "tested in Home Assistant" when only the node tests and a
  mocked browser ran.

## Project structure

```
dist/alphaess-card.js       the card (single file, no build step, no deps)
tests/card.test.mjs         node tests (vm + minimal DOM stub)
hacs.json                   HACS metadata (filename, min. HA version)
.github/workflows/          validate.yml (HACS, syntax, tests), release.yml
docs/                       preview.html + render-previews.sh -> README images
README.md, CHANGELOG.md, LICENSE
```

## Card rules

- Whole file in `(function () { … })();`, syntax ≤ ES2019 (no `?.`, `??`,
  logical assignment, `.at()`, `replaceAll`, `#private`).
- Every `color-mix()` and `conic-gradient()` has a plain fallback declaration
  directly before it; no flex/grid `gap`, no `inset`.
- Registration guarded (`customElements.get`, `window.customCards` by type).
- Render errors are caught and shown in the card (`_safeUpdate`).
- DOM is built with `createElement`; all text only via `textContent`.
- Entities are resolved via `hass.entities` (device_id + platform
  `alphaess_modbus`). Most of the integration's sensors have no
  translation_key, so the lookup order is: translation_key, object ID suffix
  (`…_grid_power`), English entity name at the end of the friendly name.
  Users can override single roles with `entities:`.
- Displayed power is always positive; direction is label + colour.
  Sign conventions: grid positive = import; battery negative = charging
  (what the inverters actually report, despite the integration's register
  description), `invert_battery` flips it.
- No silent defaults: without a device the card shows a hint.
- Fixed size in sections: 12 columns × 3 rows. Width classes `compact`
  (< 640 px) and `narrow` (< 440 px) via ResizeObserver.
- Editor: load `ha-form` via `loadCardHelpers()` before use; write the device
  into the config as soon as it is known, independent of `ha-form`.

## Tests

`node --test tests/*.mjs` covers:

- the card file evaluated twice as a classic script in one shared context;
- source scan for syntax newer than ES2019, function scope wrapper,
  `color-mix()`/`conic-gradient()` fallbacks, no `gap`/`inset`;
- hints for missing device, unknown device and no sensors;
- tile values, labels and colours for export/charging, discharging/idle,
  import, `invert_battery`, `idle_threshold`, kW sensors, unavailable sensors;
- today's energy, self-sufficiency and the options that hide them;
- entity lookup by friendly name, no match on per-phase grid sensors,
  `entities:` override;
- render errors shown inside the card; grid/layout sizes; `getStubConfig`;
- editor works without `ha-form` and fills in the device.

Visual check: `sh docs/render-previews.sh` (headless Chrome, mocked
`ha-card`/`ha-icon`), light and dark, at 498 px (12 columns) and 360 px.
