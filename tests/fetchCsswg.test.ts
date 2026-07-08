import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type { CsswgSpecEntry } from "../src/specs/fetchCsswg.js";
import {
  extractExamples,
  fetchCsswgSpecs,
  parseCsswgIndex,
  resolveSelectedSpecSlugs,
  selectLatestCsswgSpecSlugs,
} from "../src/specs/fetchCsswg.js";

const specs: readonly CsswgSpecEntry[] = [
  {
    slug: "animation-triggers-1",
    title: "Animation Triggers",
    url: "https://drafts.csswg.org/animation-triggers-1/",
  },
  {
    slug: "compositing-2",
    title: "Compositing and Blending 2",
    url: "https://drafts.csswg.org/compositing-2/",
  },
  { slug: "css-2026", title: "CSS Snapshot 2026", url: "https://drafts.csswg.org/css-2026/" },
  { slug: "css-color-4", title: "CSS Color 4", url: "https://drafts.csswg.org/css-color-4/" },
  { slug: "css-color-6", title: "CSS Color 6", url: "https://drafts.csswg.org/css-color-6/" },
  { slug: "css-values-4", title: "CSS Values 4", url: "https://drafts.csswg.org/css-values-4/" },
  { slug: "css-values-5", title: "CSS Values 5", url: "https://drafts.csswg.org/css-values-5/" },
  { slug: "css-egg-1", title: "CSS Egg 1", url: "https://drafts.csswg.org/css-egg-1/" },
  {
    slug: "fill-stroke-3",
    title: "CSS Fill and Stroke 3",
    url: "https://drafts.csswg.org/fill-stroke-3/",
  },
  {
    slug: "filter-effects-2",
    title: "Filter Effects 2",
    url: "https://drafts.csswg.org/filter-effects-2/",
  },
  {
    slug: "mediaqueries-4",
    title: "Media Queries 4",
    url: "https://drafts.csswg.org/mediaqueries-4/",
  },
  {
    slug: "mediaqueries-5",
    title: "Media Queries 5",
    url: "https://drafts.csswg.org/mediaqueries-5/",
  },
  { slug: "motion-1", title: "Motion Path 1", url: "https://drafts.csswg.org/motion-1/" },
  {
    slug: "web-animations-2",
    title: "Web Animations 2",
    url: "https://drafts.csswg.org/web-animations-2/",
  },
  {
    slug: "web-animations-css-integration",
    title: "Web Animations CSS Integration",
    url: "https://drafts.csswg.org/web-animations-css-integration/",
  },
] as const;

describe("CSSWG spec selection", () => {
  test("selects latest levels from the live index and skips snapshots", () => {
    expect(selectLatestCsswgSpecSlugs(specs)).toEqual([
      "animation-triggers-1",
      "compositing-2",
      "css-color-6",
      "css-values-5",
      "fill-stroke-3",
      "filter-effects-2",
      "mediaqueries-5",
      "motion-1",
      "web-animations-css-integration",
    ]);
  });

  test("default selection includes latest levels, curated current levels, and external specs", () => {
    const selected = resolveSelectedSpecSlugs(specs);
    expect(selected).toContain("animation-triggers-1");
    expect(selected).toContain("compositing-2");
    expect(selected).toContain("css-color-6");
    expect(selected).toContain("css-color-4");
    expect(selected).toContain("css-values-5");
    expect(selected).toContain("fill-stroke-3");
    expect(selected).toContain("filter-effects-2");
    expect(selected).toContain("css-properties-values-api-1");
    expect(selected).toContain("web-animations-css-integration");
    expect(selected).not.toContain("css-2026");
    expect(selected).not.toContain("css-egg-1");
    expect(selected).not.toContain("web-animations-2");
  });

  test("all selection keeps every live index slug plus external specs", () => {
    expect(resolveSelectedSpecSlugs(specs, ["all"])).toEqual([
      "animation-triggers-1",
      "compositing-2",
      "css-2026",
      "css-color-4",
      "css-color-6",
      "css-egg-1",
      "css-properties-values-api-1",
      "css-values-4",
      "css-values-5",
      "fill-stroke-3",
      "filter-effects-2",
      "mediaqueries-4",
      "mediaqueries-5",
      "motion-1",
      "web-animations-2",
      "web-animations-css-integration",
    ]);
  });

  test("explicit slug selection is exact and deduplicated", () => {
    expect(resolveSelectedSpecSlugs(specs, ["css-color-4", "css-color-4"])).toEqual([
      "css-color-4",
    ]);
  });

  test("parses parser-relevant non-css-prefixed CSSWG slugs from the index", () => {
    const parsed = parseCsswgIndex(`<ul>
      <li><a href="./filter-effects-2/">Filter Effects Module Level 2</a> 2026-01-23</li>
      <li><a href="./fill-stroke-3/">CSS Fill and Stroke Module Level 3</a> 2026-03-04</li>
      <li><a href="./compositing-2/">Compositing and Blending Module Level 2</a> 2025-12-13</li>
      <li><a href="./animation-triggers-1/">Animation Triggers</a> 2026-05-21</li>
      <li><a href="./web-animations-2/">Web Animations 2</a> 2026-02-01</li>
      <li><a href="./web-animations-css-integration/">Web Animations CSS Integration</a> 2026-02-01</li>
      <li><a href="./matrix/">DOMMatrix interface</a> 2026-01-23</li>
      <li><a href="./indexes/">CSS Indexes</a> 2026-01-16</li>
    </ul>`);

    expect(parsed.map((spec) => spec.slug)).toEqual([
      "animation-triggers-1",
      "compositing-2",
      "fill-stroke-3",
      "filter-effects-2",
      "web-animations-css-integration",
    ]);
  });
});

