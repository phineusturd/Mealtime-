import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
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

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if (attempt < maxRetries && (status === 429 || (status && status >= 500))) {
        await new Promise((resolve) => setTimeout(resolve, 600 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function formatGeminiError(error: unknown): { status: number; message: string } {
  const err = error as { status?: number; message?: string };
  const msg = err?.message || 'An unexpected error occurred while talking to Gemini.';
  if (err?.status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message: 'The Gemini API key was rejected. Please check Settings > Secrets.',
    };
  }
  if (err?.status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Rate limit or quota reached for the Gemini API. Please try again shortly.',
    };
  }
  if (msg.includes('GEMINI_API_KEY is not configured')) {
    return { status: 500, message: msg };
  }
  return { status: err?.status && err.status >= 400 ? err.status : 500, message: msg };
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
    .slice(0, 10000);
}

async function fetchUrlSnippet(urlStr: string): Promise<string | null> {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MiseAndPass/1.0)',
          Accept: 'text/html, text/plain',
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      return stripHtmlToReadableText(html);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
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
      if (!input || typeof input !== 'string' || !input.trim()) {
        res.status(400).json({ error: 'Paste a recipe link, full recipe text, or dish name.' });
        return;
      }

      const trimmed = input.trim();
      const isUrl = /^https?:\/\/\S+$/i.test(trimmed);
      let sourceContent = trimmed;

      if (isUrl) {
        const fetched = await fetchUrlSnippet(trimmed);
        if (fetched && fetched.length > 120) {
          sourceContent = `URL: ${trimmed}\n\nExtracted page text:\n${fetched}`;
        } else {
          sourceContent = `Recipe URL (page content unavailable, infer dish from URL slug cleanly): ${trimmed}`;
        }
      }

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: sourceContent,
          config: {
            systemInstruction: [
              'You extract clean recipe summaries for a kitchen dinner-timing app.',
              'Return a concise, natural dish title (3-7 words, Title Case, no fluff).',
              'Return a compact 1-2 sentence cooking summary capturing key temperatures, cook times, and techniques.',
              'Return suggested_prep_mode as "prep_ahead" if the dish is a sauce, dressing, slaw, marinade, dessert, or casserole that holds well; otherwise "parallel".',
            ].join('\n'),
            responseMimeType: 'application/json',
            responseSchema: RECIPE_EXTRACT_SCHEMA,
          },
        })
      );

      const raw = (response.text ?? '').trim();
      if (!raw) {
        res.status(502).json({ error: 'Could not read recipe details. Try pasting the text directly.' });
        return;
      }

      const parsed = JSON.parse(raw);
      res.json({
        title: parsed.title,
        summary: parsed.summary,
        suggestedPrepMode: parsed.suggested_prep_mode,
        sourceUrl: isUrl ? trimmed : undefined,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/schedule', async (req, res) => {
    try {
      const { targetEatTime, startTime, makeAheadToday, recipes, gear } = req.body ?? {};

      if (!Array.isArray(recipes) || recipes.length === 0) {
        res.status(400).json({ error: 'Add at least one recipe before generating a meal schedule.' });
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
        gearLines.push('- Pellet Pizza Oven (ENABLED FOR THIS MEAL): Available for high-heat pizza/flatbread');
      } else {
        gearLines.push(
          '- Pellet Pizza Oven (EXPLICIT-ONLY — OFF): Do NOT use unless a recipe explicitly requires a pizza oven'
        );
      }

      const recipeBlocks = recipes.map(
        (
          r: { title?: string; rawText?: string; prepMode?: string },
          idx: number
        ) =>
          `${idx + 1}. ${r.title || 'Dish'} [${
            r.prepMode === 'prep_ahead' ? 'PREFERENCE: PREP AHEAD' : 'PREFERENCE: DO PARALLEL'
          }]\nDetails: ${r.rawText || r.title || ''}`
      );

      const systemInstruction = [
        'You are a practical home-kitchen cooking coordinator creating an arm’s-length countertop cooking guide.',
        'Generate a backward-scheduled cooking plan so every dish finishes hot together at target_eat_time.',
        'Strict output rules:',
        '1. target_eat_time MUST be 12-hour AM/PM format like "7:00 PM" (never 24-hour military time).',
        '2. pre_cook_setup MUST contain 2 to 3 crisp, plain-English bullets explaining exactly how to configure the user’s kitchen gear before cooking begins (e.g., "Insert Samsung Flex Duo divider; set Upper to 425°F, Lower to 375°F", "Use Breville at 400°F for broccolini so the main oven stays free").',
        '3. warnings_and_conflicts MUST be an EMPTY array [] if all dishes fit comfortably across Samsung Flex Duo Split Mode, Breville Smart Oven Air Fryer Pro, and the 4-Burner Cooktop + Portable Induction Burner. ONLY add a warning if there is a TRUE unresolvable conflict after using all auto-assign gear.',
        '4. In each step.equipment array, include clear, short countertop appliance badges WITH temperatures when an oven/heat setting applies — e.g., ["Samsung Upper • 425°F"], ["Samsung Lower • 375°F"], ["Breville • 400°F"], ["Cooktop"], ["Portable Induction"], ["KitchenAid Food Processor"], ["Counter"]. Put the primary appliance first.',
        '5. Step titles must be clear, direct imperative instructions readable at arm’s length (e.g., "Roast chicken in Samsung Upper until 160°F", "Toss broccolini with oil & roast in Breville").',
        '6. offset_before_eat_mins is the INTEGER number of minutes before target_eat_time when the step starts. duration_mins is an INTEGER >= 1. Ensure offset_before_eat_mins >= duration_mins.',
        '7. Avoid overlapping active_prep or staging steps for a solo cook — interleave active_prep while passive_cook items run in ovens or on burners.',
        '8. For any recipe marked PREFERENCE: PREP AHEAD (or components like sauces, dressings, marinades, chopped veg, parboiled potatoes when makeAheadToday is true), set can_make_ahead: true (and kind: "make_ahead" for early prep steps) so the user can check them off early in Prep & Review.',
        '9. Keep step IDs clean unique slugs and ensure depends_on only references earlier steps that finish before this step begins.',
      ].join('\n');

      const userPrompt = [
        `Target Dinner Time: ${eatTime}`,
        startTime ? `Desired Start Time: ${startTime}` : 'Start Time: Auto-calculate earliest needed start',
        `Make Ahead Today Enabled: ${makeAheadToday ? 'YES — highlight helpful make-ahead prep steps' : 'NO — keep prep streamlined for dinner window unless a recipe is marked Prep ahead'}`,
        '',
        'Available Kitchen Gear:',
        ...gearLines,
        '',
        'Recipes for this meal:',
        ...recipeBlocks,
      ].join('\n');

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: COOKING_SCHEDULE_RESPONSE_SCHEMA,
          },
        })
      );

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'The planner returned an empty response. Please try again.' });
        return;
      }

      const schedule = JSON.parse(rawText);
      res.json({ schedule });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
