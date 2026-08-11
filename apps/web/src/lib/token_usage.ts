import type {
  ChatMessage,
  ReasoningLevel,
  TokenUsage,
} from "@ai-chat/shared";

export type TokenDisplayState = "pending" | "available" | "unavailable";

export interface TurnTokenDisplay {
  inputTokens: number | null;
  reasoningTokens: number | null;
  answerTokens: number | null;
  thinkingUsed: boolean;
  state: TokenDisplayState;
}

type TokenDisplayMessage = Pick<
  ChatMessage,
  | "role"
  | "turnId"
  | "status"
  | "usage"
  | "reasoningLevel"
  | "reasoningContent"
>;

interface ThinkingMode {
  known: boolean;
  used: boolean;
}

const unavailableDisplay: TurnTokenDisplay = {
  inputTokens: null,
  reasoningTokens: null,
  answerTokens: null,
  thinkingUsed: false,
  state: "unavailable",
};

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The UI treats persisted usage as untrusted runtime data too. This prevents an
 * old or malformed response from being rendered as an apparently valid count.
 */
export function isValidTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const usage = value as Partial<TokenUsage>;
  if (
    !isNonNegativeSafeInteger(usage.promptTokens) ||
    !isNonNegativeSafeInteger(usage.completionTokens) ||
    !isNonNegativeSafeInteger(usage.totalTokens) ||
    usage.totalTokens !== usage.promptTokens + usage.completionTokens
  ) {
    return false;
  }

  return (
    usage.reasoningTokens === null ||
    (isNonNegativeSafeInteger(usage.reasoningTokens) &&
      usage.reasoningTokens <= usage.completionTokens)
  );
}

function thinkingMode(message: TokenDisplayMessage): ThinkingMode {
  const level: ReasoningLevel | null = message.reasoningLevel;
  if (level === "off") {
    return { known: true, used: false };
  }
  if (level === "low" || level === "high" || level === "max") {
    return { known: true, used: true };
  }

  // Older rows have no reasoning level. A present 0 is still meaningful here:
  // it proves that the upstream response included a reasoning split.
  if (
    (typeof message.reasoningContent === "string" &&
      message.reasoningContent.length > 0) ||
    (message.usage?.reasoningTokens !== null &&
      message.usage?.reasoningTokens !== undefined)
  ) {
    return { known: true, used: true };
  }
  return { known: false, used: false };
}

function displayForAssistant(message: TokenDisplayMessage): TurnTokenDisplay {
  const mode = thinkingMode(message);
  if (message.status === "streaming") {
    return {
      inputTokens: null,
      reasoningTokens: null,
      answerTokens: null,
      thinkingUsed: mode.used,
      state: "pending",
    };
  }

  if (!isValidTokenUsage(message.usage)) {
    return {
      ...unavailableDisplay,
      thinkingUsed: mode.used,
    };
  }

  const { usage } = message;
  if (!mode.known) {
    return {
      inputTokens: usage.promptTokens,
      reasoningTokens: null,
      answerTokens: null,
      thinkingUsed: false,
      state: "unavailable",
    };
  }

  if (mode.used && usage.reasoningTokens === null) {
    return {
      inputTokens: usage.promptTokens,
      reasoningTokens: null,
      answerTokens: null,
      thinkingUsed: true,
      state: "unavailable",
    };
  }

  // A non-thinking request can still receive reasoning_tokens from a broken
  // upstream contract. Do not expose the reasoning metric, but deduct it from
  // the answer so the displayed body count is never overstated.
  const reasoningTokens = usage.reasoningTokens ?? 0;
  return {
    inputTokens: usage.promptTokens,
    reasoningTokens: mode.used ? reasoningTokens : null,
    answerTokens: usage.completionTokens - reasoningTokens,
    thinkingUsed: mode.used,
    state: "available",
  };
}

function validTurnId(turnId: unknown): turnId is string {
  return typeof turnId === "string" && turnId.trim().length > 0;
}

/**
 * Builds index-aligned displays for a conversation. A user row consumes the
 * prompt count only when its turn contains exactly one user and one assistant;
 * this deliberately avoids guessing from order when history is malformed.
 */
export function createTurnTokenDisplays(
  messages: readonly TokenDisplayMessage[],
): TurnTokenDisplay[] {
  const assistantDisplays = messages.map((message) =>
    message.role === "assistant" ? displayForAssistant(message) : null,
  );
  const turnMembers = new Map<
    string,
    { userIndexes: number[]; assistantIndexes: number[] }
  >();

  messages.forEach((message, index) => {
    if (!validTurnId(message.turnId)) {
      return;
    }
    const members = turnMembers.get(message.turnId) ?? {
      userIndexes: [],
      assistantIndexes: [],
    };
    if (message.role === "user") {
      members.userIndexes.push(index);
    } else {
      members.assistantIndexes.push(index);
    }
    turnMembers.set(message.turnId, members);
  });

  return messages.map((message, index) => {
    if (message.role === "assistant") {
      return assistantDisplays[index] ?? unavailableDisplay;
    }
    if (!validTurnId(message.turnId)) {
      return unavailableDisplay;
    }

    const members = turnMembers.get(message.turnId);
    if (
      !members ||
      members.userIndexes.length !== 1 ||
      members.assistantIndexes.length !== 1
    ) {
      return unavailableDisplay;
    }

    const [assistantIndex] = members.assistantIndexes;
    return assistantIndex === undefined
      ? unavailableDisplay
      : (assistantDisplays[assistantIndex] ?? unavailableDisplay);
  });
}
