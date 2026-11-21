import React, { useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Minus,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  KitchenGearConfig,
  MealRecipeItem,
  PrepMode,
  SamsungOvenMode,
  SavedRecipe,
} from '../types/schedule';
import {
  formatTime12Hour,
  shiftTime12Hour,
  toHtmlTimeValue,
} from '../lib/scheduleUtils';

interface MealSetupViewProps {
  targetEatTime: string;
  startTimeEnabled: boolean;
  startTime: string;
  makeAheadToday: boolean;
  recipes: MealRecipeItem[];
  savedRecipes: SavedRecipe[];
  gear: KitchenGearConfig;
  isGenerating: boolean;
  generateError: string | null;
  onChangeTargetEatTime: (next: string) => void;
  onToggleStartTime: (enabled: boolean) => void;
  onChangeStartTime: (next: string) => void;
  onToggleMakeAheadToday: (enabled: boolean) => void;
  onAddRecipe: (recipe: MealRecipeItem) => void;
  onChangeRecipePrepMode: (id: string, mode: PrepMode) => void;
  onRemoveRecipe: (id: string) => void;
  onRemoveSavedRecipe: (id: string) => void;
  onUpdateGear: (next: KitchenGearConfig) => void;
  onGenerateSchedule: () => void;
}

const QUICK_DINNER_TIMES = ['5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM'];

