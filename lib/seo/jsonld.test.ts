import { describe, expect, test } from "vitest";
import {
  SITE_URL,
  organizationNode,
  websiteNode,
  softwareApplicationNode,
  faqPageNode,
  howToNode,
  breadcrumbNode,
  graph,
  baseGraphNodes,
} from "./jsonld";

describe("jsonld — graph()", () => {
  test("emits valid JSON with @context and an @graph array", () => {
    const json = graph(organizationNode());
    const parsed = JSON.parse(json);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(Array.isArray(parsed["@graph"])).toBe(true);
    expect(parsed["@graph"]).toHaveLength(1);
  });

  test("preserves node order and count", () => {
    const parsed = JSON.parse(graph(organizationNode(), websiteNode(), softwareApplicationNode()));
    expect(parsed["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
    ]);
  });
});

describe("jsonld — base identity graph", () => {
  test("baseGraphNodes is Organization + WebSite + SoftwareApplication", () => {
    const types = baseGraphNodes().map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
  });

  test("@id cross-references are internally consistent", () => {
    const [org, site, app] = baseGraphNodes();
    const orgId = org["@id"];
    // WebSite.publisher and SoftwareApplication.publisher both point at the Organization @id.
    expect((site.publisher as { "@id": string })["@id"]).toBe(orgId);
    expect((app.publisher as { "@id": string })["@id"]).toBe(orgId);
    // Each node's @id is rooted at SITE_URL (stable entity identity across pages).
    expect(String(org["@id"])).toContain(SITE_URL);
    expect(String(site["@id"])).toContain(SITE_URL);
    expect(String(app["@id"])).toContain(SITE_URL);
  });

  test("the three node @ids are distinct", () => {
    const ids = baseGraphNodes().map((n) => n["@id"]);
    expect(new Set(ids).size).toBe(3);
  });

  test("SoftwareApplication advertises the real free tier", () => {
    const app = softwareApplicationNode();
    expect(app.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(app.applicationCategory).toBe("MultimediaApplication");
    expect(Array.isArray(app.featureList)).toBe(true);
  });
});

describe("jsonld — HONESTY GUARD (no fabricated ratings)", () => {
  test("base graph carries no aggregateRating / review / ratingValue", () => {
    const serialized = graph(...baseGraphNodes());
    expect(serialized).not.toMatch(/aggregateRating/i);
    expect(serialized).not.toMatch(/ratingValue/i);
    expect(serialized).not.toMatch(/"review"/i);
    expect(serialized).not.toMatch(/reviewCount/i);
  });
});

describe("jsonld — FAQPage", () => {
  test("maps Q/A pairs to Question + acceptedAnswer", () => {
    const node = faqPageNode([
      { q: "Is HITE free?", a: "Yes, there is a free tier." },
      { q: "Does preview match export?", a: "Yes — one render engine." },
    ]);
    expect(node["@type"]).toBe("FAQPage");
    const main = node.mainEntity as Array<Record<string, unknown>>;
    expect(main).toHaveLength(2);
    expect(main[0]["@type"]).toBe("Question");
    expect(main[0].name).toBe("Is HITE free?");
    expect((main[0].acceptedAnswer as Record<string, unknown>)["@type"]).toBe("Answer");
    expect((main[0].acceptedAnswer as Record<string, unknown>).text).toBe("Yes, there is a free tier.");
  });

  test("an empty FAQ yields an empty mainEntity array", () => {
    const node = faqPageNode([]);
    expect(node.mainEntity).toEqual([]);
  });
});

describe("jsonld — HowTo", () => {
  test("emits ordered 1-based HowToStep positions", () => {
    const node = howToNode({
      name: "Edit a phonk video",
      description: "Make a phonk edit by typing.",
      steps: [
        { name: "Drop your clip", text: "Drag a video onto the canvas." },
        { name: "Describe the edit", text: "Type what you want." },
        { name: "Export", text: "Download the result." },
      ],
    });
    expect(node["@type"]).toBe("HowTo");
    const steps = node.step as Array<Record<string, unknown>>;
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(steps[0]["@type"]).toBe("HowToStep");
    expect(steps[1].name).toBe("Describe the edit");
  });
});

describe("jsonld — BreadcrumbList", () => {
  test("emits 1-based ListItems with absolute item URLs", () => {
    const node = breadcrumbNode([
      { name: "Compare", path: "/compare" },
      { name: "HITE vs CapCut", path: "/compare/hite-vs-capcut" },
    ]);
    expect(node["@type"]).toBe("BreadcrumbList");
    const items = node.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0]["@type"]).toBe("ListItem");
    expect(items[1].item).toBe(`${SITE_URL}/compare/hite-vs-capcut`);
  });
});
