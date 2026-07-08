# css-fuzzer

`css-fuzzer` is a strongly typed TypeScript differential fuzzer for CSS parser behavior. It generates modern CSS, runs each case through multiple parser adapters, and minimizes disagreements into small replayable inputs.

Current parser adapters:

- `postcss` through `postcss.parse`
- `prettier-css` through Prettier's CSS parser debug entry
- `lightningcss` through `transform`
- `oxc-css-parser` through the local Rust driver in `tools/oxc-css-parser-driver`

## Setup

```sh
vp install
vp run build:oxc-driver
vp run fetch-specs -- --download
vp run verify-spec-corpus
vp run verify-generator-coverage
vp run verify-generator-coverage -- --require-selected-specs
vp run verify-lightning-roundtrip -- --known-dir ../css-parser-fuzzer-cases/cases --out findings/lightning-roundtrip --minimize
vp run verify-prettier-roundtrip -- --known-dir ../css-parser-fuzzer-cases/cases --out findings/prettier-roundtrip --minimize
vp check
vp test
```

The OXC driver expects a sibling checkout at `../oxc-css-parser`, matching this workspace layout:

```text
github-opensource/
  css-fuzzer/
  oxc-css-parser/
```

If the driver binary lives elsewhere, pass it with `OXC_CSS_PARSER_BIN=/path/to/oxc-css-parser-driver`.

## Commands

```sh
vp run fetch-specs -- --download
vp run verify-spec-corpus
vp run verify-generator-coverage
vp run verify-generator-coverage -- --require-selected-specs
vp run verify-lightning-roundtrip -- --known-dir ../css-parser-fuzzer-cases/cases --out findings/lightning-roundtrip --minimize
vp run verify-prettier-roundtrip -- --known-dir ../css-parser-fuzzer-cases/cases --out findings/prettier-roundtrip --minimize
vp run generate -- --seed 1 --count 5
vp run fuzz -- --seed 1 --iterations 100 --known-dir ../css-parser-fuzzer-cases/cases --minimize
vp run verify-findings-known -- --findings-dir findings/cases --known-dir ../css-parser-fuzzer-cases/cases
vp run bench-adapters -- --iterations 5
vp run replay -- --dir ../css-parser-fuzzer-cases/cases
vp run verify-cases -- --dir ../css-parser-fuzzer-cases/cases --readme ../css-parser-fuzzer-cases/README.md
vp run verify-cases -- --dir ../css-parser-fuzzer-cases/cases --readme ../css-parser-fuzzer-cases/README.md --check-minimized
vp run reduce -- --file findings/campaign/example.css --out /tmp/reduced.css
```

`fetch-specs` reads the live CSS Working Group editor draft index, writes `data/specs/csswg-index.json`, and can download selected modern CSS modules into `data/specs/raw/` before extracting examples into `data/specs/examples.json`. By default, `--download` selects the highest live level for each parser-relevant CSSWG spec family, including CSS modules whose slugs do not start with `css-`, such as `animation-triggers`, `compositing`, `fill-stroke`, and `filter-effects`. It keeps hand-picked current levels that are still important for parser support, skips non-parser-target joke specs such as `css-egg-1`, includes the Houdini Properties and Values API draft, and keeps every extracted example from each downloaded spec. The generated corpus records a manifest with selected specs, downloaded specs, failed downloads, per-spec example counts, and the live index URL; `fetch-specs` fails by default if any selected spec cannot be downloaded. Use `--allow-fetch-failures` only for debugging a partial corpus, `--max-examples-per-spec N` only when you intentionally want a bounded corpus, `--slugs all` to download every CSSWG index entry plus external Houdini entries, or pass a comma-separated slug list for a targeted corpus.

`generate` and `fuzz` require `data/specs/examples.json` by default and load all normalized entries from it. The corpus must include the download manifest, must not contain failed spec downloads, and must be no older than 72 hours by default; old manifest-free or stale corpora are rejected so campaigns cannot silently lose live spec coverage. Run `fetch-specs -- --download` first, use `--max-spec-examples N` only when you intentionally want a smaller corpus, `--max-spec-corpus-age-hours N` only when replaying an older campaign intentionally, `--no-spec-corpus` to run only grammar-shaped and curated seeds, or `--spec-corpus path/to/examples.json` to point at another generated corpus.

The fuzzer accepts only `--syntax css`. The parser adapter set is intentionally CSS-specific: postcss uses its default CSS parser, Prettier uses the CSS parser debug entry, lightningcss transforms CSS, and the OXC driver is invoked in CSS mode. SCSS, Sass, and Less are rejected instead of producing misleading cross-parser disagreements from mismatched adapter modes.

`verify-spec-corpus` audits `data/specs/examples.json` before a campaign. It requires the generated CSSWG index file next to the corpus by default, or a custom `--spec-index path/to/csswg-index.json`, checks that both files are within the configured freshness window and were produced by the same fetch, and checks that the selected/downloaded sets include the latest level for every live CSSWG spec family in that index. It also fails when required modern CSS specs are missing from the selected/downloaded sets, when the corpus records failed downloads, or when any selected spec has no generated coverage from either normalized spec examples or curated seeds. It reports selected specs with zero extracted or normalized examples as warnings for follow-up coverage work.

