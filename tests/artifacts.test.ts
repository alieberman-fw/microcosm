import { describe, expect, it } from "vitest";
import {
  ARTIFACT_SYSTEM, ARTIFACT_TOOLS, MAX_ARTIFACT_HTML, MAX_ARTIFACT_NAME,
  sanitizeArtifactBody, wrapArtifactHtml,
} from "@/lib/artifacts";

describe("sanitizeArtifactBody", () => {
  it("strips script tags and their content", () => {
    const out = sanitizeArtifactBody(`<p>ok</p><script>alert(1)</script><p>after</p>`);
    expect(out).toBe("<p>ok</p><p>after</p>");
  });

  it("strips unclosed script opens and orphan closes", () => {
    expect(sanitizeArtifactBody(`<p>a</p><script src="x.js">`)).toBe("<p>a</p>");
    expect(sanitizeArtifactBody(`</script><p>b</p>`)).toBe("<p>b</p>");
  });

  it("strips inline event handlers in every quoting style", () => {
    expect(sanitizeArtifactBody(`<p onclick="x()">hi</p>`)).toBe("<p>hi</p>");
    expect(sanitizeArtifactBody(`<p onclick='x()'>hi</p>`)).toBe("<p>hi</p>");
    expect(sanitizeArtifactBody(`<p onmouseover=x()>hi</p>`)).toBe("<p>hi</p>");
  });

  it("strips embeds, forms, styles, and meta-ish tags", () => {
    const out = sanitizeArtifactBody(`<iframe src="x"></iframe><object></object><form></form><style>p{}</style><link rel="x"><meta charset="y"><p>kept</p>`);
    expect(out).toContain("<p>kept</p>");
    for (const tag of ["<iframe", "<object", "<form", "<style", "<link", "<meta"]) expect(out).not.toContain(tag);
  });

  it("strips javascript: urls but keeps normal links", () => {
    expect(sanitizeArtifactBody(`<a href="javascript:alert(1)">x</a>`)).toBe("<a >x</a>");
    expect(sanitizeArtifactBody(`<a href="https://example.com">x</a>`)).toBe(`<a href="https://example.com">x</a>`);
  });

  it("keeps the class vocabulary intact", () => {
    const body = `<h1>T</h1><div class="stats"><div class="stat"><div class="label">A</div><div class="value">3</div></div></div><span class="cite">18</span><div class="bar"><span style="width:62%"></span></div>`;
    expect(sanitizeArtifactBody(body)).toBe(body);
  });
});

describe("wrapArtifactHtml", () => {
  const html = wrapArtifactHtml({
    title: `Memo <&> "IC"`,
    simName: "Truck stop pivot",
    bodyHtml: `<h1>The memo</h1><p>Body text with <span class="cite">18</span>.</p><script>bad()</script>`,
    generatedAt: "2026-08-07",
  });

  it("escapes the title and stamps the kicker + footer", () => {
    expect(html).toContain("<title>Memo &lt;&amp;&gt; \"IC\"</title>");
    expect(html).toContain("TRUCK STOP PIVOT");
    expect(html).toContain("2026-08-07");
    expect(html).toContain("SYNTHETIC &amp; DIRECTIONAL");
  });

  it("carries the body but never a script", () => {
    expect(html).toContain("<h1>The memo</h1>");
    expect(html).toContain(`<span class="cite">18</span>`);
    expect(html).not.toContain("bad()");
  });

  it("ships both palettes: light base + dark prefers-color-scheme", () => {
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("--bg:#f6f6f4");
    expect(html).toContain("--bg:#0a0b0c");
  });

  it("is a complete standalone document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("Space Grotesk");
    expect(html).toContain("JetBrains Mono");
  });
});

describe("ARTIFACT_TOOLS", () => {
  it("defines exactly create/update/delete", () => {
    expect(ARTIFACT_TOOLS.map((t) => t.name)).toEqual(["create_artifact", "update_artifact", "delete_artifact"]);
  });

  it("create requires name+title+body_html; update/delete require artifact_id", () => {
    const req = (n: string) => (ARTIFACT_TOOLS.find((t) => t.name === n)?.input_schema as { required: string[] }).required;
    expect(req("create_artifact")).toEqual(["name", "title", "body_html"]);
    expect(req("update_artifact")).toEqual(["artifact_id"]);
    expect(req("delete_artifact")).toEqual(["artifact_id"]);
  });
});

describe("ARTIFACT_SYSTEM", () => {
  it("teaches the class vocabulary and the no-paste rule", () => {
    for (const cls of ["kicker", "verdict", "stats", "cite", "bar"]) expect(ARTIFACT_SYSTEM).toContain(cls);
    expect(ARTIFACT_SYSTEM).toContain("NEVER paste the document content");
  });

  it("caps are sane", () => {
    expect(MAX_ARTIFACT_HTML).toBeGreaterThan(100_000);
    expect(MAX_ARTIFACT_NAME).toBe(80);
  });
});
