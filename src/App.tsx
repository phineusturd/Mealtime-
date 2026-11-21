import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Flame, SlidersHorizontal } from 'lucide-react';
import {
  DEFAULT_KITCHEN_GEAR,
  type CookingSchedule,
  type CookingStep,
  type KitchenGearConfig,
  type MealRecipeItem,
  type PrepMode,
  type SavedRecipe,
} from './types/schedule';
import {
  INITIAL_MEAL_RECIPES,
  INITIAL_SAVED_RECIPES,
  INITIAL_SCHEDULE,
} from './data/presets';
import { formatTime12Hour, shiftTime12Hour } from './lib/scheduleUtils';
import { postJsonWithTimeout, type ApiRequestError } from './lib/apiClient';
import { MealSetupView } from './components/MealSetupView';
import { PrepReviewView } from './components/PrepReviewView';
import { CookNowView } from './components/CookNowView';
import { FinishMealScreen } from './components/FinishMealScreen';

type AppView = 'setup' | 'prep' | 'cook';

const GEAR_STORAGE_KEY = 'mise_kitchen_gear_v1';
const SAVED_RECIPES_STORAGE_KEY = 'mise_saved_recipes_v1';

function loadStoredGear(): KitchenGearConfig {
  try {
    const raw = localStorage.getItem(GEAR_STORAGE_KEY);
    if (!raw) return DEFAULT_KITCHEN_GEAR;
    return { ...DEFAULT_KITCHEN_GEAR, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_KITCHEN_GEAR;
  }
}

function loadStoredSavedRecipes(): SavedRecipe[] {
  try {
    const raw = localStorage.getItem(SAVED_RECIPES_STORAGE_KEY);
    if (!raw) return INITIAL_SAVED_RECIPES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_SAVED_RECIPES;
  } catch {
    return INITIAL_SAVED_RECIPES;
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('setup');

  // View 1: Meal Setup state
  const [targetEatTime, setTargetEatTime] = useState<string>('7:00 PM');
  const [startTimeEnabled, setStartTimeEnabled] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<string>('5:15 PM');
  const [makeAheadToday, setMakeAheadToday] = useState<boolean>(true);
  const [recipes, setRecipes] = useState<MealRecipeItem[]>(INITIAL_MEAL_RECIPES);
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>(loadStoredSavedRecipes);
  const [gear, setGear] = useState<KitchenGearConfig>(loadStoredGear);

  // Schedule & generation state
  const [schedule, setSchedule] = useState<CookingSchedule>(INITIAL_SCHEDULE);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generateElapsedSecs, setGenerateElapsedSecs] = useState<number>(0);
  const [generateStatusText, setGenerateStatusText] = useState<string>('');
  const [generateError, setGenerateError] = useState<ApiRequestError | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  // View 2 & View 3 progress state
  const [checkedSetupIndices, setCheckedSetupIndices] = useState<Set<number>>(new Set());
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(new Set());
  const [backgroundTimers, setBackgroundTimers] = useState<Record<string, number>>({});
  const [isClockPaused, setIsClockPaused] = useState<boolean>(false);
  const [delayNotice, setDelayNotice] = useState<string | null>(null);
  const [showFinishScreen, setShowFinishScreen] = useState<boolean>(false);

  // Auto-save Kitchen Gear to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(GEAR_STORAGE_KEY, JSON.stringify(gear));
    } catch {
      // Ignore storage quota errors
    }
  }, [gear]);

  // Auto-save Saved Recipes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_RECIPES_STORAGE_KEY, JSON.stringify(savedRecipes));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedRecipes]);

  // Track elapsed seconds during schedule generation
  useEffect(() => {
    if (!isGenerating) {
      setGenerateElapsedSecs(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setGenerateElapsedSecs(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    return () => {
      generateAbortRef.current?.abort();
    };
  }, []);

  // Tick all background passive timers every second across views
  useEffect(() => {
    if (isClockPaused || Object.keys(backgroundTimers).length === 0) return;
    const interval = window.setInterval(() => {
      setBackgroundTimers((prev) => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const [id, secs] of Object.entries(prev)) {
          if (secs > 0) {
            next[id] = secs - 1;
            changed = true;
          } else {
            next[id] = 0;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isClockPaused, Object.keys(backgroundTimers).length]);

  const handleChangeTargetEatTime = (nextTime12h: string) => {
    const formatted = formatTime12Hour(nextTime12h);
    setTargetEatTime(formatted);
    setSchedule((prev) => ({ ...prev, target_eat_time: formatted }));
  };

  const handleAddRecipe = (item: MealRecipeItem) => {
    setRecipes((prev) => [...prev, item]);
    setGenerateError(null);
  };

  const handleChangeRecipePrepMode = (id: string, mode: PrepMode) => {
    setRecipes((prev) => prev.map((r) => (r.id === id ? { ...r, prepMode: mode } : r)));
  };

  const handleRemoveRecipe = (id: string) => {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
  };

  const handleRemoveSavedRecipe = (id: string) => {
    setSavedRecipes((prev) => prev.filter((r) => r.id !== id));
  };

  const handleCancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setIsGenerating(false);
  };

  const handleGenerateSchedule = async () => {
    if (recipes.length === 0) return;

    generateAbortRef.current?.abort();
    const abortController = new AbortController();
    generateAbortRef.current = abortController;

    setIsGenerating(true);
    setGenerateStatusText(
      `Scheduling ${recipes.length} ${
        recipes.length === 1 ? 'dish' : 'dishes'
      } across your kitchen gear...`
    );
    setGenerateError(null);

    try {
      const result = await postJsonWithTimeout<{ schedule?: CookingSchedule }>({
        url: '/api/schedule',
        body: {
          targetEatTime: formatTime12Hour(targetEatTime),
          startTime: startTimeEnabled ? formatTime12Hour(startTime) : undefined,
          makeAheadToday,
          recipes,
          gear,
        },
        stepLabel: 'Generating meal schedule',
        defaultNextStep:
          'Tap "Generate Meal Schedule" to retry, or shorten very long pasted recipe notes.',
        timeoutMs: 25000,
        maxColdStartRetries: 2,
        retryDelayMs: 1500,
        externalSignal: abortController.signal,
        onStatusUpdate: (status) => setGenerateStatusText(status),
      });

      if (result.cancelled) {
        return;
      }

      if (result.error) {
        setGenerateError(result.error);
        return;
      }

      const rawSchedule = result.data?.schedule;
      if (!rawSchedule || !Array.isArray(rawSchedule.steps) || rawSchedule.steps.length === 0) {
        setGenerateError({
          step: 'Generating meal schedule',
          message: 'Server returned an incomplete schedule without cooking steps.',
          nextStep: 'Tap "Generate Meal Schedule" again.',
        });
        return;
      }

      const nextSchedule: CookingSchedule = {
        ...rawSchedule,
        target_eat_time: formatTime12Hour(rawSchedule.target_eat_time || targetEatTime),
      };

      setSchedule(nextSchedule);
      setTargetEatTime(nextSchedule.target_eat_time);
      setCheckedSetupIndices(new Set());
      setCompletedStepIds(new Set());
      setBackgroundTimers({});
      setIsClockPaused(false);
      setActiveView('prep');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setGenerateError({
        step: 'Generating meal schedule',
        message: err instanceof Error ? err.message : String(err),
        nextStep: 'Tap "Generate Meal Schedule" to try again.',
      });
    } finally {
      generateAbortRef.current = null;
      setIsGenerating(false);
      setGenerateStatusText('');
    }
  };

  const handleToggleSetupIndex = (idx: number) => {
    setCheckedSetupIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleToggleDoneAhead = (stepId: string) => {
    setCompletedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleStartLiveCooking = () => {
    setIsClockPaused(false);
    setActiveView('cook');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCompleteStep = (stepId: string) => {
    setCompletedStepIds((prev) => {
      const next = new Set(prev);
      next.add(stepId);
      return next;
    });
  };

  const handleMoveToBackground = (step: CookingStep) => {
    setBackgroundTimers((prev) => ({
      ...prev,
      [step.id]: step.duration_mins * 60,
    }));
  };

  const handleCompleteBackgroundStep = (stepId: string) => {
    setBackgroundTimers((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setCompletedStepIds((prev) => {
      const next = new Set(prev);
      next.add(stepId);
      return next;
    });
  };

  const handleAdjustStepTimer = (stepId: string, deltaSeconds: number) => {
    setBackgroundTimers((prev) => {
      if (prev[stepId] === undefined) return prev;
      return {
        ...prev,
        [stepId]: Math.max(0, prev[stepId] + deltaSeconds),
      };
    });
  };

  const handleDelayFiveMins = () => {
    const shifted = shiftTime12Hour(schedule.target_eat_time, 5);
    setSchedule((prev) => ({ ...prev, target_eat_time: shifted }));
    setTargetEatTime(shifted);
    setDelayNotice(`Shifted upcoming steps +5 min — new dinner time is ${shifted}`);
    window.setTimeout(() => setDelayNotice(null), 3500);
  };

  const finishDishes = useMemo<MealRecipeItem[]>(() => {
    if (recipes.length > 0) return recipes;
    const uniqueNames = Array.from(new Set(schedule.steps.map((s) => s.recipe)));
    return uniqueNames.map((name, i) => ({
      id: `dish-${i}`,
      title: name,
      rawText: name,
      prepMode: 'parallel',
    }));
  }, [recipes, schedule.steps]);

  const handleCompleteMealReview = (keptDishes: MealRecipeItem[]) => {
    if (keptDishes.length > 0) {
      setSavedRecipes((prev) => {
        const existingTitles = new Set(prev.map((p) => p.title.toLowerCase()));
        const additions: SavedRecipe[] = keptDishes
          .filter((d) => !existingTitles.has(d.title.toLowerCase()))
          .map((d) => ({
            id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: d.title,
            rawText: d.rawText,
            sourceUrl: d.sourceUrl,
            defaultPrepMode: d.prepMode,
          }));
        return [...additions, ...prev];
      });
    }
    setShowFinishScreen(false);
    setCompletedStepIds(new Set());
    setBackgroundTimers({});
    setCheckedSetupIndices(new Set());
    setActiveView('setup');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const runningCount = Object.keys(backgroundTimers).length;

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#090D16] flex flex-col">
      {/* Compact Non-Sticky Top Brand Row */}
      <header className="px-4 sm:px-6 pt-4 pb-2 max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <span className="font-display text-lg font-extrabold tracking-tight text-slate-950 whitespace-nowrap">
          Mise &amp; Pass
        </span>
        <span className="text-sm font-semibold text-slate-600 tabular-nums whitespace-nowrap">
          Dinner · {formatTime12Hour(schedule.target_eat_time)}
        </span>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-28">
        {activeView === 'setup' && (
          <MealSetupView
            targetEatTime={targetEatTime}
            startTimeEnabled={startTimeEnabled}
            startTime={startTime}
            makeAheadToday={makeAheadToday}
            recipes={recipes}
            savedRecipes={savedRecipes}
            gear={gear}
            isGenerating={isGenerating}
            generateElapsedSecs={generateElapsedSecs}
            generateStatusText={generateStatusText}
            generateError={generateError}
            onChangeTargetEatTime={handleChangeTargetEatTime}
            onToggleStartTime={setStartTimeEnabled}
            onChangeStartTime={setStartTime}
            onToggleMakeAheadToday={setMakeAheadToday}
            onAddRecipe={handleAddRecipe}
            onChangeRecipePrepMode={handleChangeRecipePrepMode}
            onRemoveRecipe={handleRemoveRecipe}
            onRemoveSavedRecipe={handleRemoveSavedRecipe}
            onUpdateGear={setGear}
            onGenerateSchedule={handleGenerateSchedule}
            onCancelGenerate={handleCancelGenerate}
            onDismissGenerateError={() => setGenerateError(null)}
          />
        )}

        {activeView === 'prep' && (
          <PrepReviewView
            schedule={schedule}
            checkedSetupIndices={checkedSetupIndices}
            doneAheadStepIds={completedStepIds}
            onToggleSetupIndex={handleToggleSetupIndex}
            onToggleDoneAhead={handleToggleDoneAhead}
            onStartLiveCooking={handleStartLiveCooking}
          />
        )}

        {activeView === 'cook' && (
          <CookNowView
            schedule={schedule}
            completedStepIds={completedStepIds}
            backgroundTimers={backgroundTimers}
            isClockPaused={isClockPaused}
            delayNotice={delayNotice}
            onCompleteStep={handleCompleteStep}
            onMoveToBackground={handleMoveToBackground}
            onCompleteBackgroundStep={handleCompleteBackgroundStep}
            onAdjustStepTimer={handleAdjustStepTimer}
            onTogglePauseClock={() => setIsClockPaused((prev) => !prev)}
            onDelayFiveMins={handleDelayFiveMins}
            onFinishMeal={() => setShowFinishScreen(true)}
          />
        )}
      </main>

      {/* Fixed Bottom 3-Tab Navigation Bar */}
      <nav
        aria-label="Main navigation"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="max-w-5xl mx-auto grid grid-cols-3 h-16">
          {(
            [
              { id: 'setup', label: '1. Setup', icon: SlidersHorizontal },
              { id: 'prep', label: '2. Prep & Review', icon: ClipboardCheck },
              { id: 'cook', label: '3. Cook Now', icon: Flame },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveView(tab.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-[56px] transition-colors relative ${
                  active
                    ? 'text-slate-950 font-bold'
                    : 'text-slate-500 hover:text-slate-800 font-medium'
                }`}
              >
                {active && (
                  <span
                    className="absolute top-0 left-6 right-6 h-0.5 bg-slate-950 rounded-b-full"
                    aria-hidden="true"
                  />
                )}
                <div className="relative">
                  <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
                  {tab.id === 'cook' && runningCount > 0 && (
                    <span className="absolute -top-1.5 -right-3 text-[10px] font-mono font-bold text-amber-800 tabular-nums">
                      {runningCount}
                    </span>
                  )}
                </div>
                <span className="text-[11px] sm:text-xs tracking-tight whitespace-nowrap">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Post-Meal Finish & Keep/Discard Screen */}
      {showFinishScreen && (
        <FinishMealScreen
          dishes={finishDishes}
          onCompleteReview={handleCompleteMealReview}
          onCancel={() => setShowFinishScreen(false)}
        />
      )}
    </div>
  );
}