`verify-generator-coverage` runs a deterministic generation window, defaulting to seed `1` and `10000` cases, and checks the actual generated cases for all required modern spec refs plus the main generator tag families. Pass `--require-selected-specs` before a full campaign to require every currently selected CSSWG spec from the corpus manifest; that mode defaults to `50000` generated cases unless `--count N` is provided. This complements `verify-spec-corpus`: the corpus gate proves inputs exist, while the generator gate proves weighted generation can actually reach them under the current normalization, mutation, and tag wiring.

`verify-lightning-roundtrip` is a metamorphic oracle for accepted lightningcss inputs. It generates a deterministic seed window, parses each case through the default adapters, takes lightningcss's transformed CSS when lightningcss accepted the input and changed the source, and reparses that transformed CSS with the same adapter set. A transformed output that creates a parser-status disagreement fails the command unless it matches `--known-dir`; this catches cases where a parser accepts an input but emits CSS that the parser matrix cannot consistently parse. Pass `--out <dir>` to write each unknown transformed-output mismatch as replayable `.css` plus JSON report metadata that also preserves the original trigger case and original parser results. The same output directory also gets `roundtrip-summary.json` with run metadata, counts, and written finding paths, including zero-mismatch or fully known runs. Add `--minimize` to reduce the emitted CSS before writing; minimization preserves the transformed-output parser fingerprint and records the reducer attempts in JSON.

`verify-prettier-roundtrip` is the equivalent metamorphic oracle for Prettier's CSS formatter. It only checks inputs that the full parser matrix already accepts, then formats them with Prettier and reparses the formatted CSS through the same adapters, so existing parser disagreements do not get reported again as formatter-output issues. Pass `--out <dir>` to write each unknown formatted-output mismatch as replayable `.css` plus JSON report metadata that also preserves the original trigger case and original parser results. The same output directory also gets `roundtrip-summary.json` with run metadata, counts, and written finding paths, including zero-mismatch or fully known runs. If Prettier's parser accepts an input but the formatter crashes before producing CSS, the report writes the original trigger CSS and records `prettier-css=crashed` with the formatter error message. Add `--minimize` to reduce the formatted output or formatter-crash trigger before writing; minimization preserves the formatted-output parser fingerprint or formatter crash message and records the reducer attempts in JSON.

`verify-findings-known` closes the campaign-to-cases loop. It reads finding `.json` reports from `--findings-dir`, skips `campaign-summary.json` and `roundtrip-summary.json`, replays each report's CSS with the current parser adapters, and checks each current source/result matrix against the cases repo loaded from `--known-dir`. It uses the same exact-source fingerprints and narrow issue-family matching as fuzz campaigns, so it fails when a campaign produced current parser disagreements that have not yet been promoted into the companion cases repository. Reports that no longer reproduce an interesting disagreement are listed as stale instead of blocking the gate. Minimized finding reports are replayed from their minimized source.

Numeric count, timeout, attempt, and corpus-limit options must be positive integers. Commands reject unknown and duplicate options so typoed campaign settings cannot silently fall back to defaults. Flag-style options such as `--minimize`, `--byte-minimize`, `--download`, `--allow-fetch-failures`, `--no-spec-corpus`, `--check-minimized`, and `--require-selected-specs` are the only value-less CLI options.

`bench-adapters` measures parser adapter throughput for the configured local environment. It runs the default adapters repeatedly against one source string and reports total/average milliseconds and status counts per parser. The JavaScript adapters run through reusable worker processes, so repeated parses measure steady-state adapter cost instead of paying a process spawn for every input. Use this command before and after changing adapter process models or timeout behavior.

## Design Notes

The generator combines four sources:

- Grammar-shaped generation for selectors, at-rules, declarations, values, nesting, custom properties, and error recovery edges.
- Curated modern CSS feature seeds for areas where the grammar is still moving, such as anchor positioning, container queries, cascade layers, color functions, scroll-driven animations, view transitions, `@scope`, and CSS nesting.
- Downloaded CSSWG editor draft examples, refreshed by `fetch-specs`, so the corpus follows the current spec surface instead of relying on memory.
- Deterministic mutations of downloaded examples, such as pairing them with another rule or wrapping nest-safe examples in `@layer`, `@media`, or `@supports`, so campaigns explore syntax around spec examples instead of only replaying them verbatim.

The runner classifies each parser result as `accepted`, `accepted_with_errors`, `rejected`, `crashed`, `timed_out`, or `unsupported`. Syntax parse errors are `rejected`; internal non-syntax exceptions from parser APIs are `crashed`. OXC recoverable parser errors are `accepted_with_errors` and include the first recoverable error message when available. A finding is interesting when supported parsers disagree on those states, or when any supported parser crashes or times out.

Default parser-consuming commands such as `fuzz`, `replay`, `reduce`, and `verify-cases` first run a smoke parse through all four required adapters. They fail before doing work if postcss, Prettier CSS, lightningcss, or OXC is missing, unsupported, or unable to accept basic CSS, so a campaign cannot silently run with one target parser absent.

