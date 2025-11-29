// FULL FILE — NO-ANY, ESLINT-CLEAN VERSION

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

// ----------------------
// TYPES
// ----------------------

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

// ----------------------
const isBrowser = typeof window !== "undefined";
// ----------------------

const createInitialErrors = (): ErrorState => ({
  script: null,
  session: null,
  integration: null,
  retryable: false,
});

// ----------------------
// MAIN COMPONENT
// ----------------------

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
  >(
    isBrowser && window.customElements?.get("openai-chatkit")
      ? "ready"
      : "pending"
  );
  const [widgetInstanceKey, setWidgetInstanceKey] = useState(0);

  const setErrorState = useCallback((updates: Partial<ErrorState>) => {
    setErrors((current) => ({ ...current, ...updates }));
  }, []);

  // ----------------------
  // Script load checker
  // ----------------------

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

      const detail =
        event instanceof CustomEvent &&
        typeof event.detail === "string"
          ? event.detail
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
          const evt = new CustomEvent("chatkit-script-error", {
            detail: "ChatKit script failed to load",
          });
          handleError(evt);
        }
      }, 5000);
    }

    return () => {
      window.removeEventListener("chatkit-script-loaded", handleLoaded);
      window.removeEventListener("chatkit-script-error", handleError as EventListener);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [scriptStatus, setErrorState]);

  // ----------------------
  // Workflow Setup
  // ----------------------

  const isWorkflowConfigured =
    Boolean(WORKFLOW_ID) && !WORKFLOW_ID.startsWith("wf_replace");

  useEffect(() => {
    if (!isWorkflowConfigured && isMountedRef.current) {
      setErrorState({
        session: "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local.",
        retryable: false,
      });
      setIsInitializingSession(false);
    }
  }, [isWorkflowConfigured, setErrorState]);

  // ----------------------
  // RESET CHAT
  // ----------------------

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

  // ----------------------
  // SESSION CREATION
  // ----------------------

  const getClientSecret = useCallback(
    async (currentSecret: string | null): Promise<string> => {
      if (!isWorkflowConfigured) {
        const msg = "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID.";
        setErrorState({ session: msg });
        setIsInitializingSession(false);
        throw new Error(msg);
      }

      if (isMountedRef.current) {
        if (!currentSecret) setIsInitializingSession(true);
        setErrorState({ session: null });
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
          // ignore parse failures
        }

        if (!response.ok) {
          throw new Error(
            extractErrorDetail(data, response.statusText || "Session error")
          );
        }

        const clientSecret = data.client_secret;
        if (typeof clientSecret !== "string") {
          throw new Error("Missing client_secret");
        }

        return clientSecret;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Session failed.";
        setErrorState({ session: msg });
        throw new Error(msg);
      } finally {
        if (isMountedRef.current && !currentSecret) {
          setIsInitializingSession(false);
        }
      }
    },
    [isWorkflowConfigured, setErrorState]
  );

  // ----------------------
  // CHATKIT INIT
  // ----------------------

  const chatkit = useChatKit({
    api: { getClientSecret },
    theme: {
      colorScheme: theme,
      ...getThemeConfig(theme),
      container: { backgroundColor: "#fff" },
      thread: { backgroundColor: "#fff" },
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

    // -------------------
    // TOOL HANDLERS
    // -------------------
    onClientTool: async (invocation: ClientToolInvocation) => {
      const { name, params } = invocation;

      // Theme switch
      if (name === "switch_theme") {
        const p = params as SwitchThemeParams;
        if (p.theme === "light" || p.theme === "dark") {
          onThemeRequest(p.theme);
          return { success: true };
        }
        return { success: false };
      }

      // Record fact
      if (name === "record_fact") {
        const p = params as RecordFactParams;
        const id = p.fact_id ? String(p.fact_id) : "";
        const text = p.fact_text ? String(p.fact_text) : "";

        if (id && !processedFacts.current.has(id)) {
          processedFacts.current.add(id);

          await onWidgetAction({
            type: "save",
            factId: id,
            factText: text.replace(/\s+/g, " ").trim(),
          });
        }

        return { success: true };
      }

      // Handoff to Slack
      if (name === "handoff_to_slack") {
        const p = params as HandoffParams;

        try {
          const response = await fetch(
            "https://openai-chatkit-starter-app-sub.vercel.app/api/handoff",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(p),
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
        } catch {
          return {
            success: false,
            message: "Something went wrong. Please try again.",
          };
        }
      }

      return { success: false };
    },

    onResponseEnd,
    onResponseStart: () => setErrorState({ integration: null }),
    onThreadChange: () => processedFacts.current.clear(),
    onError: ({ error }) => console.error("ChatKit error:", error),
  });

  // ----------------------
  const activeError = errors.session ?? errors.integration;
  const blockingError = errors.script ?? activeError;
  // ----------------------

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

// ----------------------
// ERROR DETAIL PARSER
// ----------------------
function extractErrorDetail(
  payload: Record<string, unknown> | undefined,
  fallback: string
): string {
  if (!payload) return fallback;

  // top-level payload.error
  const top = payload.error;
  if (typeof top === "string") return top;
  if (
    top &&
    typeof top === "object" &&
    "message" in top &&
    typeof (top as Record<string, unknown>).message === "string"
  ) {
    return (top as Record<string, unknown>).message as string;
  }

  // payload.details
  const details = payload.details;
  if (typeof details === "string") return details;

  if (details && typeof details === "object") {
    const nested = (details as Record<string, unknown>).error;

    if (typeof nested === "string") return nested;

    if (
      nested &&
      typeof nested === "object" &&
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
