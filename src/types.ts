export type ProblemType = "lld" | "hld";
export type Difficulty = "easy" | "medium" | "hard";

export interface Problem {
  id: string;
  title: string;
  type: ProblemType;
  difficulty: Difficulty;
  timeLimitMin: number;
  description: string;
  requirements: string[];
  expectedComponents: string[];
  tags: string[];
}

export interface DimensionScore {
  score: number;
  comment: string;
}

export interface Feedback {
  generatedAt: number;
  overallScore: number;
  dimensionScores: {
    requirementsCoverage: DimensionScore;
    componentDesign: DimensionScore;
    scalability: DimensionScore;
    communicationClarity: DimensionScore;
  };
  strengths: string[];
  missingComponents: string[];
  gaps: string[];
  improvements: { priority: "critical" | "high" | "medium"; action: string }[];
  referenceOutline: string;
  summary: string;
}

export interface FollowUp {
  id: string;
  question: string;
  answer: string;
  timestamp: number;
}

export interface Attempt {
  id: string;
  problemId: string;
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  /** Serialized Excalidraw scene (serializeAsJSON format). */
  sceneJson: string;
  /** Raw base64 PNG of the canvas at submit time (no data: prefix). */
  pngBase64?: string;
  /** The interactive response box: typed text + mic dictation, merged. */
  notes: string;
  /** Content written in Code mode (class code / SQL / pseudocode). */
  codeText: string;
  feedback?: Feedback;
  followUps?: FollowUp[];
}

export interface AttemptDraft {
  attemptId: string;
  problemId: string;
  scene: unknown;
  notes: string;
  codeText: string;
  savedAt: number;
}
