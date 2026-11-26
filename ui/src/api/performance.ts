import type {
  CompanyPerformanceReport,
  IssueQualityReview,
  PerformanceWindow,
  UpsertIssueQualityReviewInput,
} from "@paperclipai/shared";
import { api } from "./client";

export const performanceApi = {
  getCompanyPerformance: (companyId: string, window: PerformanceWindow = "30d") =>
    api.get<CompanyPerformanceReport>(
      `/companies/${encodeURIComponent(companyId)}/performance?window=${encodeURIComponent(window)}`,
    ),
  getIssueQualityReview: (issueId: string) =>
    api.get<{ review: IssueQualityReview | null }>(
      `/issues/${encodeURIComponent(issueId)}/quality-review`,
    ),
  upsertIssueQualityReview: (issueId: string, payload: UpsertIssueQualityReviewInput) =>
    api.put<{ review: IssueQualityReview; reopened: boolean }>(
      `/issues/${encodeURIComponent(issueId)}/quality-review`,
      payload,
    ),
};
