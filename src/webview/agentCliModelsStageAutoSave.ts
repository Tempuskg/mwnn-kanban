/**
 * Stage-override auto-save helpers for the Agent CLI Models panel.
 * Kept free of DOM globals so unit tests can exercise commit wiring in Node.
 */

/** Command-button labels on a stage override row. Never includes Save. */
export function stageOverrideCommandLabels(hasOwnedOverride: boolean): readonly string[] {
  return hasOwnedOverride ? ['Remove override'] : [];
}

export interface StageOverrideAutoSaveTarget {
  value: string;
  addEventListener(type: 'change' | 'blur', listener: () => void): void;
}

export interface StageOverrideAutoSaveForm {
  addEventListener(type: 'submit', listener: (event: { preventDefault(): void }) => void): void;
}

/**
 * Persist a stage model/thinking override on blur, datalist change, or Enter.
 * Skips no-ops (unchanged vs owned) and duplicate posts when change is followed by blur.
 */
export function wireStageOverrideAutoSave(
  input: StageOverrideAutoSaveTarget,
  form: StageOverrideAutoSaveForm,
  options: {
    readonly ownedValue: string | null;
    readonly commitSet: () => void;
  },
): void {
  let posted: string | undefined;
  const commit = (): void => {
    if (input.value === (options.ownedValue ?? '') || input.value === posted) {
      return;
    }
    posted = input.value;
    options.commitSet();
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commit();
  });
}