export const MealSetupView: React.FC<MealSetupViewProps> = ({
  targetEatTime,
  startTimeEnabled,
  startTime,
  makeAheadToday,
  recipes,
  savedRecipes,
  gear,
  isGenerating,
  generateError,
  onChangeTargetEatTime,
  onToggleStartTime,
  onChangeStartTime,
  onToggleMakeAheadToday,
  onAddRecipe,
  onChangeRecipePrepMode,
  onRemoveRecipe,
  onRemoveSavedRecipe,
  onUpdateGear,
  onGenerateSchedule,
}) => {
  const [recipeInput, setRecipeInput] = useState('');
  const [isAddingRecipe, setIsAddingRecipe] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [gearOpen, setGearOpen] = useState(false);
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);

  const autoGearCount = [
    gear.samsungFlexDuo,
    gear.brevillePro,
    gear.cooktopAndInduction,
    gear.kitchenAidFoodProcessor,
    gear.kitchenAidStandMixer,
  ].filter(Boolean).length;

  const explicitGearCount = [gear.outdoorGrill, gear.pelletPizzaOven].filter(Boolean).length;

  const handleAddRecipeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recipeInput.trim();
    if (!trimmed) return;

    setRecipeError(null);
    const isUrl = /^https?:\/\/\S+$/i.test(trimmed);
    const isLongPaste = trimmed.length > 90 || trimmed.includes('\n');

    if (isUrl || isLongPaste) {
      setIsAddingRecipe(true);
      try {
        const res = await fetch('/api/extract-recipe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: trimmed }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Could not parse that recipe.');
        }
        onAddRecipe({
          id: `rec-${Date.now()}`,
          title: data.title || trimmed.slice(0, 60),
          rawText: data.summary ? `${data.summary}\n${trimmed.slice(0, 600)}` : trimmed,
          sourceUrl: data.sourceUrl,
          prepMode: data.suggestedPrepMode === 'prep_ahead' ? 'prep_ahead' : 'parallel',
        });
        setRecipeInput('');
      } catch (err) {
        setRecipeError((err as Error).message || 'Could not extract recipe.');
      } finally {
        setIsAddingRecipe(false);
      }
      return;
    }

    // Short direct dish entry — add instantaneously
    onAddRecipe({
      id: `rec-${Date.now()}`,
      title: trimmed,
      rawText: trimmed,
      prepMode: 'parallel',
    });
    setRecipeInput('');
  };

  const handlePickSavedRecipe = (saved: SavedRecipe) => {
    onAddRecipe({
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: saved.title,
      rawText: saved.rawText,
      sourceUrl: saved.sourceUrl,
      prepMode: saved.defaultPrepMode,
    });
    setSavedDrawerOpen(false);
  };

  return (
    <div className="space-y-5">
      {/* Top Header: Target Dinner Time + Optional Start Time / Make Ahead Today */}
      <section className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-600">Target Dinner Time</div>
            <div className="mt-1 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer group">
                <span className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-slate-950 tabular-nums">
                  {formatTime12Hour(targetEatTime)}
                </span>
                <input
                  type="time"
                  value={toHtmlTimeValue(targetEatTime)}
                  onChange={(e) => {
                    if (e.target.value) {
                      onChangeTargetEatTime(formatTime12Hour(e.target.value));
                    }
                  }}
                  aria-label="Choose target dinner time"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </label>
            </div>
          </div>

          {/* Large -15m / +15m tap buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeTargetEatTime(shiftTime12Hour(targetEatTime, -15))}
              className="min-h-[48px] px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-900 font-semibold text-sm inline-flex items-center gap-1.5 transition-all whitespace-nowrap"
            >
              <Minus className="w-4 h-4" />
              15 min
            </button>
            <button
              type="button"
              onClick={() => onChangeTargetEatTime(shiftTime12Hour(targetEatTime, 15))}
              className="min-h-[48px] px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-900 font-semibold text-sm inline-flex items-center gap-1.5 transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              15 min
            </button>
          </div>
        </div>

        {/* One-tap quick dinner times */}
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_DINNER_TIMES.map((time) => {
            const active = formatTime12Hour(targetEatTime) === time;
            return (
              <button
                key={time}
                type="button"
                onClick={() => onChangeTargetEatTime(time)}
                className={`min-h-[44px] px-3.5 rounded-xl text-sm font-semibold tabular-nums transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-950 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {time}
              </button>
            );
          })}
        </div>

        {/* Optional Start Time + Make Ahead Today toggles */}
        <div className="mt-5 pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Start Time</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {startTimeEnabled ? (
                  <label className="relative inline-flex items-center gap-1 font-semibold text-slate-950 underline underline-offset-2 cursor-pointer">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="tabular-nums">{formatTime12Hour(startTime)}</span>
                    <input
                      type="time"
                      value={toHtmlTimeValue(startTime)}
                      onChange={(e) => {
                        if (e.target.value) onChangeStartTime(formatTime12Hour(e.target.value));
                      }}
                      aria-label="Choose custom start time"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                ) : (
                  'Auto-calculate from recipes'
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={startTimeEnabled}
              aria-label="Set custom start time"
              onClick={() => onToggleStartTime(!startTimeEnabled)}
              className={`w-12 h-7 rounded-full transition-colors p-0.5 shrink-0 ${
                startTimeEnabled ? 'bg-slate-950' : 'bg-slate-300'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow-xs transition-transform ${
                  startTimeEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Make Ahead Today</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {makeAheadToday ? 'Highlight early prep steps' : 'Keep prep in dinner window'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={makeAheadToday}
              aria-label="Toggle Make Ahead Today"
              onClick={() => onToggleMakeAheadToday(!makeAheadToday)}
              className={`w-12 h-7 rounded-full transition-colors p-0.5 shrink-0 ${
                makeAheadToday ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow-xs transition-transform ${
                  makeAheadToday ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Main 2-column responsive area on desktop, clean vertical stack on iPhone */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left/Primary Column: Recipe Input & Recipe Cards */}
        <div className="lg:col-span-7 space-y-4">
          {/* Recipe Input Card */}
          <section className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-display font-bold text-slate-950">Tonight’s Recipes</h2>
              <button
                type="button"
                onClick={() => setSavedDrawerOpen(true)}
                className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Bookmark className="w-4 h-4" />
                Saved Recipes ({savedRecipes.length})
              </button>
            </div>

            <form onSubmit={handleAddRecipeSubmit} className="space-y-3">
              <textarea
                value={recipeInput}
                onChange={(e) => setRecipeInput(e.target.value)}
                rows={3}
                placeholder="Paste a recipe URL, full recipe text, or type a dish (e.g. Garlic herb roast chicken at 425°F for 60 min)"
                className="w-full p-4 text-base bg-slate-50 border border-slate-300 rounded-2xl text-slate-950 placeholder:text-slate-400 focus:outline-none focus:border-slate-950 focus:bg-white transition-colors resize-y"
              />

              {recipeError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{recipeError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isAddingRecipe || !recipeInput.trim()}
                className="w-full min-h-[50px] px-5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed text-white text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                {isAddingRecipe ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reading Recipe...
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Add Recipe
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Added Recipes List (Full-width cards, zero truncated text) */}
          <section className="space-y-3" aria-label="Added meal recipes">
            {recipes.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center">
                <p className="text-base font-semibold text-slate-900">No dishes added yet</p>
                <p className="text-sm text-slate-600 mt-1">
                  Paste a recipe above or pick from your Saved Recipes to build tonight’s plan.
                </p>
              </div>
            ) : (
              recipes.map((recipe) => (
                <article
                  key={recipe.id}
                  className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <h3 className="text-lg font-display font-bold text-slate-950 leading-snug break-words">
                        {recipe.title}
                      </h3>
                      {recipe.rawText && recipe.rawText !== recipe.title && (
                        <p className="text-sm text-slate-600 leading-relaxed break-words">
                          {recipe.rawText}
                        </p>
                      )}
                      {recipe.sourceUrl && (
                        <p className="text-xs text-slate-500 break-all">{recipe.sourceUrl}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveRecipe(recipe.id)}
                      aria-label={`Remove ${recipe.title}`}
                      className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Do parallel vs. Prep ahead toggle */}
                  <div
                    className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl"
                    role="group"
                    aria-label={`Prep mode for ${recipe.title}`}
                  >
                    <button
                      type="button"
                      onClick={() => onChangeRecipePrepMode(recipe.id, 'parallel')}
                      className={`min-h-[44px] px-3 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                        recipe.prepMode === 'parallel'
                          ? 'bg-white text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Do parallel
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeRecipePrepMode(recipe.id, 'prep_ahead')}
                      className={`min-h-[44px] px-3 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                        recipe.prepMode === 'prep_ahead'
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Prep ahead
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </div>

        {/* Right/Secondary Column: Collapsed Kitchen Equipment Drawer & Primary CTA */}
        <div className="lg:col-span-5 space-y-4">
          {/* My Kitchen Gear Collapsible Drawer */}
          <section className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setGearOpen((prev) => !prev)}
              aria-expanded={gearOpen}
              className="w-full min-h-[64px] px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
                  <SlidersHorizontal className="w-5 h-5 text-slate-900" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-display font-bold text-slate-950">
                    My Kitchen Gear
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {autoGearCount} auto-assign active ·{' '}
                    {explicitGearCount > 0 ? `${explicitGearCount} outdoor on` : 'outdoor off'} ·
                    Saved
                  </div>
                </div>
              </div>
              {gearOpen ? (
                <ChevronUp className="w-5 h-5 text-slate-500 shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-500 shrink-0" />
              )}
            </button>

            {gearOpen && (
              <div className="px-5 pb-5 pt-2 border-t border-slate-200 space-y-4">
                {/* Auto-assign Appliances */}
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-slate-500">
                    Auto-Assign Indoor Appliances
                  </div>

                  {/* Samsung Flex Duo Oven */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-950">
                          Samsung Flex Duo Oven
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          Dual-Zone Split mode OR Single Full Cavity
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={gear.samsungFlexDuo}
                        aria-label="Toggle Samsung Flex Duo Oven"
                        onClick={() =>
                          onUpdateGear({ ...gear, samsungFlexDuo: !gear.samsungFlexDuo })
                        }
                        className={`w-12 h-7 rounded-full transition-colors p-0.5 shrink-0 ${
                          gear.samsungFlexDuo ? 'bg-slate-950' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`block w-6 h-6 rounded-full bg-white shadow-xs transition-transform ${
                            gear.samsungFlexDuo ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {gear.samsungFlexDuo && (
                      <div className="grid grid-cols-3 gap-1 p-1 bg-white border border-slate-200 rounded-xl">
                        {(
                          [
                            { id: 'auto', label: 'Auto' },
                            { id: 'split', label: 'Dual Split' },
                            { id: 'single', label: 'Full Cavity' },
                          ] as { id: SamsungOvenMode; label: string }[]
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => onUpdateGear({ ...gear, samsungMode: opt.id })}
                            className={`min-h-[38px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                              gear.samsungMode === opt.id
                                ? 'bg-slate-950 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Breville Smart Oven Air Fryer Pro */}
                  <GearToggleRow
                    title="Breville Smart Oven Air Fryer Pro"
                    subtitle="Fast preheat, air fry, bake, warm hold"
                    checked={gear.brevillePro}
                    onChange={(v) => onUpdateGear({ ...gear, brevillePro: v })}
                  />

                  {/* 4-Burner Cooktop + Portable Induction */}
                  <GearToggleRow
                    title="4-Burner Cooktop + Portable Induction"
                    subtitle="5 total burners for simultaneous cooking"
                    checked={gear.cooktopAndInduction}
                    onChange={(v) => onUpdateGear({ ...gear, cooktopAndInduction: v })}
                  />

                  {/* KitchenAid Food Processor */}
                  <GearToggleRow
                    title="KitchenAid Food Processor"
                    subtitle="Prep accelerator for slicing, chopping, sauces"
                    checked={gear.kitchenAidFoodProcessor}
                    onChange={(v) => onUpdateGear({ ...gear, kitchenAidFoodProcessor: v })}
                  />

                  {/* KitchenAid Stand Mixer */}
                  <GearToggleRow
                    title="KitchenAid Stand Mixer"
                    subtitle="Prep accelerator for mashing, doughs, whipping"
                    checked={gear.kitchenAidStandMixer}
                    onChange={(v) => onUpdateGear({ ...gear, kitchenAidStandMixer: v })}
                  />
                </div>

                {/* Explicit-only Outdoor Appliances */}
                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-500">
                    Explicit-Only Outdoor Gear (Off by default)
                  </div>

                  <GearToggleRow
                    title="Outdoor Grill"
                    subtitle="Toggle ON for this meal or when a recipe calls for grilling"
                    checked={gear.outdoorGrill}
                    onChange={(v) => onUpdateGear({ ...gear, outdoorGrill: v })}
                  />

                  <GearToggleRow
                    title="Pellet Pizza Oven"
                    subtitle="Toggle ON for this meal or when making pizza/flatbread"
                    checked={gear.pelletPizzaOven}
                    onChange={(v) => onUpdateGear({ ...gear, pelletPizzaOven: v })}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Error banner if generation failed */}
          {generateError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{generateError}</span>
            </div>
          )}

          {/* Primary CTA: Generate Meal Schedule */}
          <button
            type="button"
            onClick={onGenerateSchedule}
            disabled={isGenerating || recipes.length === 0}
            className="w-full min-h-[58px] px-6 rounded-2xl bg-slate-950 hover:bg-slate-800 active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white text-lg font-display font-bold inline-flex items-center justify-center gap-2.5 shadow-md transition-all"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Building Your Schedule...
              </>
            ) : (
              'Generate Meal Schedule'
            )}
          </button>
        </div>
      </div>

      {/* Saved Recipes Bottom Sheet / Drawer */}
      {savedDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-xs"
          onClick={() => setSavedDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Saved recipes quick-pick"
        >
          <div
            className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[82vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 sm:hidden" />
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-display font-bold text-slate-950">Saved Recipes</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Tap any saved dish to add it to tonight’s meal
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSavedDrawerOpen(false)}
                aria-label="Close saved recipes"
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-950 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {savedRecipes.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-600">
                  No saved recipes yet. After finishing a meal, tap &ldquo;Keep Recipe&rdquo; to
                  save your favorites here.
                </div>
              ) : (
                savedRecipes.map((saved) => {
                  const alreadyAdded = recipes.some(
                    (r) => r.title.toLowerCase() === saved.title.toLowerCase()
                  );
                  return (
                    <div
                      key={saved.id}
                      className="p-4 rounded-2xl border border-slate-200 bg-slate-50 flex items-start justify-between gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => handlePickSavedRecipe(saved)}
                        className="flex-1 text-left space-y-1 min-w-0"
                      >
                        <div className="text-base font-bold text-slate-950 leading-snug break-words">
                          {saved.title}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed break-words">
                          {saved.rawText}
                        </p>
                        <div className="text-xs font-semibold text-slate-700 pt-1 inline-flex items-center gap-1">
                          {alreadyAdded ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-700" />
                              <span className="text-emerald-700">In tonight’s meal · Tap to add again</span>
                            </>
                          ) : (
                            <span>+ Tap to add to tonight’s meal</span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveSavedRecipe(saved.id)}
                        aria-label={`Delete saved recipe ${saved.title}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface GearToggleRowProps {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

const GearToggleRow: React.FC<GearToggleRowProps> = ({
  title,
  subtitle,
  checked,
  onChange,
}) => (
  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
    <div className="min-w-0">
      <div className="text-sm font-bold text-slate-950">{title}</div>
      <div className="text-xs text-slate-600 mt-0.5 leading-snug">{subtitle}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Toggle ${title}`}
      onClick={() => onChange(!checked)}
      className={`w-12 h-7 rounded-full transition-colors p-0.5 shrink-0 ${
        checked ? 'bg-slate-950' : 'bg-slate-300'
      }`}
    >
      <span
        className={`block w-6 h-6 rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
);
