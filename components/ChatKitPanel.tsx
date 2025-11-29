"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import {
  STARTER_PROMPTS,
  PLACEHOLDER_INPUT,
  GREETING,
  CREATE_SESSION_ENDPOINT,
  WORKFLOW_ID,
  getThemeConfig,
} from "@/lib/config";
import { ErrorOverlay } from "./ErrorOverlay";
import type { ColorScheme } from "@/hooks/useColorScheme";

export type FactAction = {
  type: "save";
  factId: string;
  factText: string;
};

type ChatKitPanelProps = {
  theme: ColorScheme;
  onWidgetAction: (action: FactAction) => Promise<void>;
  onResponseEnd: () => void;
  onThemeRequest: (scheme: ColorScheme) => void;
};

type ErrorState = {
  script: string | null;
  session: string | null;
  integration: string | null;
  retryable: boolean;
};

type HandoffParams = {
  type: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
  transcript?: string;
};

type RecordFactParams = {
  fact_id?: string;
  fact_text?: string;
};

type SwitchThemeParams = {
  theme?: string;
};

type ClientToolInvocation = {
  name: string;
  params: Record<string, unknown>;
};

const isBrowser = typeof window !== "undefined";

const createInitialErrors = (): ErrorState => ({
  script: null,
  session: null,
  integration: null,
  retryable: false,
});

