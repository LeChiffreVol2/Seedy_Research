export type ResearchRelevanceCard = {
  source: string;
  title: string;
  summary?: string | null;
  paperCode?: string | null;
  discipline?: string | null;
  journalTitle?: string | null;
  tags?: string[] | null;
  authors?: string[] | null;
};

export type ResearchRelevanceResult = {
  relevant: boolean;
  score: number;
  matches: string[];
};

export function scoreResearchCardRelevance(query: string, card: ResearchRelevanceCard): ResearchRelevanceResult;

export function filterResearchCardsByRelevance<T extends ResearchRelevanceCard>(
  query: string,
  cards: T[],
  options?: { alwaysIncludeSources?: string[] },
): T[];
