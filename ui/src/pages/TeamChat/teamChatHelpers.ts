import type { TeamChatMessage } from "@paperclipai/shared";

export const PROMOTE_CONTEXT_DEFAULT_COUNT = 8;
export const PROMOTE_CONTEXT_PICKER_MAX_COUNT = 16;
export const PROMOTE_CONTEXT_LINE_MAX_CHARS = 320;

export function isMessageTruncated(message: TeamChatMessage): boolean {
  return Boolean(message.metadata && message.metadata.truncated === true);
}

export function isWorkEventMessage(message: TeamChatMessage): boolean {
  return Boolean(message.metadata && message.metadata.origin === "work_event");
}

export function clipChatPreview(text: string, maxChars = 120): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) return singleLine;
  return `${singleLine.slice(0, maxChars - 3)}...`;
}

export function getPromotableContextMessages(
  messages: readonly TeamChatMessage[],
  targetMessage: TeamChatMessage,
  limit = PROMOTE_CONTEXT_PICKER_MAX_COUNT,
): TeamChatMessage[] {
  const targetIdx = messages.findIndex((m) => m.id === targetMessage.id);
  const prior =
    targetIdx > 0
      ? messages.slice(0, targetIdx)
      : targetIdx === 0
        ? []
        : messages.filter((m) => m.id !== targetMessage.id);

  const nonSystem = prior.filter((m) => m.authorType !== "system");
  return nonSystem.slice(-limit);
}

export function buildPromotedTaskDescription(
  messages: readonly TeamChatMessage[],
  targetMessage: TeamChatMessage,
  options: {
    roomLabel: string;
    includeContext: boolean;
    contextCount?: number;
    selectedContextMessageIds?: readonly string[];
  },
): string {
  const header = `Promoted from Team Chat (${options.roomLabel})`;
  const selectedBlock = `### Selected Message (${targetMessage.authorName})\n${targetMessage.body.trim()}`;

  if (!options.includeContext) {
    return `${header}\n\n${selectedBlock}`;
  }

  let selectedPrior: TeamChatMessage[];
  if (options.selectedContextMessageIds) {
    const allowed = new Set(options.selectedContextMessageIds);
    const candidates = getPromotableContextMessages(
      messages,
      targetMessage,
      Math.max(PROMOTE_CONTEXT_PICKER_MAX_COUNT, options.contextCount ?? PROMOTE_CONTEXT_DEFAULT_COUNT),
    );
    selectedPrior = candidates.filter((m) => allowed.has(m.id));
  } else {
    const limit = options.contextCount ?? PROMOTE_CONTEXT_DEFAULT_COUNT;
    selectedPrior = getPromotableContextMessages(messages, targetMessage, limit);
  }

  const contextLines = selectedPrior.map(
    (m) => `- **${m.authorName}**: ${clipChatPreview(m.body, PROMOTE_CONTEXT_LINE_MAX_CHARS)}`,
  );

  if (contextLines.length === 0) {
    return `${header}\n\n${selectedBlock}`;
  }

  const heading = options.selectedContextMessageIds
    ? `### Selected Discussion Context (${contextLines.length} messages)`
    : `### Recent Discussion Context (last ${contextLines.length} messages)`;

  return [
    header,
    selectedBlock,
    `${heading}\n${contextLines.join("\n")}`,
  ].join("\n\n");
}
