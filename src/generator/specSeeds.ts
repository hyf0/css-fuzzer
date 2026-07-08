export interface SpecSeed {
  readonly source: string;
  readonly tags: readonly string[];
  readonly specRefs: readonly string[];
}

export const curatedSpecSeeds: readonly SpecSeed[] = [
  {
    source:
      "@layer reset, theme, components;\n@layer components { .card { container-type: inline-size; } }",
    tags: ["cascade", "layer", "container"],
    specRefs: ["css-cascade-5", "css-contain-3"],
  },
  {
    source: "@scope (.article) to (.article-footer) { :scope > h2 { margin-block: 1lh; } }",
    tags: ["scope", "selector", "logical-properties"],
    specRefs: ["css-cascade-6", "selectors-4"],
  },
  {
    source:
      ".tooltip { position-anchor: --target; inset-area: top; translate: anchor-size(width) 0; }",
    tags: ["anchor-positioning", "functions"],
    specRefs: ["css-anchor-position-1"],
  },
  {
    source:
      ".panel { color: oklch(from canvas l c h / 80%); background: color-mix(in oklab, Canvas 80%, Highlight); }",
    tags: ["color", "relative-color", "color-mix"],
    specRefs: ["css-color-4", "css-color-5"],
  },
  {
    source: "@container style(--theme: dark) { .chip { border-color: light-dark(black, white); } }",
    tags: ["container", "style-query", "light-dark"],
    specRefs: ["css-contain-3", "css-color-5"],
  },
  {
    source: "@starting-style { dialog[open] { opacity: 0; translate: 0 1rem; } }",
    tags: ["starting-style", "transitions"],
    specRefs: ["css-transitions-2"],
  },
  {
    source:
      "@view-transition { navigation: auto; }\n::view-transition-group(root) { animation-duration: 250ms; }",
    tags: ["view-transition", "pseudo-element"],
    specRefs: ["css-view-transitions-2", "css-pseudo-4"],
  },
  {
    source:
      "@scroll-timeline scroller { source: auto; orientation: block; }\n.item { animation-timeline: scroller; }",
    tags: ["scroll-animation", "at-rule"],
    specRefs: ["scroll-animations-1"],
  },
  {
    source:
      ".triggered { timeline-trigger: --enter view() entry 0% / exit 100%; animation-trigger: --enter play; }",
    tags: ["animation-trigger", "timeline-trigger", "scroll-animation"],
    specRefs: ["animation-triggers-1", "scroll-animations-1"],
  },
  {
    source:
      ".grid { display: grid; grid-template-columns: masonry; gap: calc(1rem + sin(30deg) * 1px); }",
    tags: ["grid", "masonry", "math-functions"],
    specRefs: ["css-grid-3", "css-values-4"],
  },
  {
    source:
      "@property --accent { syntax: '<color>'; inherits: true; initial-value: oklab(65% 0.1 0.05); }",
    tags: ["houdini", "property", "typed-custom-property"],
    specRefs: ["css-properties-values-api-1", "css-color-4"],
  },
  {
    source:
      ".toolbar { display: flex; justify-content: safe center; align-items: self-start; gap: 1rem; }",
    tags: ["box-alignment", "flex"],
    specRefs: ["css-align-3"],
  },
  {
    source:
      ".ease { transition: opacity 200ms linear(0, 0.25 25% 75%, 1); animation-timing-function: linear(0 0%, 1 100%); }",
    tags: ["easing", "linear-easing"],
    specRefs: ["css-easing-2"],
  },
  {
    source:
      "@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }\n.card { animation: fade-in 200ms ease both; }",
    tags: ["web-animations", "animation", "keyframes"],
    specRefs: ["web-animations-css-integration", "css-animations-2"],
  },
  {
    source:
      ".viewport { padding-top: env(safe-area-inset-top); text-size-adjust: calc(100% * env(preferred-text-scale)); }",
    tags: ["environment-variables", "viewport"],
    specRefs: ["css-env-1", "css-size-adjust-1"],
  },
  {
    source: ":root { image-animation: paused; }\nimg:animated-image { image-animation: running; }",
    tags: ["image-animation", "pseudo-class"],
    specRefs: ["css-image-animation-1"],
  },
  {
    source: '@namespace svg "http://www.w3.org/2000/svg";\nsvg|a { fill: currentColor; }',
    tags: ["namespace", "selector"],
    specRefs: ["css-namespaces-3", "selectors-4"],
  },
  {
    source:
      ".icon { fill: context-fill; fill-opacity: 0.8; stroke: context-stroke; stroke-width: 2px; stroke-dash-array: 4px 2px; stroke-align: center; }",
    tags: ["fill-stroke", "svg-paint", "property"],
    specRefs: ["fill-stroke-3"],
  },
  {
    source: "@page :blank { @top-center { content: none; } }",
    tags: ["paged-media", "page-selector", "margin-rule"],
    specRefs: ["css-page-4"],
  },
  {
    source: ":host(.active) ::slotted(span) { color: red; }",
    tags: ["scoping", "shadow-dom", "selector"],
    specRefs: ["css-scoping-1", "selectors-4"],
  },
  {
    source: ".chat-log { overflow-anchor: none; }",
    tags: ["scroll-anchoring", "property"],
    specRefs: ["css-scroll-anchoring-1"],
  },
  {
    source: "x-tabs::part(tab active) { color: Highlight; }",
    tags: ["shadow-parts", "pseudo-element"],
    specRefs: ["css-shadow-parts-1", "css-pseudo-4"],
  },
  {
    source:
      "@font-face { font-family: fallback; src: local(Arial); size-adjust: 92%; ascent-override: 90%; descent-override: 22%; }",
    tags: ["font-face", "size-adjust"],
    specRefs: ["css-size-adjust-1", "css-fonts-5"],
  },
  {
    source: ".style-attr-equivalent { color: #090; line-height: 1.2; }",
    tags: ["style-attribute", "declaration-list"],
    specRefs: ["css-style-attr-1"],
  },
  {
    source:
      ".article { text-wrap: pretty; white-space-collapse: preserve; text-spacing-trim: trim-start; }",
    tags: ["text", "wrapping", "spacing"],
    specRefs: ["css-text-5"],
  },
  {
    source: "abbr::attr(title) { content: attr(title); }",
    tags: ["non-element-selector", "attribute-node"],
    specRefs: ["selectors-nonelement-1"],
  },
];
