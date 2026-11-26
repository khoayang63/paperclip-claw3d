import type {
  OfficeWorkspaceFileResponse,
  OfficeWorkspaceListResponse,
  OfficeWorkspaceTreeResponse,
} from "@paperclipai/shared";
import type { AvatarSkinConfig, OfficeLayout } from "@/pages/Office3D/model/types";
import { api, ApiError } from "./client";

export interface CompanyOfficeLayoutResponse {
  companyId: string;
  layout: OfficeLayout | null;
  agentSkins: Record<string, AvatarSkinConfig>;
  updatedAt: string | null;
}

let serverPersistenceUnavailable = false;

function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

export const officeLayoutApi = {
  get: async (companyId: string): Promise<CompanyOfficeLayoutResponse | null> => {
    if (serverPersistenceUnavailable) return null;
    try {
      return await api.get<CompanyOfficeLayoutResponse>(
        `/companies/${encodeURIComponent(companyId)}/office-layout`,
      );
    } catch (err) {
      if (isMissingEndpoint(err)) {
        serverPersistenceUnavailable = true;
        return null;
      }
      throw err;
    }
  },
  save: async (
    companyId: string,
    payload: { layout: OfficeLayout; agentSkins?: Record<string, AvatarSkinConfig> },
  ): Promise<CompanyOfficeLayoutResponse | null> => {
    if (serverPersistenceUnavailable) return null;
    try {
      return await api.put<CompanyOfficeLayoutResponse>(
        `/companies/${encodeURIComponent(companyId)}/office-layout`,
        payload,
      );
    } catch (err) {
      if (isMissingEndpoint(err)) {
        serverPersistenceUnavailable = true;
        return null;
      }
      throw err;
    }
  },
  listWorkspaces: (companyId: string, options?: { agentId?: string | null }) => {
    const params = new URLSearchParams();
    if (options?.agentId) params.set("agentId", options.agentId);
    const qs = params.toString();
    return api.get<OfficeWorkspaceListResponse>(
      `/companies/${encodeURIComponent(companyId)}/office-workspaces${qs ? `?${qs}` : ""}`,
    );
  },
  getWorkspaceTree: (
    companyId: string,
    workspaceKey: string,
    options?: { path?: string; agentId?: string | null },
  ) => {
    const params = new URLSearchParams();
    if (options?.path) params.set("path", options.path);
    if (options?.agentId) params.set("agentId", options.agentId);
    const qs = params.toString();
    return api.get<OfficeWorkspaceTreeResponse>(
      `/companies/${encodeURIComponent(companyId)}/office-workspaces/${encodeURIComponent(workspaceKey)}/tree${qs ? `?${qs}` : ""}`,
    );
  },
  getWorkspaceFile: (
    companyId: string,
    workspaceKey: string,
    options: { path: string; agentId?: string | null },
  ) => {
    const params = new URLSearchParams();
    params.set("path", options.path);
    if (options.agentId) params.set("agentId", options.agentId);
    return api.get<OfficeWorkspaceFileResponse>(
      `/companies/${encodeURIComponent(companyId)}/office-workspaces/${encodeURIComponent(workspaceKey)}/file?${params.toString()}`,
    );
  },
};
