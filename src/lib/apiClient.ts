export interface ApiRequestError {
  step: string;
  message: string;
  nextStep: string;
  timedOut?: boolean;
}

export interface PostJsonOptions {
  url: string;
  body: unknown;
  stepLabel: string;
  defaultNextStep: string;
  timeoutMs?: number;
  maxColdStartRetries?: number;
  retryDelayMs?: number;
  externalSignal?: AbortSignal;
  onStatusUpdate?: (status: string) => void;
}

/**
 * Safely parses JSON from raw response text without letting Safari/WebKit throw
 * opaque "The string did not match the expected pattern" errors.
 */
function safeParseJson(
  rawText: string
): { ok: true; value: unknown } | { ok: false; reason: string; isColdStartHtml: boolean } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: 'Server returned an empty response.',
      isColdStartHtml: true,
    };
  }

  const lower = trimmed.toLowerCase();
  const looksLikeHtmlOrStartup =
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html') ||
    lower.includes('<head>') ||
    lower.includes('<body') ||
    lower.includes('starting server');

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (err) {
    const snippet = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: snippet
        ? `Server returned non-JSON response: "${snippet}"`
        : `Invalid JSON response (${errMsg})`,
      isColdStartHtml: looksLikeHtmlOrStartup,
    };
  }
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function postJsonWithTimeout<T>({
  url,
  body,
  stepLabel,
  defaultNextStep,
  timeoutMs = 25000,
  maxColdStartRetries = 2,
  retryDelayMs = 1500,
  externalSignal,
  onStatusUpdate,
}: PostJsonOptions): Promise<{ data?: T; error?: ApiRequestError; cancelled?: boolean }> {
  const controller = new AbortController();
  let didTimeout = false;
  let didCancel = false;

  const onExternalAbort = () => {
    didCancel = true;
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      return { cancelled: true };
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    for (let attempt = 0; attempt <= maxColdStartRetries; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsed = safeParseJson(rawText);

      // If the server returned HTML, "Starting Server...", or an empty/non-JSON cold-start page,
      // automatically retry up to maxColdStartRetries times with retryDelayMs delay.
      if (!parsed.ok && parsed.isColdStartHtml && attempt < maxColdStartRetries) {
        const nextRetry = attempt + 1;
        onStatusUpdate?.(
          `Server is waking up — retrying automatically (${nextRetry}/${maxColdStartRetries})...`
        );
        await waitWithAbort(retryDelayMs, controller.signal);
        continue;
      }

      if (!response.ok) {
        let serverMessage = `Request failed with HTTP ${response.status}.`;
        let serverNextStep = defaultNextStep;

        if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
          const obj = parsed.value as Record<string, unknown>;
          if (typeof obj.error === 'string' && obj.error.trim()) {
            serverMessage = obj.error.trim();
          }
          if (typeof obj.nextStep === 'string' && obj.nextStep.trim()) {
            serverNextStep = obj.nextStep.trim();
          }
        } else if (!parsed.ok) {
          serverMessage = `HTTP ${response.status}: ${parsed.reason}`;
        }

        return {
          error: {
            step: stepLabel,
            message: serverMessage,
            nextStep: serverNextStep,
          },
        };
      }

      if (!parsed.ok) {
        return {
          error: {
            step: stepLabel,
            message: parsed.reason,
            nextStep: defaultNextStep,
          },
        };
      }

      return { data: parsed.value as T };
    }

    return {
      error: {
        step: stepLabel,
        message: 'Server did not return valid JSON after retrying.',
        nextStep: defaultNextStep,
      },
    };
  } catch (err) {
    if (didCancel) {
      return { cancelled: true };
    }
    if (didTimeout || (err instanceof DOMException && err.name === 'AbortError')) {
      return {
        error: {
          step: stepLabel,
          message: `Timed out after ${Math.round(timeoutMs / 1000)} seconds while waiting for a response.`,
          nextStep: defaultNextStep,
          timedOut: true,
        },
      };
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    return {
      error: {
        step: stepLabel,
        message: rawMsg || 'Network error while contacting the kitchen planner server.',
        nextStep: defaultNextStep,
      },
    };
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
