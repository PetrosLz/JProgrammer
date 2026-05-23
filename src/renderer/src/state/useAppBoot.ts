import { useEffect, useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import { getErrorMessage } from "../utils/errors";
import { setupCompletedKey } from "./setupConstants";

export type AppState = "loading" | "setup" | "ready";

export function useAppBoot({
  refreshSummary,
  setErrors
}: {
  refreshSummary: () => Promise<void>;
  setErrors: (errors: string[]) => void;
}) {
  const [appState, setAppState] = useState<AppState>("loading");

  useEffect(() => {
    let isMounted = true;

    async function detectFirstRun() {
      try {
        const setupCompleted = await databaseApi.getSetting(setupCompletedKey);

        if (!isMounted) {
          return;
        }

        if (setupCompleted) {
          await refreshSummary();
          setAppState("ready");
        } else {
          setAppState("setup");
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrors([getErrorMessage(error)]);
        setAppState("setup");
      }
    }

    void detectFirstRun();

    return () => {
      isMounted = false;
    };
  }, [refreshSummary, setErrors]);

  return {
    appState,
    setAppState
  };
}