describe("extractExamples", () => {
  test("skips examples inside issue blocks", () => {
    expect(
      extractExamples(
        "css-extensions-1",
        `<div class="issue"><pre>@custom-selector :--heading { expansion: h1; }</pre></div><pre>a { color: red; }</pre>`,
      ),
    ).toEqual([{ slug: "css-extensions-1", source: "a { color: red; }" }]);
  });

  test("does not cap examples unless requested", () => {
    const html = Array.from(
      { length: 3 },
      (_item, index) => `<pre>.x${index} { color: red; }</pre>`,
    ).join("");

    expect(extractExamples("css-example-1", html)).toHaveLength(3);
    expect(extractExamples("css-example-1", html, { maxExamples: 2 })).toHaveLength(2);
  });
});

describe("fetchCsswgSpecs", () => {
  test("writes a corpus manifest with selected, downloaded, failed, and per-spec counts", async () => {
    const originalFetch = globalThis.fetch;
    const outDir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-specs-"));
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://drafts.csswg.org/") {
        return new Response(
          `<ul>
            <li><a href="./css-color-4/">CSS Color 4</a> 2026-01-01</li>
            <li><a href="./css-values-5/">CSS Values 5</a> 2026-01-01</li>
          </ul>`,
          { status: 200 },
        );
      }
      if (url === "https://drafts.csswg.org/css-color-4/") {
        return new Response("<pre>a { color: oklch(70% 0.2 230); }</pre>", { status: 200 });
      }
      return new Response("not found", { status: 404, statusText: "Not Found" });
    };

    try {
      await expect(
        fetchCsswgSpecs({
          outDir,
          downloadSpecs: true,
          slugs: ["css-color-4", "css-values-5"],
        }),
      ).rejects.toThrow("Failed to download 1 selected CSS spec");

      const corpus = JSON.parse(await readFile(path.join(outDir, "examples.json"), "utf8")) as {
        readonly indexUrl?: string;
        readonly selectedSlugs?: readonly string[];
        readonly downloadedSlugs?: readonly string[];
        readonly failedSpecs?: readonly { readonly slug?: string }[];
        readonly exampleCountsBySpec?: readonly {
          readonly slug?: string;
          readonly extractedExamples?: number;
        }[];
        readonly examples?: readonly { readonly slug?: string; readonly source?: string }[];
      };
      expect(corpus.indexUrl).toBe("https://drafts.csswg.org/");
      expect(corpus.selectedSlugs).toEqual(["css-color-4", "css-values-5"]);
      expect(corpus.downloadedSlugs).toEqual(["css-color-4"]);
      expect(corpus.failedSpecs).toEqual([
        {
          slug: "css-values-5",
          url: "https://drafts.csswg.org/css-values-5/",
          message: "Failed to fetch https://drafts.csswg.org/css-values-5/: 404 Not Found",
        },
      ]);
      expect(corpus.exampleCountsBySpec).toEqual([{ slug: "css-color-4", extractedExamples: 1 }]);
      expect(corpus.examples).toEqual([
        { slug: "css-color-4", source: "a { color: oklch(70% 0.2 230); }" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
