import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const COOKING_SCHEDULE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    target_eat_time: { type: Type.STRING },
    pre_cook_setup: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    warnings_and_conflicts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          recipe: { type: Type.STRING },
          title: { type: Type.STRING },
          duration_mins: { type: Type.INTEGER },
          offset_before_eat_mins: { type: Type.INTEGER },
          kind: {
            type: Type.STRING,
            enum: ['active_prep', 'passive_cook', 'make_ahead', 'tempering', 'staging'],
          },
          equipment: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          depends_on: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          can_make_ahead: { type: Type.BOOLEAN },
        },
        required: [
          'id',
          'recipe',
          'title',
          'duration_mins',
          'offset_before_eat_mins',
          'kind',
          'equipment',
          'depends_on',
          'can_make_ahead',
        ],
      },
    },
  },
  required: ['target_eat_time', 'pre_cook_setup', 'warnings_and_conflicts', 'steps'],
};

const RECIPE_EXTRACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    suggested_prep_mode: {
      type: Type.STRING,
      enum: ['parallel', 'prep_ahead'],
    },
  },
  required: ['title', 'summary', 'suggested_prep_mode'],
};

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add a valid Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callGeminiWithRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string,
  maxRetries = 1
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const message = (error as { message?: string })?.message || '';
      if (message.includes('timed out')) {
        throw error;
      }
      if (attempt < maxRetries && (status === 429 || (status && status >= 500))) {
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function parseModelJson<T>(rawText: string, label: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error(`${label} returned an empty response.`);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    // Try extracting the outermost JSON object if extra prose surrounded it
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // fall through to explicit error
      }
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} returned unreadable JSON (${reason}).`);
  }
}

function extractCleanErrorMessage(raw: string): { code?: number; statusText?: string; message: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { code?: number; status?: string; message?: string };
        message?: string;
      };
      if (parsed.error?.message) {
        return {
          code: parsed.error.code,
          statusText: parsed.error.status,
          message: parsed.error.message,
        };
      }
      if (parsed.message) {
        return { message: parsed.message };
      }
    } catch {
      // Keep raw message if not JSON
    }
  }
  return { message: trimmed };
}

function formatGeminiError(
  error: unknown,
  defaultNextStep: string
): { status: number; message: string; nextStep: string } {
  const err = error as { status?: number; message?: string };
  const rawMsg = err?.message || 'An unexpected error occurred while talking to Gemini.';
  const cleaned = extractCleanErrorMessage(rawMsg);
  const code = err?.status ?? cleaned.code;
  const msg = cleaned.statusText
    ? `${cleaned.message} (${code ?? ''} ${cleaned.statusText})`.replace(/\(\s+/, '(')
    : cleaned.message;

  if (msg.toLowerCase().includes('timed out')) {
    return {
      status: 504,
      message: msg,
      nextStep: defaultNextStep,
    };
  }
  if (code === 403 || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message: `API key error: ${msg}`,
      nextStep: 'Open Settings > Secrets and verify your Gemini API key, then try again.',
    };
  }
  if (code === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: `Rate limit reached: ${msg}`,
      nextStep: 'Wait a few seconds and try again, or check your quota in Settings > Secrets.',
    };
  }
  if (code === 503 || rawMsg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message: msg,
      nextStep: defaultNextStep,
    };
  }
  if (rawMsg.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 500,
      message: msg,
      nextStep: 'Add your Gemini API key in Settings > Secrets and try again.',
    };
  }
  return {
    status: code && code >= 400 ? code : 500,
    message: msg,
    nextStep: defaultNextStep,
  };
}

function stripHtmlToReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 9000);
}

/**
 * Gently finds a URL inside pasted text without enforcing strict pattern validation.
 */
function findFirstHttpUrl(input: string): string | null {
  const tokens = input.trim().split(/\s+/);
  for (const token of tokens) {
    const clean = token.replace(/^[<(]+|[>),.;!?]+$/g, '');
    if (clean.toLowerCase().startsWith('http://') || clean.toLowerCase().startsWith('https://')) {
      return clean;
    }
  }
  return null;
}

async function fetchUrlSnippet(urlStr: string): Promise<{ text: string | null; note?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { text: null, note: 'Link format could not be fetched directly; reading text instead.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { text: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MiseAndPass/1.0)',
        Accept: 'text/html, text/plain',
      },
    });
    if (!response.ok) {
      return { text: null, note: `Website returned HTTP ${response.status}.` };
    }
    const html = await response.text();
    const cleaned = stripHtmlToReadableText(html);
    return { text: cleaned.length > 80 ? cleaned : null };
  } catch {
    return { text: null, note: 'Website blocked direct download or timed out.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/extract-recipe', async (req, res) => {
    try {
      const { input } = req.body ?? {};
      if (typeof input !== 'string' || !input.trim()) {
        res.status(400).json({
          error: 'No recipe text or link was provided.',
          nextStep: 'Paste a recipe link, full recipe text, or dish name and tap Add Recipe.',
        });
        return;
      }

      const trimmed = input.trim();
      const detectedUrl = findFirstHttpUrl(trimmed);
      let sourceContent = trimmed;

      if (detectedUrl) {
        const fetched = await fetchUrlSnippet(detectedUrl);
        if (fetched.text) {
          sourceContent = `Original user paste:\n${trimmed}\n\nExtracted page text from ${detectedUrl}:\n${fetched.text}`;
        } else {
          sourceContent = `Original user paste (page could not be fetched: ${
            fetched.note || 'unavailable'
          }; infer a clean dish title and brief note from the link or text): ${trimmed}`;
        }
      }

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(
        () =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: sourceContent,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: [
                'You extract clean recipe summaries for a kitchen dinner-timing app.',
                'Accept ANY pasted recipe text, ingredient list, notes, or URL without rejecting formatting.',
                'Return a concise, natural dish title (3-8 words, Title Case).',
                'Return a compact 1-2 sentence cooking summary capturing key temperatures, cook times, and techniques.',
                'Return suggested_prep_mode as "prep_ahead" if the dish is a sauce, dressing, slaw, marinade, dessert, or casserole that holds well; otherwise "parallel".',
              ].join('\n'),
              responseMimeType: 'application/json',
              responseSchema: RECIPE_EXTRACT_SCHEMA,
            },
          }),
        18000,
        'Recipe parsing'
      );

      const parsed = parseModelJson<{
        title: string;
        summary: string;
        suggested_prep_mode: 'parallel' | 'prep_ahead';
      }>(response.text ?? '', 'Recipe parsing');

      res.json({
        title: parsed.title || trimmed.slice(0, 60),
        summary: parsed.summary || '',
        suggestedPrepMode: parsed.suggested_prep_mode === 'prep_ahead' ? 'prep_ahead' : 'parallel',
        sourceUrl: detectedUrl || undefined,
      });
    } catch (error) {
      const formatted = formatGeminiError(
        error,
        'Try pasting the recipe ingredients and directions directly, or tap "Add Without Parsing" to add it as-is.'
      );
      res.status(formatted.status).json({
        error: formatted.message,
        nextStep: formatted.nextStep,
      });
    }
  });

  app.post('/api/schedule', async (req, res) => {
    try {
      const { targetEatTime, startTime, makeAheadToday, recipes, gear } = req.body ?? {};

      if (!Array.isArray(recipes) || recipes.length === 0) {
        res.status(400).json({
          error: 'At least one recipe is required to build a meal schedule.',
          nextStep: 'Add one or more dishes above, then tap Generate Meal Schedule.',
        });
        return;
      }

      const eatTime =
        typeof targetEatTime === 'string' && targetEatTime.trim()
          ? targetEatTime.trim()
          : '7:00 PM';

      const gearObj = gear && typeof gear === 'object' ? gear : {};
      const gearLines: string[] = [];

      if (gearObj.samsungFlexDuo !== false) {
        const modeNote =
          gearObj.samsungMode === 'split'
            ? 'Dual-Zone Split mode preferred (Upper & Lower independent temps)'
            : gearObj.samsungMode === 'single'
            ? 'Single Full Cavity mode'
            : 'Auto-assign Dual-Zone Split mode (two independent oven temperatures at once) OR Single Full Cavity if a large roast requires full height';
        gearLines.push(`- Samsung Flex Duo Oven (AUTO-ASSIGN): ${modeNote}`);
      }
      if (gearObj.brevillePro !== false) {
        gearLines.push(
          '- Breville Smart Oven Air Fryer Pro (AUTO-ASSIGN): Fast preheat countertop oven for roasting vegetables, air frying, baking sides, or warm holding at its own independent temperature'
        );
      }
      if (gearObj.cooktopAndInduction !== false) {
        gearLines.push(
          '- 4-Burner Cooktop + Portable Induction Burner (AUTO-ASSIGN): 5 total burners available for simultaneous boiling, searing, and sauces'
        );
      }
      if (gearObj.kitchenAidFoodProcessor !== false) {
        gearLines.push(
          '- KitchenAid Food Processor (AUTO-ASSIGN): Use to accelerate slicing, shredding, pestos, or sauces'
        );
      }
      if (gearObj.kitchenAidStandMixer !== false) {
        gearLines.push(
          '- KitchenAid Stand Mixer (AUTO-ASSIGN): Use for doughs, mashing, whipping cream, or batters'
        );
      }
      if (gearObj.outdoorGrill === true) {
        gearLines.push('- Outdoor Grill (ENABLED FOR THIS MEAL): Available for grilling');
      } else {
        gearLines.push(
          '- Outdoor Grill (EXPLICIT-ONLY — OFF): Do NOT use unless a recipe explicitly requires an outdoor grill'
        );
      }
      if (gearObj.pelletPizzaOven === true) {
        gearLines.push(
          '- Pellet Pizza Oven (ENABLED FOR THIS MEAL): Available for high-heat pizza/flatbread'
        );
      } else {
        gearLines.push(
          '- Pellet Pizza Oven (EXPLICIT-ONLY — OFF): Do NOT use unless a recipe explicitly requires a pizza oven'
        );
      }

      const recipeBlocks = await Promise.all(
        recipes.map(
          async (
            r: { title?: string; rawText?: string; sourceUrl?: string; prepMode?: string },
            idx: number
          ) => {
            const rawDetails = (r.rawText || r.title || '').trim();
            let extraUrlText = '';
            const urlCandidate = r.sourceUrl || findFirstHttpUrl(rawDetails);
            // If the user added a bare URL or short unparsed link, fetch page text cleanly here
            if (urlCandidate && rawDetails.length < 300) {
              const fetched = await fetchUrlSnippet(urlCandidate);
              if (fetched.text) {
                extraUrlText = `\nExtracted recipe page details:\n${fetched.text.slice(0, 2800)}`;
              }
            }
            return `${idx + 1}. ${r.title || 'Dish'} [${
              r.prepMode === 'prep_ahead' ? 'PREFERENCE: PREP AHEAD' : 'PREFERENCE: DO PARALLEL'
            }]\nDetails: ${rawDetails.slice(0, 3500)}${extraUrlText}`;
          }
        )
      );

      const systemInstruction = [
        'You are a practical home-kitchen cooking coordinator creating an arm’s-length countertop cooking guide.',
        'Generate a backward-scheduled cooking plan so every dish finishes hot together at target_eat_time.',
        'Strict output rules:',
        '1. target_eat_time MUST be 12-hour AM/PM format like "7:00 PM" (never 24-hour military time).',
        '2. pre_cook_setup MUST contain 2 to 3 crisp, plain-English bullets explaining exactly how to configure the user’s kitchen gear before cooking begins.',
        '3. warnings_and_conflicts MUST be an EMPTY array [] if all dishes fit comfortably across Samsung Flex Duo Split Mode, Breville Smart Oven Air Fryer Pro, and the 4-Burner Cooktop + Portable Induction Burner. ONLY add a warning if there is a TRUE unresolvable conflict after using all auto-assign gear.',
        '4. In each step.equipment array, include clear, short countertop appliance badges WITH temperatures when an oven/heat setting applies — e.g., ["Samsung Upper • 425°F"], ["Samsung Lower • 375°F"], ["Breville • 400°F"], ["Cooktop"], ["Portable Induction"], ["KitchenAid Food Processor"], ["Counter"]. Put the primary appliance first.',
        '5. Step titles must be clear, direct imperative instructions readable at arm’s length.',
        '6. offset_before_eat_mins is the INTEGER number of minutes before target_eat_time when the step starts. duration_mins is an INTEGER >= 1. Ensure offset_before_eat_mins >= duration_mins.',
        '7. Avoid overlapping active_prep or staging steps for a solo cook — interleave active_prep while passive_cook items run in ovens or on burners.',
        '8. For any recipe marked PREFERENCE: PREP AHEAD (or components like sauces, dressings, marinades, chopped veg when makeAheadToday is true), set can_make_ahead: true (and kind: "make_ahead" for early prep steps).',
        '9. Keep step IDs clean unique slugs and ensure depends_on only references earlier steps that finish before this step begins.',
      ].join('\n');

      const userPrompt = [
        `Target Dinner Time: ${eatTime}`,
        startTime
          ? `Desired Start Time: ${startTime}`
          : 'Start Time: Auto-calculate earliest needed start',
        `Make Ahead Today Enabled: ${
          makeAheadToday
            ? 'YES — highlight helpful make-ahead prep steps'
            : 'NO — keep prep streamlined for dinner window unless a recipe is marked Prep ahead'
        }`,
        '',
        'Available Kitchen Gear:',
        ...gearLines,
        '',
        'Recipes for this meal:',
        ...recipeBlocks,
      ].join('\n');

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(
        () =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: userPrompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: COOKING_SCHEDULE_RESPONSE_SCHEMA,
            },
          }),
        23000,
        'Schedule generation'
      );

      const schedule = parseModelJson<Record<string, unknown>>(
        response.text ?? '',
        'Schedule generation'
      );

      if (!Array.isArray(schedule.steps) || schedule.steps.length === 0) {
        res.status(502).json({
          error: 'The planner returned a schedule with no cooking steps.',
          nextStep: 'Tap Generate Meal Schedule again, or shorten very long pasted recipe text.',
        });
        return;
      }

      res.json({ schedule });
    } catch (error) {
      const formatted = formatGeminiError(
        error,
        'Tap Generate Meal Schedule to try again, or shorten very long pasted recipe notes.'
      );
      res.status(formatted.status).json({
        error: formatted.message,
        nextStep: formatted.nextStep,
      });
    }
  });

  // Always return JSON for any unhandled API errors (never HTML error pages)
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    res.status(500).json({
      error: message,
      nextStep: 'Please try your request again.',
    });
  });

  if (!isProduction) {
    // Serve a zero-WebSocket /@vite/client shim when HMR is disabled so Vite 8
    // never attempts a failing WebSocket connection in middlewareMode behind a proxy.
    const NO_WS_VITE_CLIENT = `
const sheetsMap = new Map();
export function updateStyle(id, content) {
  if (typeof document === 'undefined') return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const parsed = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (parsed.search ? '&' + parsed.search.slice(1) : '') + (parsed.hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`;

    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(NO_WS_VITE_CLIENT);
    });

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mise & Pass server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
