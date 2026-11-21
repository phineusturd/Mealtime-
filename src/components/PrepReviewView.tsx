import React, { useMemo } from 'react';
import { AlertTriangle, Check, Play } from 'lucide-react';
import type { CookingSchedule } from '../types/schedule';
import {
  formatClockAtOffset12Hour,
  formatDurationReadable,
  formatTime12Hour,
  getPrimaryApplianceLabel,
  sortStepsChronologically,
} from '../lib/scheduleUtils';

interface PrepReviewViewProps {
  schedule: CookingSchedule;
  checkedSetupIndices: Set<number>;
  doneAheadStepIds: Set<string>;
  onToggleSetupIndex: (idx: number) => void;
  onToggleDoneAhead: (stepId: string) => void;
  onStartLiveCooking: () => void;
}

export const PrepReviewView: React.FC<PrepReviewViewProps> = ({
  schedule,
  checkedSetupIndices,
  doneAheadStepIds,
  onToggleSetupIndex,
  onToggleDoneAhead,
  onStartLiveCooking,
}) => {
  const sortedSteps = useMemo(() => sortStepsChronologically(schedule.steps), [schedule.steps]);

  const makeAheadSteps = useMemo(
    () => sortedSteps.filter((s) => s.can_make_ahead || s.kind === 'make_ahead'),
    [sortedSteps]
  );

  const dinnerRushSteps = useMemo(
    () => sortedSteps.filter((s) => !doneAheadStepIds.has(s.id)),
    [sortedSteps, doneAheadStepIds]
  );

  const firstRushStep = dinnerRushSteps[0];
  const dinnerStartClock = firstRushStep
    ? formatClockAtOffset12Hour(schedule.target_eat_time, firstRushStep.offset_before_eat_mins)
    : formatTime12Hour(schedule.target_eat_time);

  // Only show a warning banner if there is a true unresolvable conflict in schedule.warnings_and_conflicts
  const unresolvableWarnings = schedule.warnings_and_conflicts.filter((w) => w.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* Header Card */}
      <section className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-600">Dinner Schedule Ready</div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-950 mt-0.5 tabular-nums">
            Dinner at {formatTime12Hour(schedule.target_eat_time)}
          </h1>
          <p className="text-sm text-slate-600 mt-1 tabular-nums">
            First dinner step starts at{' '}
            <span className="font-bold text-slate-950">{dinnerStartClock}</span> ·{' '}
            {dinnerRushSteps.length} {dinnerRushSteps.length === 1 ? 'step' : 'steps'} in dinner
            rush
          </p>
        </div>
        {doneAheadStepIds.size > 0 && (
          <div className="text-sm font-semibold text-emerald-700">
            {doneAheadStepIds.size} prepped ahead
          </div>
        )}
      </section>

      {/* True Unresolvable Conflict Banner — ONLY shown when real warnings exist */}
      {unresolvableWarnings.length > 0 && (
        <section
          aria-label="Unresolvable kitchen conflict"
          className="bg-amber-50 border border-amber-300 rounded-3xl p-5 space-y-2.5"
        >
          <div className="flex items-center gap-2 text-amber-950 font-display font-bold text-base">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <span>Heads Up — Equipment Conflict</span>
          </div>
          <ul className="space-y-2 text-sm text-amber-950 leading-relaxed">
            {unresolvableWarnings.map((warning, idx) => (
              <li key={idx} className="break-words">
                • {warning}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Main Content: 2-column on large desktop, clean single column on iPhone */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Kitchen Setup + Make-Ahead Opportunities */}
        <div className="lg:col-span-7 space-y-5">
          {/* Kitchen Setup Box */}
          <section className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-display font-bold text-slate-950">Kitchen Setup</h2>
              <span className="text-xs font-semibold text-slate-500 tabular-nums">
                {checkedSetupIndices.size} of {schedule.pre_cook_setup.length} ready
              </span>
            </div>

            {schedule.pre_cook_setup.length === 0 ? (
              <p className="text-sm text-slate-600">
                No special appliance setup needed before you start.
              </p>
            ) : (
              <div className="space-y-2.5">
                {schedule.pre_cook_setup.map((bullet, idx) => {
                  const checked = checkedSetupIndices.has(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onToggleSetupIndex(idx)}
                      className={`w-full min-h-[54px] p-3.5 rounded-2xl border text-left flex items-start gap-3.5 transition-colors ${
                        checked
                          ? 'bg-slate-50 border-slate-200 text-slate-500'
                          : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-950'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                          checked
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-400 bg-white'
                        }`}
                      >
                        {checked && <Check className="w-4 h-4 stroke-[3]" />}
                      </span>
                      <span
                        className={`text-base leading-snug break-words ${
                          checked ? 'line-through' : 'font-medium'
                        }`}
                      >
                        {bullet}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Make-Ahead Opportunities */}
          {makeAheadSteps.length > 0 && (
            <section className="bg-emerald-50/70 border border-emerald-200 rounded-3xl p-5 space-y-3.5">
              <div>
                <h2 className="text-lg font-display font-bold text-emerald-950">
                  Make-Ahead Opportunities
                </h2>
                <p className="text-sm text-emerald-900/80 mt-0.5">
                  Knock these out early and check &ldquo;Done Ahead&rdquo; to remove them from the
                  dinner rush.
                </p>
              </div>

              <div className="space-y-3">
                {makeAheadSteps.map((step) => {
                  const isDoneAhead = doneAheadStepIds.has(step.id);
                  return (
                    <div
                      key={step.id}
                      className={`p-4 rounded-2xl border transition-colors ${
                        isDoneAhead
                          ? 'bg-white/70 border-emerald-200 opacity-75'
                          : 'bg-white border-emerald-300 shadow-xs'
                      }`}
                    >
                      <div className="text-xs font-semibold text-emerald-800">
                        {step.recipe} · {formatDurationReadable(step.duration_mins)} ·{' '}
                        {getPrimaryApplianceLabel(step)}
                      </div>
                      <p
                        className={`mt-1 text-base font-bold leading-snug break-words ${
                          isDoneAhead ? 'line-through text-slate-500' : 'text-slate-950'
                        }`}
                      >
                        {step.title}
                      </p>

                      <button
                        type="button"
                        onClick={() => onToggleDoneAhead(step.id)}
                        className={`mt-3 w-full min-h-[46px] px-4 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors ${
                          isDoneAhead
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-emerald-100 text-emerald-950 hover:bg-emerald-200'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                        {isDoneAhead ? 'Done Ahead (Removed from Dinner Rush)' : 'Mark Done Ahead'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Clean Dinner Rush Flow Preview + Primary CTA */}
        <div className="lg:col-span-5 space-y-4">
          <section className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-display font-bold text-slate-950">Dinner Rush Flow</h2>
              <span className="text-xs font-semibold text-slate-500 tabular-nums">
                {dinnerRushSteps.length} steps
              </span>
            </div>

            {dinnerRushSteps.length === 0 ? (
              <p className="text-sm text-emerald-700 font-medium py-3">
                Everything is already prepped ahead — you’re ready to serve!
              </p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {dinnerRushSteps.map((step) => (
                  <li key={step.id} className="py-3 first:pt-1 last:pb-1 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-mono font-bold text-slate-950 tabular-nums">
                        {formatClockAtOffset12Hour(
                          schedule.target_eat_time,
                          step.offset_before_eat_mins
                        )}
                      </span>
                      <span className="text-xs font-mono font-medium text-slate-500">
                        {getPrimaryApplianceLabel(step)}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900 leading-snug break-words">
                      {step.title}
                    </div>
                    <div className="text-xs text-slate-500">
                      {step.recipe} · {formatDurationReadable(step.duration_mins)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Primary CTA: Start Live Cooking Guide */}
          <button
            type="button"
            onClick={onStartLiveCooking}
            className="w-full min-h-[58px] px-6 rounded-2xl bg-slate-950 hover:bg-slate-800 active:scale-[0.99] text-white text-lg font-display font-bold inline-flex items-center justify-center gap-2.5 shadow-md transition-all"
          >
            <Play className="w-5 h-5 fill-current" />
            Start Live Cooking Guide
          </button>
        </div>
      </div>
    </div>
  );
};
