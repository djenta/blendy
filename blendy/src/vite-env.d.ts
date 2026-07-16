/// <reference types="vite/client" />

interface Window {
  blendyWindow?: {
    getPinned: () => Promise<boolean>;
    setPinned: (pinned: boolean) => Promise<boolean>;
    minimize: () => Promise<void>;
    close: () => Promise<void>;
    confirmClose: () => Promise<void>;
    cancelClose: () => Promise<void>;
    onCloseRequested: (callback: () => void) => () => void;
  };
  blendyApp?: {
    getState: () => Promise<import("./types").BackendState>;
    refreshContext: (request?: {
      prompt?: string;
      forceScreenshot?: boolean;
      chatId?: string;
    }) => Promise<import("./types").ContextSnapshot>;
    sendMessage: (request: {
      prompt: string;
      backendSettings?: Partial<import("./types").BackendSettings>;
      chatId?: string;
      referenceImages?: import("./types").ReferenceImagePayload[];
    }) => Promise<import("./types").SendMessageResult>;
    getModelStatus?: () => Promise<import("./types").ModelStatus>;
    cancelMessage?: (request: { messageId: string }) => Promise<{ ok?: boolean; messageId?: string }>;
    saveChatNotebook?: (request: {
      chatId: string;
      text: string;
    }) => Promise<import("./types").ProjectNotebook | { projectNotebook?: import("./types").ProjectNotebook }>;
    acknowledgeChatScene?: (request: { chatId: string }) => Promise<import("./types").ProjectNotebook | { projectNotebook?: import("./types").ProjectNotebook }>;
    regenerateLast: (request: {
      backendSettings?: Partial<import("./types").BackendSettings>;
      chatId?: string;
      referenceImages?: import("./types").ReferenceImagePayload[];
    }) => Promise<import("./types").SendMessageResult>;
    compactChat: (request: {
      backendSettings?: Partial<import("./types").BackendSettings>;
      chatId?: string;
    }) => Promise<import("./types").ChatActionResult>;
    freshChat: (request: {
      backendSettings?: Partial<import("./types").BackendSettings>;
    }) => Promise<import("./types").ChatActionResult>;
    switchChat: (request: {
      chatId: string;
      backendSettings?: Partial<import("./types").BackendSettings>;
    }) => Promise<import("./types").ChatActionResult>;
    renameChat: (request: {
      chatId: string;
      title: string;
    }) => Promise<import("./types").ChatMetadataResult>;
    deleteChat: (request: {
      chatId: string;
      backendSettings?: Partial<import("./types").BackendSettings>;
    }) => Promise<import("./types").ChatActionResult>;
    saveBackendSettings: (
      settings: Partial<import("./types").BackendSettings>,
    ) => Promise<import("./types").BackendSettings>;
    openDiagnosticFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
    onChatEvent: (callback: (event: import("./types").ChatEvent) => void) => () => void;
  };
}
