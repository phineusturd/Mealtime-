import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Flame,
  Pause,
  Play,
  Plus,
  Utensils,
} from 'lucide-react';
import type { CookingSchedule, CookingStep } from '../types/schedule';
import {
  formatClockAtOffset12Hour,
  formatCountdown,
  formatDurationReadable,
  formatTime12Hour,
  getPrimaryApplianceLabel,
  isPassiveBackgroundStep,
  sortStepsChronologically,
} from '../lib/scheduleUtils';

interface CookNowViewProps {
  schedule: CookingSchedule;
  completedStepIds: Set<string>;
  backgroundTimers: Record<string, number>; // stepId -> remaining seconds
  isClockPaused: boolean;
  delayNotice: string | null;
  onCompleteStep: (stepId: string) => void;
  onMoveToBackground: (step: CookingStep) => void;
  onCompleteBackgroundStep: (stepId: string) => void;
  onAdjustStepTimer: (stepId: string, deltaSeconds: number) => void;
  onTogglePauseClock: () => void;
  onDelayFiveMins: () => void;
  onFinishMeal: () => void;
}

function playGentleChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.62);
  } catch {
    // Web Audio blocked until user gesture
  }
}

export const CookNowView: React.FC<CookNowViewProps> = ({
  schedule,
  completedStepIds,
  backgroundTimers,
  isClockPaused,
  delayNotice,
  onCompleteStep,
  onMoveToBackground,
  onCompleteBackgroundStep,
  onAdjustStepTimer,
  onTogglePauseClock,
  onDelayFiveMins,
  onFinishMeal,
}) => {
  const [activeRemainingSecs, setActiveRemainingSecs] = useState<number>(0);
  const lastActiveIdRef = useRef<string | null>(null);
  const chimedIdsRef = useRef<Set<string>>(new Set());

  const sortedSteps = useMemo(() => sortStepsChronologically(schedule.steps), [schedule.steps]);

  const backgroundStepIds = useMemo(() => new Set(Object.keys(backgroundTimers)), [backgroundTimers]);

  // Steps not yet completed and not currently running in the background strip
  const remainingQueue = useMemo(
    () =>
      sortedSteps.filter(
        (s) => !completedStepIds.has(s.id) && !backgroundStepIds.has(s.id)
      ),
    [sortedSteps, completedStepIds, backgroundStepIds]
  );

  const activeStep: CookingStep | null = remainingQueue[0] ?? null;
  const upNextSteps: CookingStep[] = remainingQueue.slice(1, 4); // Strictly next 3 upcoming steps

  const runningBackgroundSteps = useMemo(() => {
    return Object.keys(backgroundTimers)
      .map((id) => schedule.steps.find((s) => s.id === id))
      .filter((s): s is CookingStep => Boolean(s))
      .sort((a, b) => (backgroundTimers[a.id] ?? 0) - (backgroundTimers[b.id] ?? 0));
  }, [backgroundTimers, schedule.steps]);

  // Sync active countdown whenever activeStep changes
  useEffect(() => {
    if (!activeStep) {
      lastActiveIdRef.current = null;
      setActiveRemainingSecs(0);
      return;
    }
    if (lastActiveIdRef.current !== activeStep.id) {
      lastActiveIdRef.current = activeStep.id;
      setActiveRemainingSecs(activeStep.duration_mins * 60);
    }
  }, [activeStep]);

  // Tick the active hero countdown every second
  useEffect(() => {
    if (isClockPaused || !activeStep) return;
    const timer = window.setInterval(() => {
      setActiveRemainingSecs((prev) => {
        if (prev <= 1) {
          if (prev === 1 && !chimedIdsRef.current.has(activeStep.id)) {
            chimedIdsRef.current.add(activeStep.id);
            playGentleChime();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isClockPaused, activeStep]);

  // Chime when a background timer reaches zero
  useEffect(() => {
    for (const [id, secs] of Object.entries(backgroundTimers)) {
      if (secs === 0 && !chimedIdsRef.current.has(`bg-${id}`)) {
        chimedIdsRef.current.add(`bg-${id}`);
        playGentleChime();
      }
    }
  }, [backgroundTimers]);

  const allDone = !activeStep && runningBackgroundSteps.length === 0;
  const isActiveStepPassive = activeStep ? isPassiveBackgroundStep(activeStep) : false;

  const handlePrimaryAction = () => {
    if (!activeStep) return;
    if (isActiveStepPassive) {
      onMoveToBackground(activeStep);
    } else {
      onCompleteStep(activeStep.id);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Countertop Status Line */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-600">Dinner Target</div>
          <div className="text-2xl font-display font-bold text-slate-950 tabular-nums leading-tight">
            {formatTime12Hour(schedule.target_eat_time)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePauseClock}
            className="min-h-[44px] px-4 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            {isClockPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
            {isClockPaused ? 'Resume Timers' : 'Pause Timers'}
          </button>
        </div>
      </div>

      {delayNotice && (
        <div className="px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold text-center">
          {delayNotice}
        </div>
      )}

      {/* ACTIVE NOW HERO CARD */}
      {allDone ? (
        <section className="bg-emerald-50 border-2 border-emerald-400 rounded-3xl p-6 sm:p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto">
            <Utensils className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-emerald-950">
              Dinner Is Served!
            </h1>
            <p className="text-base text-emerald-900">
              Every dish is complete. Tap below to save your favorite recipes from tonight.
            </p>
          </div>
          <button
            type="button"
            onClick={onFinishMeal}
            className="w-full min-h-[58px] px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-display font-bold transition-colors"
          >
            Finish Meal &amp; Rate Dishes
          </button>
        </section>
      ) : activeStep ? (
        <section
          aria-label="Active cooking step"
          className="bg-white border-2 border-slate-950 rounded-3xl p-6 sm:p-7 shadow-sm space-y-5"
        >
          {/* Kicker + Appliance + Scheduled Time */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold tracking-wider text-emerald-700 uppercase">
              ACTIVE NOW
            </span>
            <span className="text-sm font-mono font-bold text-slate-700 tabular-nums">
              {formatClockAtOffset12Hour(
                schedule.target_eat_time,
                activeStep.offset_before_eat_mins
              )}
            </span>
          </div>

          {/* Appliance Line (high-contrast monospace) */}
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-sm font-mono font-bold text-slate-900 bg-slate-100 px-3 py-1.5 rounded-xl">
              <Flame className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{getPrimaryApplianceLabel(activeStep)}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600 pt-1">{activeStep.recipe}</div>
            <h1 className="text-2xl sm:text-[28px] font-display font-bold text-slate-950 leading-snug break-words">
              {activeStep.title}
            </h1>
          </div>

          {/* Big Live Countdown Timer */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-500">
                {activeRemainingSecs === 0
                  ? 'Step Timer Complete'
                  : isClockPaused
                  ? 'Timer Paused'
                  : 'Time Remaining'}
              </div>
              <div
                className={`text-5xl sm:text-6xl font-mono font-bold tabular-nums tracking-tight leading-none mt-1 ${
                  activeRemainingSecs === 0 ? 'text-emerald-700' : 'text-slate-950'
                }`}
              >
                {formatCountdown(activeRemainingSecs)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveRemainingSecs((prev) => prev + 60)}
                className="min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-900 text-sm font-semibold tabular-nums transition-colors whitespace-nowrap"
              >
                +1 min
              </button>
              <button
                type="button"
                onClick={() => setActiveRemainingSecs(activeStep.duration_mins * 60)}
                className="min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-semibold transition-colors whitespace-nowrap"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Large Green Mark Done Button */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handlePrimaryAction}
              className="w-full min-h-[60px] px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-xl font-display font-bold inline-flex items-center justify-center gap-2.5 shadow-sm transition-all"
            >
              <Check className="w-6 h-6 stroke-[3]" />
              {isActiveStepPassive ? 'Mark Done — Run Timer in Background' : 'Mark Done'}
            </button>

            {isActiveStepPassive && (
              <button
                type="button"
                onClick={() => onCompleteStep(activeStep.id)}
                className="w-full min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-950 transition-colors"
              >
                Already finished cooking? Skip background timer
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="bg-white border-2 border-slate-900 rounded-3xl p-6 text-center space-y-2">
          <div className="text-xs font-extrabold tracking-wider text-amber-700 uppercase">
            HANDS FREE
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-950">
            Waiting on Background Timers
          </h1>
          <p className="text-base text-slate-600">
            Tap &ldquo;Done&rdquo; on each running item below as it finishes.
          </p>
        </section>
      )}

      {/* RUNNING IN BACKGROUND STRIP */}
      {runningBackgroundSteps.length > 0 && (
        <section aria-label="Running in background" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold tracking-wider text-slate-700 uppercase">
              RUNNING IN BACKGROUND ({runningBackgroundSteps.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {runningBackgroundSteps.map((step) => {
              const secs = backgroundTimers[step.id] ?? 0;
              const finished = secs === 0;
              return (
                <div
                  key={step.id}
                  className={`p-4 rounded-2xl border-2 flex items-center justify-between gap-4 transition-colors ${
                    finished
                      ? 'bg-emerald-50 border-emerald-500'
                      : 'bg-amber-50/70 border-amber-300'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-mono font-bold text-slate-800">
                      {getPrimaryApplianceLabel(step)}
                    </div>
                    <div className="text-base font-bold text-slate-950 leading-snug break-words">
                      {step.recipe}
                    </div>
                    <div className="text-sm text-slate-700 leading-snug break-words">
                      {step.title}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div
                      className={`text-2xl font-mono font-bold tabular-nums ${
                        finished ? 'text-emerald-700' : 'text-amber-950'
                      }`}
                    >
                      {finished ? 'READY' : formatCountdown(secs)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!finished && (
                        <button
                          type="button"
                          onClick={() => onAdjustStepTimer(step.id, 120)}
                          className="min-h-[40px] px-2.5 rounded-xl bg-white border border-amber-300 text-xs font-semibold text-amber-950 tabular-nums"
                        >
                          +2m
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onCompleteBackgroundStep(step.id)}
                        className="min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* UP NEXT LIST — Strictly next 3 upcoming steps */}
      {upNextSteps.length > 0 && (
        <section
          aria-label="Up next steps"
          className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3"
        >
          <h2 className="text-sm font-extrabold tracking-wider text-slate-700 uppercase">
            UP NEXT
          </h2>

          <ul className="divide-y divide-slate-200">
            {upNextSteps.map((step) => (
              <li key={step.id} className="py-3.5 first:pt-1 last:pb-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base leading-snug">
                  <span className="font-mono font-bold text-slate-950 tabular-nums shrink-0">
                    {formatClockAtOffset12Hour(
                      schedule.target_eat_time,
                      step.offset_before_eat_mins
                    )}
                  </span>
                  <span className="text-slate-400" aria-hidden="true">
                    —
                  </span>
                  <span className="font-semibold text-slate-950 break-words">{step.title}</span>
                </div>
                <div className="text-xs font-medium text-slate-600">
                  {step.recipe} · {getPrimaryApplianceLabel(step)} ·{' '}
                  {formatDurationReadable(step.duration_mins)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Bottom Emergency Control (+5 Min Delay) & Finish Meal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={onDelayFiveMins}
          className="w-full min-h-[54px] px-5 rounded-2xl bg-amber-100 hover:bg-amber-200 active:scale-[0.99] border border-amber-300 text-amber-950 text-base font-display font-bold inline-flex items-center justify-center gap-2 transition-all"
        >
          <Clock className="w-5 h-5" />
          <Plus className="w-4 h-4 -mr-1.5" />5 Min Delay
        </button>

        <button
          type="button"
          onClick={onFinishMeal}
          className="w-full min-h-[54px] px-5 rounded-2xl bg-slate-950 hover:bg-slate-800 active:scale-[0.99] text-white text-base font-display font-bold inline-flex items-center justify-center gap-2 transition-all"
        >
          <Utensils className="w-5 h-5" />
          Finish Meal
        </button>
      </div>
    </div>
  );
};
