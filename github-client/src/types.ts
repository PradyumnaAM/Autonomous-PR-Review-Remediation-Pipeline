export interface PRData {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  baseBranch: string;
  headBranch: string;
  headSHA: string;
}

export interface PRFile {
  filename: string;
  content: string;
  patch?: string;
  status: string;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface SecurityIssue {
  severity: Severity;
  location: string;
  description: string;
  recommendation: string;
}

export interface QualityIssue {
  severity: Severity;
  location: string;
  description: string;
  suggestion: string;
}

export interface LogicIssue {
  severity: Severity;
  location: string;
  description: string;
  fix: string;
}

export interface MissingTest {
  description: string;
  testCode: string;
  filename: string;
}

export interface SecurityFindings {
  issues: SecurityIssue[];
  overallRisk: string;
}

export interface QualityFindings {
  issues: QualityIssue[];
  qualityScore: number;
}

export interface LogicFindings {
  issues: LogicIssue[];
  confidence: number;
}

export interface TestGenFindings {
  missingTests: MissingTest[];
}

export interface FixedFile {
  filename: string;
  newContent: string;
  changesSummary: string;
}

export interface OrchestratorResult {
  verdict: 'pass' | 'comment-only' | 'fix';
  summary: string;
  reviewComment: string;
  agentFindings: {
    security: SecurityFindings;
    quality: QualityFindings;
    logic: LogicFindings;
    testGen: TestGenFindings;
  };
  fixedFiles?: FixedFile[];
}