export function ChatKitPanel({
  theme,
  onWidgetAction,
  onResponseEnd,
  onThemeRequest,
}: ChatKitPanelProps) {
  const processedFacts = useRef(new Set<string>());
  const [errors, setErrors] = useState<ErrorState>(createInitialErrors);
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const isMountedRef = useRef(true);
  const [scriptStatus, setScriptStatus] = useState<
    "pending" | "ready" | "error"
  >(isBrowser && window.customElements?.get("openai-chatkit") ? "ready" : "pending");
  const [widgetInstanceKey, setWidgetInstanceKey] = useState(0);

  const setErrorState = useCallback((updates: Partial<ErrorState>) => {
    setErrors((current) => ({ ...current, ...updates }));
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ChatKit script load checks
  useEffect(() => {
    if (!isBrowser) return;

    let timeoutId: number | undefined;

    const handleLoaded = () => {
      if (!isMountedRef.current) return;
      setScriptStatus("ready");
      setErrorState({ script: null });
    };

    const handleError = (event: Event) => {
      if (!isMountedRef.current) return;
      console.error("Failed to load chatkit script:", event);
      const detail =
        (event as CustomEvent<unknown>).detail instanceof Error
          ? (event as CustomEvent<unknown>).detail.message
          : "unknown error";

      setScriptStatus("error");
      setErrorState({ script: `Error: ${detail}`, retryable: false });
      setIsInitializingSession(false);
    };

    window.addEventListener("chatkit-script-loaded", handleLoaded);
    window.addEventListener("chatkit-script-error", handleError as EventListener);

    if (!window.customElements?.get("openai-chatkit") && scriptStatus === "pending") {
      timeoutId = window.setTimeout(() => {
        if (!window.customElements?.get("openai-chatkit")) {
          handleError(
            new CustomEvent("chatkit-script-error", {
              detail: "ChatKit component unavailable or script failed to load.",
            })
          );
        }
      }, 5000);
    }

    return () => {
      window.removeEventListener("chatkit-script-loaded", handleLoaded);
      window.removeEventListener("chatkit-script-error", handleError as EventListener);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [scriptStatus, setErrorState]);

  const isWorkflowConfigured =
    Boolean(WORKFLOW_ID) && !WORKFLOW_ID.startsWith("wf_replace");

  useEffect(() => {
    if (!isWorkflowConfigured && isMountedRef.current) {
      setErrorState({
        session: "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.",
        retryable: false,
      });
      setIsInitializingSession(false);
    }
  }, [isWorkflowConfigured, setErrorState]);

  const handleResetChat = useCallback(() => {
    processedFacts.current.clear();
    if (isBrowser) {
      setScriptStatus(
        window.customElements?.get("openai-chatkit") ? "ready" : "pending"
      );
    }
    setErrors(createInitialErrors());
    setIsInitializingSession(true);
    setWidgetInstanceKey((prev) => prev + 1);
  }, []);

  // Create ChatKit session
  const getClientSecret = useCallback(
    async (currentSecret: string | null): Promise<string> => {
      if (!isWorkflowConfigured) {
        const msg = "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID.";
        setErrorState({ session: msg, retryable: false });
        setIsInitializingSession(false);
        throw new Error(msg);
      }

      if (isMountedRef.current) {
        if (!currentSecret) setIsInitializingSession(true);
        setErrorState({ session: null, integration: null });
      }

      try {
        const response = await fetch(CREATE_SESSION_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: { id: WORKFLOW_ID },
            chatkit_configuration: { file_upload: { enabled: true } },
          }),
        });

        const raw = await response.text();
        let data: Record<string, unknown> = {};

        try {
          data = JSON.parse(raw);
        } catch {
          // silently ignore parse errors
        }

        if (!response.ok) {
          throw new Error(
            extractErrorDetail(
              data as Record<string, unknown>,
              response.statusText || "Session error"
            )
          );
        }

        const clientSecret = data.client_secret;
        if (typeof clientSecret !== "string") {
          throw new Error("Missing client_secret in response");
        }

        return clientSecret;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to start session.";
        setErrorState({ session: msg, retryable: false });
        throw new Error(msg);
      } finally {
        if (isMountedRef.current && !currentSecret) {
          setIsInitializingSession(false);
        }
      }
    },
    [isWorkflowConfigured, setErrorState]
  );

  // Initialize chatkit
  const chatkit = useChatKit({
    api: { getClientSecret },
    theme: {
      colorScheme: theme,
      ...getThemeConfig(theme),
      container: { backgroundColor: "#FFFFFF" },
      thread: { backgroundColor: "#FFFFFF" },
    },
    startScreen: {
      greeting: GREETING,
      prompts: STARTER_PROMPTS,
    },
    composer: {
      placeholder: PLACEHOLDER_INPUT,
      attachments: { enabled: true },
    },
    threadItemActions: { feedback: false },

    // TOOL HANDLERS
    onClientTool: async (invocation: ClientToolInvocation) => {
      console.log("TOOL INVOCATION:", invocation.name, invocation.params);

      // Switch theme
      if (invocation.name === "switch_theme") {
        const params = invocation.params as SwitchThemeParams;
        if (params.theme === "light" || params.theme === "dark") {
          onThemeRequest(params.theme);
          return { success: true };
        }
        return { success: false };
      }

      // Record facts
      if (invocation.name === "record_fact") {
        const params = invocation.params as RecordFactParams;
        const id = params.fact_id ? String(params.fact_id) : "";
        const text = params.fact_text ? String(params.fact_text) : "";

        if (!id || processedFacts.current.has(id)) {
          return { success: true };
        }

        processedFacts.current.add(id);

        await onWidgetAction({
          type: "save",
          factId: id,
          factText: text.replace(/\s+/g, " ").trim(),
        });

        return { success: true };
      }

      // Unified progressive + handoff to Slack
      if (invocation.name === "handoff_to_slack") {
        const params = invocation.params as HandoffParams;

        try {
          const response = await fetch(
            "https://openai-chatkit-starter-app-sub.vercel.app/api/handoff",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(params),
            }
          );

          if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
          }

          return {
            success: true,
            message:
              "Thanks — your details have been sent to the Azence team. A human will reach out soon.",
          };
        } catch (err) {
          console.error("Slack handoff failed:", err);
          return {
            success: false,
            message:
              "Something went wrong while connecting you with a human. Please try again.",
          };
        }
      }

      return { success: false };
    },

    onResponseEnd,
    onResponseStart: () => {
      setErrorState({ integration: null, retryable: false });
    },
    onThreadChange: () => processedFacts.current.clear(),
    onError: ({ error }) => console.error("ChatKit error:", error),
  });

  const activeError = errors.session ?? errors.integration;
  const blockingError = errors.script ?? activeError;

  return (
    <div className="relative pb-8 flex h-[90vh] w-full rounded-2xl flex-col overflow-hidden bg-white shadow-sm dark:bg-slate-900">
      <ChatKit
        key={widgetInstanceKey}
        control={chatkit.control}
        className={
          blockingError || isInitializingSession
            ? "pointer-events-none opacity-0"
            : "block h-full w-full"
        }
      />

      <ErrorOverlay
        error={blockingError}
        fallbackMessage={
          blockingError || !isInitializingSession
            ? null
            : "Loading assistant session..."
        }
        onRetry={blockingError && errors.retryable ? handleResetChat : null}
        retryLabel="Restart chat"
      />
    </div>
  );
}

function extractErrorDetail(
  payload: Record<string, unknown> | undefined,
  fallback: string
): string {
  if (!payload) return fallback;

  // payload.error
  const topError = payload.error;
  if (typeof topError === "string") return topError;
  if (
    typeof topError === "object" &&
    topError !== null &&
    "message" in topError &&
    typeof (topError as Record<string, unknown>).message === "string"
  ) {
    return (topError as Record<string, unknown>).message as string;
  }

  // payload.details
  const details = payload.details;
  if (typeof details === "string") return details;

  if (typeof details === "object" && details !== null) {
    const nested = (details as Record<string, unknown>).error;

    if (typeof nested === "string") return nested;

    if (
      typeof nested === "object" &&
      nested !== null &&
      "message" in nested &&
      typeof (nested as Record<string, unknown>).message === "string"
    ) {
      return (nested as Record<string, unknown>).message as string;
    }
  }

  // payload.message
  if (typeof payload.message === "string") return payload.message;

  return fallback;
}
