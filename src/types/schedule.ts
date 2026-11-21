export type StepKind =
  | 'active_prep'
  | 'passive_cook'
  | 'make_ahead'
  | 'tempering'
  | 'staging';

export interface CookingStep {
  id: string;
  recipe: string;
  title: string;
  duration_mins: number;
  offset_before_eat_mins: number;
  kind: StepKind;
  equipment: string[];
  depends_on: string[];
  can_make_ahead: boolean;
}

export interface CookingSchedule {
  target_eat_time: string;
  pre_cook_setup: string[];
  warnings_and_conflicts: string[];
  steps: CookingStep[];
}

export type PrepMode = 'parallel' | 'prep_ahead';

export interface MealRecipeItem {
  id: string;
  title: string;
  rawText: string;
  sourceUrl?: string;
  prepMode: PrepMode;
}

export interface SavedRecipe {
  id: string;
  title: string;
  rawText: string;
  sourceUrl?: string;
  defaultPrepMode: PrepMode;
}

export type SamsungOvenMode = 'auto' | 'split' | 'single';

export interface KitchenGearConfig {
  samsungFlexDuo: boolean;
  samsungMode: SamsungOvenMode;
  brevillePro: boolean;
  cooktopAndInduction: boolean;
  kitchenAidFoodProcessor: boolean;
  kitchenAidStandMixer: boolean;
  outdoorGrill: boolean;
  pelletPizzaOven: boolean;
}

export const DEFAULT_KITCHEN_GEAR: KitchenGearConfig = {
  samsungFlexDuo: true,
  samsungMode: 'auto',
  brevillePro: true,
  cooktopAndInduction: true,
  kitchenAidFoodProcessor: true,
  kitchenAidStandMixer: true,
  outdoorGrill: false,
  pelletPizzaOven: false,
};
