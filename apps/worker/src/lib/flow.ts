import type { ConversationState, FlowState, GuidedStep } from "@afrotune/db";
import type { SongBriefSlots } from "@afrotune/core";

/**
 * Canonical order the guided creation walk asks things in. This is
 * deliberately broader than SongBriefSlots.REQUIRED_SLOTS_FOR_CONFIRMATION
 * (which only gates whether a brief can be confirmed/priced) - vocal
 * preference, recipient details and the personal story are all asked as part
 * of the guided experience even though they remain optional at the
 * confirmation-gate level, since a stray free-text message could in
 * principle jump straight to "yes create it" without ever answering them.
 */
const STEP_ORDER: GuidedStep[] = [
  "occasion",
  "country",
  "genre",
  "language",
  "vocal",
  "mood",
  "recipient",
  "story",
];

function isStepAnswered(step: GuidedStep, slots: SongBriefSlots): boolean {
  switch (step) {
    case "occasion":
      return !!slots.occasion;
    case "country":
      return !!slots.countryCode;
    case "genre":
      return !!slots.genre;
    case "language":
      return !!slots.languages?.length;
    case "vocal":
      return !!slots.vocalPreference;
    case "mood":
      return !!slots.mood;
    case "recipient":
      return !!(slots.recipientName && slots.relationship);
    case "story":
      return !!slots.story;
  }
}

/** First unanswered step in canonical order, or null once everything the guided walk asks for is known. */
export function nextGuidedStep(slots: SongBriefSlots): GuidedStep | null {
  return STEP_ORDER.find((step) => !isStepAnswered(step, slots)) ?? null;
}

/**
 * The story step is deliberately soft/open-ended, not a strict
 * schema-completion gate: a real user answer here can be as short as
 * "Motherhood" or "Just encouragement for mums", and the LLM's own
 * extraction can be conservative about terse replies. This guarantees any
 * substantive free-text reply sent while story is the open step satisfies
 * it, regardless of what (if anything) the LLM extracted into
 * slotUpdates.story, so the step can never loop indefinitely.
 *
 * - If story is already answered, never overwrite it with a weaker
 *   fallback (e.g. "Just go with this detail" said after real story content
 *   was already given earlier) - that prior context already counts.
 * - Otherwise prefer whatever the LLM did extract.
 * - Otherwise fall back to the raw message itself, so even a generic
 *   "just go with this" or a single word still advances the flow rather
 *   than repeating the same prompt.
 */
export function resolveStoryOnFreeText(params: {
  currentStory?: string;
  extractedStory?: string;
  userMessage: string;
}): string | undefined {
  if (params.currentStory?.trim()) return params.currentStory;
  if (params.extractedStory?.trim()) return params.extractedStory;
  const trimmed = params.userMessage.trim();
  return trimmed.length > 0 ? trimmed : params.currentStory;
}

function synthesizeFlow(slots: SongBriefSlots): FlowState {
  const hasAnyAnswer = STEP_ORDER.some((step) => isStepAnswered(step, slots));
  if (!hasAnyAnswer) return { screen: "main_menu" };
  const next = nextGuidedStep(slots);
  return next ? { screen: "guided_creation", step: next } : { screen: "review" };
}

/**
 * Reads the current guided-flow position out of session state, synthesizing
 * a sensible one from `slots` if this session predates the `flow` field (any
 * session already active before this feature shipped) so it degrades
 * gracefully on its very next message instead of crashing on an undefined
 * `flow.screen`.
 */
export function resolveFlow(state: ConversationState): FlowState {
  return state.flow ?? synthesizeFlow(state.slots);
}

/**
 * Returns a new ConversationState with `flow` patched on top of whatever's
 * currently there (resolving a missing one first via resolveFlow), leaving
 * `slots`/`history`/`pendingChoice` untouched. Callers must still persist the
 * result via updateSessionState and should update their in-memory
 * `session.state` reference to the return value so later code in the same
 * turn sees it.
 */
export function patchFlow(state: ConversationState, patch: Partial<FlowState>): ConversationState {
  const current = resolveFlow(state);
  return { ...state, flow: { ...current, ...patch } };
}
