import React, { useState } from 'react';
import { BookmarkCheck, Trash2, Utensils } from 'lucide-react';
import type { MealRecipeItem } from '../types/schedule';

interface FinishMealScreenProps {
  dishes: MealRecipeItem[];
  onCompleteReview: (keptDishes: MealRecipeItem[]) => void;
  onCancel: () => void;
}

export const FinishMealScreen: React.FC<FinishMealScreenProps> = ({
  dishes,
  onCompleteReview,
  onCancel,
}) => {
  const [decisions, setDecisions] = useState<Record<string, 'keep' | 'discard'>>(() => {
    const initial: Record<string, 'keep' | 'discard'> = {};
    for (const d of dishes) {
      initial[d.id] = 'keep';
    }
    return initial;
  });

  const keptCount = dishes.filter((d) => decisions[d.id] === 'keep').length;

  const handleSave = () => {
    const kept = dishes.filter((d) => decisions[d.id] === 'keep');
    onCompleteReview(kept);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#F4F5F7] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Post-meal recipe review"
    >
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-12 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-slate-950 text-white flex items-center justify-center mx-auto">
            <Utensils className="w-7 h-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-950">
            How Was Dinner?
          </h1>
          <p className="text-base text-slate-600">
            Choose which dishes to keep in your Saved Recipes for next time.
          </p>
        </div>

        <div className="space-y-3.5">
          {dishes.map((dish) => {
            const choice = decisions[dish.id] ?? 'keep';
            return (
              <div
                key={dish.id}
                className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4"
              >
                <div>
                  <h2 className="text-lg font-display font-bold text-slate-950 leading-snug break-words">
                    {dish.title}
                  </h2>
                  {dish.rawText && dish.rawText !== dish.title && (
                    <p className="text-sm text-slate-600 mt-1 break-words">{dish.rawText}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDecisions((prev) => ({ ...prev, [dish.id]: 'keep' }))}
                    className={`min-h-[50px] px-4 rounded-2xl text-base font-bold inline-flex items-center justify-center gap-2 border-2 transition-colors ${
                      choice === 'keep'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <BookmarkCheck className="w-5 h-5" />
                    Keep Recipe
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecisions((prev) => ({ ...prev, [dish.id]: 'discard' }))}
                    className={`min-h-[50px] px-4 rounded-2xl text-base font-bold inline-flex items-center justify-center gap-2 border-2 transition-colors ${
                      choice === 'discard'
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Trash2 className="w-5 h-5" />
                    Discard
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            className="w-full min-h-[58px] px-6 rounded-2xl bg-slate-950 hover:bg-slate-800 text-white text-lg font-display font-bold transition-colors"
          >
            Save {keptCount} {keptCount === 1 ? 'Recipe' : 'Recipes'} &amp; Finish
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full min-h-[48px] text-base font-semibold text-slate-600 hover:text-slate-950 transition-colors"
          >
            Back to Cooking Guide
          </button>
        </div>
      </div>
    </div>
  );
};
