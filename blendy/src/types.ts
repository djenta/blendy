export type ThemeName = "solar" | "sprint";
export type PageName = "chat" | "settings";
export type KnowledgeMode = "LOCAL_AUTO_WEB" | "LOCAL_ONLY" | "ASK_BEFORE_WEB";

export interface AppSettings {
  theme: ThemeName;
  textSize: number;
}

export interface BackendSettings {
  bridgeUrl: string;
  lmStudioBaseUrl: string;
  model: string;
  responseMaxTokens: number;
  contextLimitTokens: number;
  knowledgeMode: KnowledgeMode;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "event";
  content: string;
  context?: string;
  receipt?: AssistantReceipt;
  status?: "done" | "streaming" | "failed";
  marker?: "compacted";
}

export interface AssistantReceipt {
  labels?: string[];
  cards?: Array<{
    id: string;
    title: string;
    type: string;
    score?: number;
    confidence?: number;
    sourceQuality?: string;
    destructiveRisk?: string;
    matchedChecks?: string[];
    reasons?: string[];
    betterMove?: string;
    diagnosisOrder?: string;
    plainSummary?: string;
    sources?: Array<{
      title: string;
      url: string;
      host?: string;
      sourceType?: string;
      quality?: string;
    }>;
  }>;
  web?: {
    status?: string;
    queries?: string[];
    usedQueries?: string[];
    urls?: string[];
    sources?: Array<{
      title: string;
      url: string;
      authority?: string;
      confidence?: number;
      whyUsed?: string;
      summary?: string;
      retrieved?: string;
      searchQuery?: string;
    }>;
    references?: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextSnapshot {
  project: string;
  projectBriefPath: string;
  appDataPath: string;
  units: string;
  selectedObject: string;
  mode: string;
  dimensions: string;
  scale: string;
  modifiers: Array<{ name: string; detail: string }>;
  materials: string[];
  scene: string;
  visual: string;
  brief: string;
  bridgeOk?: boolean;
  bridgeStatus?: string;
  bridgeUrl?: string;
  bridgeSource?: string;
  bridgeDiscoveryPath?: string;
  blenderVersion?: string;
  contextTokens?: number;
  baselineTokens?: number;
  conversationTokens?: number;
  latestPromptTokens?: number;
  contextLimitTokens?: number;
  contextPercent?: number;
  contextStatus?: "OK" | "WARN" | "DANGER";
  contextLine?: string;
  usedScreenshot?: boolean;
  promptPacketPath?: string;
  knowledgeMode?: KnowledgeMode | string;
  knowledgeModeLabel?: string;
  docsIndexStatus?: string;
  lastWebLookupStatus?: string;
  knowledgeConfidence?: number;
  knowledgeReliedOn?: string;
  knowledgeSourceUrls?: string[];
  selectedRoute?: string;
  routeScore?: number;
  answerRisk?: string;
  veteranCardsStatus?: string;
  selectedCards?: string[];
  knowledgeSources?: Array<{
    title: string;
    url: string;
    authority: string;
    confidence: number;
    score?: number;
    sourceQuality?: string;
  }>;
}

export interface BackendState {
  context: ContextSnapshot;
  messages: Message[];
  backendSettings: BackendSettings;
  diagnostics: {
    chatKey: string;
    chatPath: string;
    promptPacketPath?: string;
    userDataPath?: string;
    activeChatId?: string;
    chatSessions?: ChatSession[];
  };
}

export type ChatEvent =
  | { type: "assistant-delta"; id: string; delta: string }
  | { type: "assistant-done"; id: string; content: string }
  | { type: "assistant-error"; id: string; error: string };

export interface SendMessageResult {
  userMessage?: Message;
  assistantMessage: Message;
  messages?: Message[];
  context: ContextSnapshot;
  diagnostics?: {
    chatKey: string;
    chatPath: string;
    promptPacketPath?: string;
    activeChatId?: string;
    chatSessions?: ChatSession[];
  };
}

export interface ChatActionResult {
  messages: Message[];
  context: ContextSnapshot;
  diagnostics?: {
    chatKey: string;
    chatPath: string;
    promptPacketPath?: string;
    activeChatId?: string;
    chatSessions?: ChatSession[];
  };
}

export interface ChatMetadataResult {
  diagnostics?: {
    chatKey: string;
    chatPath: string;
    promptPacketPath?: string;
    activeChatId?: string;
    chatSessions?: ChatSession[];
  };
}
