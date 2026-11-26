import type {
  CreateTeamChatMessageInput,
  CreateTeamChatRoomInput,
  DiscussTeamChatRoomInput,
  PromoteTeamChatMessageInput,
  TeamChatConnectionChoice,
  TeamChatDiscussResult,
  TeamChatModelOption,
  TeamChatPostMessageResult,
  TeamChatPromoteResult,
  TeamChatRoomDetail,
  TeamChatRoomSummary,
  UpdateTeamChatRoomInput,
} from "@paperclipai/shared";
import { api } from "./client";

export const teamChatApi = {
  listConnections: (companyId: string) =>
    api.get<TeamChatConnectionChoice[]>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/connections`,
    ),
  listModels: (companyId: string, connectionId: string) =>
    api.get<TeamChatModelOption[]>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/connections/${encodeURIComponent(connectionId)}/models`,
    ),
  listRooms: (companyId: string) =>
    api.get<TeamChatRoomSummary[]>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms`,
    ),
  getRoom: (companyId: string, roomId: string) =>
    api.get<TeamChatRoomDetail>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms/${encodeURIComponent(roomId)}`,
    ),
  createRoom: (companyId: string, data: CreateTeamChatRoomInput) =>
    api.post<TeamChatRoomSummary>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms`,
      data,
    ),
  updateRoom: (companyId: string, roomId: string, data: UpdateTeamChatRoomInput) =>
    api.patch<TeamChatRoomSummary>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms/${encodeURIComponent(roomId)}`,
      data,
    ),
  archiveRoom: (companyId: string, roomId: string) =>
    api.delete<void>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms/${encodeURIComponent(roomId)}`,
    ),
  postMessage: (companyId: string, roomId: string, data: CreateTeamChatMessageInput) =>
    api.post<TeamChatPostMessageResult>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms/${encodeURIComponent(roomId)}/messages`,
      data,
    ),
  discuss: (companyId: string, roomId: string, data: DiscussTeamChatRoomInput = {}) =>
    api.post<TeamChatDiscussResult>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms/${encodeURIComponent(roomId)}/discuss`,
      data,
    ),
  promoteMessage: (
    companyId: string,
    roomId: string,
    messageId: string,
    data: PromoteTeamChatMessageInput,
  ) =>
    api.post<TeamChatPromoteResult>(
      `/companies/${encodeURIComponent(companyId)}/team-chat/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/promote`,
      data,
    ),
};
