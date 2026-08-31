import { expect, test } from "@playwright/test";

import { citationMapOpenAlex, discoverOpenAlex } from "../../lib/openalex";

type StubWork = {
  id: string;
  doi?: string;
  display_name: string;
  publication_year: number;
  cited_by_count: number;
  primary_topic?: { display_name: string };
  authorships?: Array<{ author?: { display_name?: string }; institutions?: Array<{ display_name?: string }> }>;
  referenced_works?: string[];
  related_works?: string[];
};

function response(results: StubWork[]) {
  return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function installOpenAlexStub(searchResults: StubWork[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const filter = url.searchParams.get("filter") ?? "";
    if (filter.startsWith("cites:")) {
      return response([{
        id: "https://openalex.org/W-INCOMING",
        display_name: "A later study citing the Thai seed",
        publication_year: 2026,
        cited_by_count: 3,
        primary_topic: { display_name: "Road safety" },
        authorships: [{ author: { display_name: "Later Author" }, institutions: [{ display_name: "Later Lab" }] }],
      }]);
    }
    if (filter.startsWith("openalex:")) {
      return response([{
        id: "https://openalex.org/W-REFERENCE",
        display_name: "A reference used by the Thai seed",
        publication_year: 2020,
        cited_by_count: 12,
        primary_topic: { display_name: "Road safety" },
        authorships: [{ author: { display_name: "Reference Author" }, institutions: [{ display_name: "Reference Lab" }] }],
      }]);
    }
    return response(searchResults);
  };
  return () => { globalThis.fetch = originalFetch; };
}

test.describe("OpenAlex Thai-to-global connection contract", () => {
  test.beforeEach(() => {
    process.env.FEDERATED_DISCOVERY_ENABLED = "true";
    process.env.OPENALEX_API_KEY = "test-openalex-key";
    process.env.OPENALEX_ALLOW_ANONYMOUS = "false";
  });

  test("uses the bounded anonymous OpenAlex bridge only when explicitly enabled", async () => {
    delete process.env.OPENALEX_API_KEY;
    process.env.OPENALEX_ALLOW_ANONYMOUS = "true";
    const restore = installOpenAlexStub([{
      id: "https://openalex.org/W7197017660",
      doi: "https://doi.org/10.70730/jfow3489",
      display_name: "A Critical Analysis of Research on the Use of Artificial Intelligence in English Language Teaching in Thailand: Conflicting Results and Methodological Limitations",
      publication_year: 2026,
      cited_by_count: 0,
      referenced_works: [],
      related_works: [],
    }]);
    try {
      const map = await citationMapOpenAlex({
        doi: "10.70730/JFOW3489",
        title: "A Critical Analysis of Research on the Use of Artificial Intelligence in English Language Teaching in Thailand: Conflicting Results and Methodological Limitations",
        year: 2026,
      });
      expect(map.status).toBe("connected");
      expect(map.match).toMatchObject({
        status: "verified",
        basis: "doi",
        requiresHumanReview: false,
        matchedOpenAlexId: "https://openalex.org/W7197017660",
      });
    } finally {
      restore();
    }
  });

  test("returns bounded metadata-only discovery through the explicit anonymous bridge", async () => {
    delete process.env.OPENALEX_API_KEY;
    process.env.OPENALEX_ALLOW_ANONYMOUS = "true";
    const restore = installOpenAlexStub([{
      id: "https://openalex.org/W2997300544",
      display_name: "Preparing teachers for the application of AI-powered technologies in foreign language education",
      publication_year: 2020,
      cited_by_count: 54,
      primary_topic: { display_name: "AI in language education" },
    }]);
    try {
      const result = await discoverOpenAlex("longitudinal mixed-methods Thai ELT", { maxResults: 1 });
      expect(result.status).toBe("connected");
      expect(result.works).toEqual([expect.objectContaining({
        id: "https://openalex.org/W2997300544",
        title: "Preparing teachers for the application of AI-powered technologies in foreign language education",
        citable: false,
      })]);
    } finally {
      restore();
    }
  });

  test("treats an exact DOI as verified and returns bounded metadata-only relations", async () => {
    const restore = installOpenAlexStub([{
      id: "https://openalex.org/W-SEED",
      doi: "https://doi.org/10.1000/thai-road",
      display_name: "Factors associated with severe road crashes in Thailand",
      publication_year: 2024,
      cited_by_count: 18,
      primary_topic: { display_name: "Road safety" },
      authorships: [{ author: { display_name: "Thai Author" }, institutions: [{ display_name: "Thai University" }] }],
      referenced_works: ["https://openalex.org/W-REFERENCE"],
      related_works: [],
    }]);
    try {
      const map = await citationMapOpenAlex({
        doi: "10.1000/thai-road",
        title: "Factors associated with severe road crashes in Thailand",
        year: 2024,
      });
      expect(map.match).toMatchObject({ status: "verified", basis: "doi", requiresHumanReview: false });
      expect(map.seed).toMatchObject({ id: "https://openalex.org/W-SEED", citable: false, topic: "Road safety" });
      expect(map.seed?.authors).toEqual(["Thai Author"]);
      expect(map.seed?.institutions).toEqual(["Thai University"]);
      expect(map.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ relation: "cites", citable: false }),
        expect.objectContaining({ relation: "cited_by", citable: false }),
      ]));
    } finally {
      restore();
    }
  });

  test("keeps a DOI-verified seed when optional relation enrichment is transiently unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const filter = url.searchParams.get("filter") ?? "";
      if (filter.startsWith("cites:") || filter.startsWith("openalex:")) {
        throw new TypeError("transient relation timeout");
      }
      return response([{
        id: "https://openalex.org/W-SEED",
        doi: "https://doi.org/10.1000/thai-road",
        display_name: "Factors associated with severe road crashes in Thailand",
        publication_year: 2024,
        cited_by_count: 18,
        referenced_works: ["https://openalex.org/W-REFERENCE"],
        related_works: [],
      }]);
    };
    try {
      const map = await citationMapOpenAlex({
        doi: "10.1000/thai-road",
        title: "Factors associated with severe road crashes in Thailand",
        year: 2024,
      });
      expect(map.status).toBe("connected");
      expect(map.relationsStatus).toBe("unavailable");
      expect(map.match).toMatchObject({ status: "verified", basis: "doi", requiresHumanReview: false });
      expect(map.seed?.id).toBe("https://openalex.org/W-SEED");
      expect(map.nodes).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps an exact title/year match as a human-reviewed candidate when no durable ID agrees", async () => {
    const restore = installOpenAlexStub([
      {
        id: "https://openalex.org/W-WEAK",
        display_name: "Road crashes and unrelated factors",
        publication_year: 2018,
        cited_by_count: 99,
      },
      {
        id: "https://openalex.org/W-EXACT",
        display_name: "Factors Associated with Severe Road Crashes in Thailand",
        publication_year: 2024,
        cited_by_count: 18,
        referenced_works: [],
        related_works: [],
      },
    ]);
    try {
      const map = await citationMapOpenAlex({
        title: "Factors associated with severe road crashes in Thailand",
        year: 2024,
      });
      expect(map.match).toMatchObject({ status: "candidate", basis: "title_year", requiresHumanReview: true, yearDelta: 0 });
      expect(map.seed?.id).toBe("https://openalex.org/W-EXACT");
      expect(map.nodes).toEqual([]);
    } finally {
      restore();
    }
  });

  test("returns a fuzzy title only as a candidate and does not trace its relationships", async () => {
    const restore = installOpenAlexStub([{
      id: "https://openalex.org/W-CANDIDATE",
      display_name: "Severe road crash factors across Thai provinces",
      publication_year: 2021,
      cited_by_count: 4,
      referenced_works: ["https://openalex.org/W-REFERENCE"],
      related_works: ["https://openalex.org/W-RELATED"],
    }]);
    try {
      const map = await citationMapOpenAlex({
        title: "Factors associated with severe road crashes in Thailand",
        year: 2024,
      });
      expect(map.match).toMatchObject({ status: "candidate", basis: "title", requiresHumanReview: true });
      expect(map.seed?.id).toBe("https://openalex.org/W-CANDIDATE");
      expect(map.nodes).toEqual([]);
    } finally {
      restore();
    }
  });

  test("fails closed when two fuzzy candidates are too similar to disambiguate", async () => {
    const restore = installOpenAlexStub([
      {
        id: "https://openalex.org/W-A",
        display_name: "Severe road crash factors in Thailand",
        publication_year: 2023,
        cited_by_count: 4,
      },
      {
        id: "https://openalex.org/W-B",
        display_name: "Thailand severe road crash factors",
        publication_year: 2023,
        cited_by_count: 5,
      },
    ]);
    try {
      const map = await citationMapOpenAlex({
        title: "Factors associated with severe road crashes in Thailand",
        year: 2024,
      });
      expect(map.match).toMatchObject({ status: "unmatched", basis: "none", requiresHumanReview: true });
      expect(map.seed).toBeNull();
      expect(map.nodes).toEqual([]);
    } finally {
      restore();
    }
  });
});
