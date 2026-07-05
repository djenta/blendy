/// <reference types="vite/client" />

interface Window {
  blendyWindow?: {
    getPinned: () => Promise<boolean>;
    setPinned: (pinned: boolean) => Promise<boolean>;
    minimize: () => Promise<void>;
    close: () => Promise<void>;
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
    }) => Promise<import("./types").SendMessageResult>;
    regenerateLast: (request: {
      backendSettings?: Partial<import("./types").BackendSettings>;
      chatId?: string;
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
    openProjectBrief: (truthPath: string) => Promise<{ ok: boolean; error?: string }>;
    openDiagnosticFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
    onChatEvent: (callback: (event: import("./types").ChatEvent) => void) => () => void;
  };
}
