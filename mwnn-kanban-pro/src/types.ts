export interface ProFeatureRegistrationContext {
  readonly log: (message: string) => void;
}

export type ProFeatureRegistrar = (
  context: ProFeatureRegistrationContext,
) => void | Promise<void>;
