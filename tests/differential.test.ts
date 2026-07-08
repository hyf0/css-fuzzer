import { describe, expect, test } from "vite-plus/test";
import type { FuzzCase, ParseResult, ParserAdapter } from "../src/core/types.js";
import {
  classifyFinding,
  findingFamilyFingerprint,
  findingFingerprint,
  findingSourceFingerprint,
  preservesFindingIdentity,
  runDifferentialCase,
} from "../src/runner/differential.js";

const testCase: FuzzCase = {
  id: "case",
  seed: "1",
  syntax: "css",
  source: "a { color: red; }",
  tags: [],
  specRefs: [],
};

describe("differential runner", () => {
  test("marks status disagreement as interesting", () => {
    const finding = classifyFinding(testCase, [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "lightningcss", status: "rejected", durationMs: 1 },
    ]);
    expect(finding.interesting).toBe(true);
  });

  test("ignores unsupported adapters when supported adapters agree", async () => {
    const adapters: readonly ParserAdapter[] = [
      {
        name: "postcss",
        parse: async () => ({ parser: "postcss", status: "accepted", durationMs: 1 }),
      },
      {
        name: "oxc-css-parser",
        parse: async () => ({ parser: "oxc-css-parser", status: "unsupported", durationMs: 1 }),
      },
    ];
    const finding = await runDifferentialCase(adapters, testCase, {
      syntax: "css",
      timeoutMs: 100,
    });
    expect(finding.interesting).toBe(false);
  });

  test("builds a stable fingerprint from supported parser results", () => {
    expect(
      findingFingerprint([
        { parser: "oxc-css-parser", status: "unsupported", durationMs: 1 },
        { parser: "lightningcss", status: "rejected", durationMs: 1, message: "first\nsecond" },
        { parser: "postcss", status: "accepted", durationMs: 1 },
      ]),
    ).toBe("lightningcss:rejected:first|postcss:accepted");
  });

  test("normalizes unstable parser positions in fingerprints", () => {
    expect(
      findingFingerprint([
        {
          parser: "postcss",
          status: "rejected",
          durationMs: 1,
          message: "<css input>:12:3: Unclosed comment",
        },
        {
          parser: "prettier-css",
          status: "rejected",
          durationMs: 1,
          message: "CssSyntaxError: Unclosed comment (12:3)",
        },
      ]),
    ).toBe(
      "postcss:rejected:<css input>:Unclosed comment|prettier-css:rejected:CssSyntaxError: Unclosed comment (line:column)",
    );
  });

  test("includes normalized source in source fingerprints", () => {
    const results = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "lightningcss", status: "rejected", durationMs: 1, message: "Unexpected token" },
    ] as const;

    expect(findingSourceFingerprint("a { color: red; }\r\n", results)).toBe(
      findingSourceFingerprint("a { color: red; }", results),
    );
    expect(findingSourceFingerprint("b { color: red; }", results)).not.toBe(
      findingSourceFingerprint("a { color: red; }", results),
    );
  });

  test("preserves known finding family identity during minimization", () => {
    const results = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "prettier-css", status: "accepted", durationMs: 1 },
      { parser: "lightningcss", status: "accepted", durationMs: 1 },
      {
        parser: "oxc-css-parser",
        status: "accepted_with_errors",
        durationMs: 1,
        message: "dashed identifier is expected",
      },
    ] satisfies readonly ParseResult[];

    expect(
      preservesFindingIdentity(
        '@color-profile device-cmyk { src: url("profile.icc"); }',
        results,
        "@color-profile device-cmyk{color:red}",
        results,
      ),
    ).toBe(true);
    expect(
      preservesFindingIdentity(
        '@color-profile device-cmyk { src: url("profile.icc"); }',
        results,
        "@color-profile k{color:red}",
        results,
      ),
    ).toBe(false);
  });

  test("preserves unknown finding identity by parser fingerprint", () => {
    const results = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "lightningcss", status: "rejected", durationMs: 1, message: "Unexpected token" },
    ] satisfies readonly ParseResult[];

    expect(
      preservesFindingIdentity("a { color: red; }", results, "b { color: red; }", results),
    ).toBe(true);
    expect(
      preservesFindingIdentity("a { color: red; }", results, "b { color: red; }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Different token",
        },
      ]),
    ).toBe(false);
  });

  test("groups @property value validation findings into a family", () => {
    expect(
      findingFamilyFingerprint("@property --x { syntax: '<color>'; initial-value: 1lh; }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message:
            'Unexpected token Dimension { has_sign: false, value: 1.0, int_value: Some(1), unit: "lh" }',
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:property-initial-value-validation|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token value",
    );
  });

  test("groups @property identifier value validation findings into the same family", () => {
    expect(
      findingFamilyFingerprint(
        "@property --x { syntax: '<length>'; inherits: false; initial-value: CanvasText; }",
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: 'Unexpected token Ident("CanvasText")',
          },
          { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
        ],
      ),
    ).toBe(
      "family:property-initial-value-validation|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token value",
    );
  });

  test("groups nested var reference findings", () => {
    expect(
      findingFamilyFingerprint(":root { --result: var(var(--myvar)); }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: 'Unexpected token Function("var")',
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      'family:nested-var-reference|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Function("var")',
    );
  });

  test("groups empty scope root roundtrip findings", () => {
    expect(
      findingFamilyFingerprint("@scope () { a { color: red; } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "accepted", durationMs: 1 },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "simple selector is expected",
        },
      ]),
    ).toBe(
      "family:scope-empty-root|lightningcss:accepted|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|oxc-css-parser:rejected:simple selector is expected",
    );
  });

  test("does not group ordinary function rejections as @property validation", () => {
    expect(
      findingFamilyFingerprint(".x { width: var(--query); }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: 'Unexpected token Function("var")',
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBeUndefined();
  });

  test("groups column combinator rejections across nested parser messages", () => {
    expect(
      findingFamilyFingerprint(".x { @container (width > 1px) { a || b { color: red; } } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Unexpected token CurlyBracketBlock",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:selectors-column-combinator|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:column-combinator",
    );
  });

  test("groups known column-combinator plus name-only container cross-products", () => {
    expect(
      findingFamilyFingerprint(
        "@container my-page-layout { .card { padding: 1em; } } .card:where([data-state='open']) || dialog { animation-timeline: --scroller; accent-color: rgb(20 40 60 / 80%); }",
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: "Unexpected token in namespace selector: Delim('|')",
          },
          {
            parser: "oxc-css-parser",
            status: "rejected",
            durationMs: 1,
            message: "expect token `<ident>`, but found `{`",
          },
        ],
      ),
    ).toBe(
      "family:compound:selectors-column-combinator+container-query-name-only|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:column-combinator|oxc-css-parser:rejected:name-only container",
    );
  });

  test("groups reference combinator rejections across selector comments", () => {
    expect(
      findingFamilyFingerprint(
        'label:is(:hover, :focus) /for/ input, /* association by "for" attribute */\nlabel input { box-shadow: yellow 0 0 10px; }',
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: "Invalid dangling combinator in selector",
          },
          { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
        ],
      ),
    ).toBe(
      "family:selectors-reference-combinator|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:reference-combinator",
    );
  });

  test("groups generated marker pseudo-element chain rejections", () => {
    expect(
      findingFamilyFingerprint("#target::before::marker { width: calc(1 * 10px); }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Invalid state",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:pseudo-before-marker-chain|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Invalid state",
    );
  });

  test("groups shadow parts multiple-ident rejections", () => {
    expect(
      findingFamilyFingerprint("x-tabs::part(tab active) { color: red; }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "accepted", durationMs: 1 },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "expect token `)`, but found `<ident>`",
        },
      ]),
    ).toBe(
      "family:shadow-parts-multiple-ident|lightningcss:accepted|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|oxc-css-parser:rejected:part ident list",
    );
  });

  test("groups device-cmyk color profile recoverable OXC errors", () => {
    expect(
      findingFamilyFingerprint('@color-profile device-cmyk { src: url("profile.icc"); }', [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "accepted", durationMs: 1 },
        {
          parser: "oxc-css-parser",
          status: "accepted_with_errors",
          durationMs: 1,
          message: "dashed identifier is expected",
        },
      ]),
    ).toBe(
      "family:color-profile-device-cmyk|lightningcss:accepted|oxc-css-parser:accepted_with_errors|postcss:accepted|prettier-css:accepted|oxc-css-parser:accepted_with_errors:dashed identifier is expected",
    );
  });

  test("groups container query list comma rejections", () => {
    expect(
      findingFamilyFingerprint(
        "@container card (inline-size > 30em), style(--large: true) { .x { color: red; } }",
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: "Unexpected token Comma",
          },
          { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
        ],
      ),
    ).toBe(
      "family:container-query-list|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Comma",
    );
  });

  test("groups container query var threshold rejections", () => {
    expect(
      findingFamilyFingerprint("@container (width > var(--query)) { h2 { color: red; } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: 'Unexpected token Function("var")',
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      'family:container-query-var-threshold|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Function("var")',
    );
  });

  test("groups name-only container query rejections", () => {
    expect(
      findingFamilyFingerprint("@container my-page-layout { .card { padding: 1em; } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "accepted", durationMs: 1 },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "expect token `<ident>`, but found `{`",
        },
      ]),
    ).toBe(
      "family:container-query-name-only|lightningcss:accepted|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|oxc-css-parser:rejected:name-only container",
    );
  });

  test("groups anchored container query rejections", () => {
    expect(
      findingFamilyFingerprint(
        ".anchored { @container anchored(fallback: bottom any) { .inner { color: lime; } } }",
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: 'Unexpected token Function("anchored")',
          },
          {
            parser: "oxc-css-parser",
            status: "rejected",
            durationMs: 1,
            message: "expect token `)`, but found `<ident>`",
          },
        ],
      ),
    ).toBe(
      'family:anchor-position-anchored-container-query|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Function("anchored")',
    );
  });

  test("groups link parameter url rejections across comma and function forms", () => {
    const results = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "prettier-css", status: "accepted", durationMs: 1 },
      {
        parser: "lightningcss",
        status: "rejected",
        durationMs: 1,
        message: "Unexpected token Comma",
      },
      { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
    ] as const;

    expect(
      findingFamilyFingerprint(
        '.foo { background-image: url("image.svg", param(--color, green)); }',
        results,
      ),
    ).toBe(
      "family:link-params-url-param|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:url param",
    );
    expect(
      findingFamilyFingerprint(
        '.foo { background-image: url("image.svg" param(--color, green)); }',
        [
          ...results.slice(0, 2),
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: 'Unexpected token Function("param")',
          },
          results[3],
        ],
      ),
    ).toBe(
      "family:link-params-url-param|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:url param",
    );
  });

  test("groups var inside legacy url rejections", () => {
    expect(
      findingFamilyFingerprint(
        '.spec-example { --foo: "http://www.example.com/pinkish.gif"; background: url(var(--foo)); }',
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: 'Unexpected token BadUrl("var(--foo")',
          },
          { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
        ],
      ),
    ).toBe(
      "family:var-in-url|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:BadUrl(var)",
    );
  });

  test("groups @scope relative selector rejections", () => {
    expect(
      findingFamilyFingerprint("@scope (#my-component) { > p { color: green; } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Invalid empty selector",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:scope-relative-selector|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Invalid empty selector",
    );
  });

  test("groups late @import order rejections", () => {
    expect(
      findingFamilyFingerprint('a { color: red; } @import url("late.css");', [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "@import rules must precede all rules aside from @charset and @layer statements",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:late-import-order|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:late import",
    );
  });

  test("groups invalid double-dot selector recovery", () => {
    expect(
      findingFamilyFingerprint("h2..foo { font-family: sans-serif }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Expected identifier in class selector, got Delim('.')",
        },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "expect token `<ident>`, but found `.`",
        },
      ]),
    ).toBe(
      "family:invalid-double-class-dot|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:double class dot",
    );
  });

  test("groups invalid media query list recovery", () => {
    const results = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "prettier-css", status: "accepted", durationMs: 1 },
      {
        parser: "lightningcss",
        status: "rejected",
        durationMs: 1,
        message: "Unexpected token Semicolon",
      },
      {
        parser: "oxc-css-parser",
        status: "rejected",
        durationMs: 1,
        message: "expect token `{`, but found `;`",
      },
    ] as const;

    expect(
      findingFamilyFingerprint("@media test;,all { body { background: lime } }", results),
    ).toBe(
      "family:invalid-media-query-list-recovery|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Semicolon",
    );
    expect(findingFamilyFingerprint("@layer fuzz { @media test; }", results)).toBe(
      "family:invalid-media-query-list-recovery|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Semicolon",
    );
  });

  test("groups invalid media query list comma recovery", () => {
    const results = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "prettier-css", status: "accepted", durationMs: 1 },
      {
        parser: "lightningcss",
        status: "rejected",
        durationMs: 1,
        message: "Unexpected token Comma",
      },
      {
        parser: "oxc-css-parser",
        status: "rejected",
        durationMs: 1,
        message: "expect token `<ident>`, but found `&`",
      },
    ] as const;

    expect(
      findingFamilyFingerprint(
        "@media (example, all,), speech { }\n@media &test, speech { }",
        results,
      ),
    ).toBe(
      "family:invalid-media-query-list-comma-recovery|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Comma",
    );
    expect(
      findingFamilyFingerprint(
        "@supports (selector(:has(*))) { @media (example, all,), speech { } @media &test, speech { } }",
        results,
      ),
    ).toBe(
      "family:invalid-media-query-list-comma-recovery|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Comma",
    );
  });

  test("groups invalid dynamic property name recovery", () => {
    expect(
      findingFamilyFingerprint(".foo { --side: margin-top; var(--side): 20px; }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Unexpected token Semicolon",
        },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "expect token `:`, but found `(`",
        },
      ]),
    ).toBe(
      "family:invalid-dynamic-property-name|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Semicolon",
    );
  });

  test("groups invalid font-family punctuation recovery", () => {
    expect(
      findingFamilyFingerprint(".spec-example { font-family: Ahem!, sans-serif; }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Unexpected token Delim('!')",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:invalid-font-family-punctuation|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Delim('!')",
    );
  });

  test("groups page slot pseudo rejections", () => {
    expect(
      findingFamilyFingerprint("@page::slot(g) { color: red; }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Unexpected token Colon",
        },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "expect token `;`, but found `::`",
        },
      ]),
    ).toBe(
      "family:page-slot-pseudo|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unexpected token Colon",
    );
  });

  test("groups @page @slot rule rejections", () => {
    expect(
      findingFamilyFingerprint("@page { @slot a {} }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Unknown at rule: @slot",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:page-slot-rule|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unknown at rule: @slot",
    );
  });

  test("groups @page @top margin rule rejections", () => {
    expect(
      findingFamilyFingerprint("@page:left { @top { color: red; } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        {
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "Unknown at rule: @top",
        },
        { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
      ]),
    ).toBe(
      "family:page-top-margin-rule|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|lightningcss:rejected:Unknown at rule: @top",
    );
  });

  test("groups scroll-driven keyframe range rejections", () => {
    expect(
      findingFamilyFingerprint("@keyframes fade { entry 0% { opacity: 0; } }", [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "prettier-css", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "accepted", durationMs: 1 },
        {
          parser: "oxc-css-parser",
          status: "rejected",
          durationMs: 1,
          message: "expect token `:`, but found `<percentage>`",
        },
      ]),
    ).toBe(
      "family:scroll-driven-keyframe-range|lightningcss:accepted|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|oxc-css-parser:rejected:keyframe range",
    );
  });
});