Finding JSON written by `fuzz` wraps the finding with a run environment and campaign metadata. The environment records Node version, package manager, parser package versions, the sibling OXC checkout commit when available, and the spec corpus path/fetch counts when a corpus is loaded, including selected/downloaded/failed spec counts. The run metadata records the root seed, iteration count, syntax, timeout, minimization settings, output directory, known-dir, and spec corpus path. The paired `.css` file stays plain replayable CSS. Each finding report plus `campaign-summary.json` and `roundtrip-summary.json` is written exclusively, so reusing an output directory with an existing case id or summary fails instead of silently overwriting evidence. Each campaign summary includes the final iteration count, new finding count, known-skip count, duplicate-skip count, loaded known source/family counts, generated tag/spec-ref coverage, and all finding output paths, so zero-finding campaigns still leave an audit record. Each roundtrip summary records generated/checked counts, skipped-input counts, known/duplicate skips, mismatch count, and written finding paths.

Within a run, findings are deduplicated by normalized source plus supported parser status and the first line of each parser error message. The same check runs before minimization and again after minimization, so different raw inputs that reduce to the same final case do not produce duplicate report files. Exact duplicate inputs are skipped, but different CSS sources with the same parser message are still reported unless a known issue family suppresses them.

Use `--known-dir ../css-parser-fuzzer-cases/cases` during fuzz campaigns to replay already-filed cases first and skip findings with matching normalized source plus parser-result fingerprints. Prettier roundtrip/archive commands also run the current Prettier formatter over known cases whose parser matrix is otherwise uninteresting, so archived formatter-crash cases can suppress future `prettier-format-crash` reports. Only filed cases that still replay as interesting under the current parser versions, or still reproduce the formatter crash under the current Prettier version, become known fingerprints or known families. The runner also derives narrow known issue families from filed cases when that is safer than exact-source matching; currently this groups `@property` initial-value validation variants where lightningcss rejects different value tokens for the same descriptor-validation reason, Selectors column-combinator findings where nesting changes lightningcss's error text for the same `||` root cause, Selectors reference-combinator findings where comments or selector lists change the surrounding source for `/for/`, generated marker pseudo-element chain findings, Shadow Parts multi-ident `::part()` findings, CSS Color 5 `@color-profile device-cmyk` recoverable OXC errors, `@scope` relative selector findings, container query list findings where lightningcss rejects a comma-separated query list, container query `var()` threshold findings, name-only container query findings, the known column-combinator plus name-only container-query cross-product, anchored container query findings, CSS Link Parameters `url(... param(...))` findings, legacy `url(var(...))` BadUrl findings, nested `var()` reference findings, page slot pseudo findings, page `@slot` rule findings, page `@top` margin rule findings, scroll-driven keyframe range findings, late `@import` ordering findings where strict parsers reject invalid placement, double-dot selector recovery, invalid media query list recovery, dynamic property name recovery, and invalid font-family punctuation recovery.

After a campaign writes finding reports, run `verify-findings-known` against that output directory and the companion cases repository. A passing result means every currently reproducible report in that directory is already represented by a current exact case or recognized case family; a failing result lists the unarchived report files that still need to become minimized cases with README rows and sidecar notes.

When `--minimize` is enabled, the reducer only writes a minimized finding if the final replay is still interesting and preserves the original parser-result fingerprint; for recognized known issue families, it must preserve the same family too. If that final replay check fails, the runner emits a warning and writes the original finding instead of a misleading reduced case.

Use `verify-cases` after editing the companion cases repository. It checks that every `.css` file under `cases/` has a same-path `.md` sidecar note, every sidecar note has a matching `.css` case, every sidecar note has a `css` reproduction block matching the `.css` file, every sidecar note includes `Minimal Reproduction`, `Parser Results`, and either `Spec Context` or `Triage Note`, every sidecar title starts with the same case ID as the matching README row, every sidecar `Parser Results` table has a complete result for all parser adapters, every non-accepted sidecar result includes an error-message snippet, and the sidecar table matches replayed parser statuses and error-message snippets, every `.css` file is linked exactly once from the README, every README case ID is unique, every README case ID matches the linked case file basename, every README case link exists on disk, every README case link is listed under the matching High/Medium/Low priority section for its `cases/high`, `cases/medium`, or `cases/low` path, every README case link has a complete parser matrix row for all parser adapters, every non-accepted README matrix result includes an error-message snippet, every filed case still produces an interesting parser disagreement under the current adapter versions, and the README parser matrix matches replayed parser statuses and error-message snippets. Add `--check-minimized` before treating a case set as report-ready; this reruns the reducer against each filed case and fails if the current minimizer can still produce a shorter input with the same parser-result fingerprint. For cases that match a known issue family, the minimizer must preserve that family as well as the parser fingerprint. Use `--minimize-attempts N` to tune the budget and `--byte-minimize` for a stricter diagnostic byte-level pass; the verifier prints exact reduced candidate strings for review, but byte-level candidates still need human judgment before replacing readable report cases.
