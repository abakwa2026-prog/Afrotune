import { test } from "node:test";
import assert from "node:assert/strict";
import type { SongBriefSlots } from "@afrotune/core";
import { nextGuidedStep, resolveStoryOnFreeText } from "./flow.js";

// A brief with every guided-flow slot except `story` already filled - the
// exact state a real user is in once they reach the story prompt.
const READY_FOR_STORY: SongBriefSlots = {
  occasion: "birthday",
  countryCode: "NG",
  genre: "Afrobeats",
  languages: ["en"],
  vocalPreference: "male",
  mood: "happy",
  recipientName: "Daniel",
  relationship: "brother",
};

test("regression: reaching the story step with everything else answered still asks for story", () => {
  assert.equal(nextGuidedStep(READY_FOR_STORY), "story");
});

test("1. minimal story text ('Motherhood') is accepted and the step completes", () => {
  const story = resolveStoryOnFreeText({ currentStory: undefined, extractedStory: undefined, userMessage: "Motherhood" });
  assert.equal(story, "Motherhood");
  assert.equal(nextGuidedStep({ ...READY_FOR_STORY, story }), null);
});

test("2. lyrical-message-only text is accepted and the step completes", () => {
  const message = "You're doing a great job, you're beautiful, you're a queen";
  const story = resolveStoryOnFreeText({ currentStory: undefined, extractedStory: undefined, userMessage: message });
  assert.equal(story, message);
  assert.equal(nextGuidedStep({ ...READY_FOR_STORY, story }), null);
});

test("3. recipient/relationship-flavored text sent at the story step still completes it", () => {
  const message = "It's a song for my mum";
  const story = resolveStoryOnFreeText({ currentStory: undefined, extractedStory: undefined, userMessage: message });
  assert.equal(story, message);
  assert.equal(nextGuidedStep({ ...READY_FOR_STORY, story }), null);
});

test("4a. 'just go with this detail' with no prior story falls back to the raw text rather than looping", () => {
  const story = resolveStoryOnFreeText({ currentStory: undefined, extractedStory: undefined, userMessage: "Just go with this detail" });
  assert.equal(story, "Just go with this detail");
  assert.equal(nextGuidedStep({ ...READY_FOR_STORY, story }), null);
});

test("4b. 'just go with this detail' with real prior story context is treated as confirmation, not overwritten", () => {
  const priorStory = "He just turned 21 and loves football. I want the song to tell him I'm proud of him.";
  const story = resolveStoryOnFreeText({
    currentStory: priorStory,
    extractedStory: undefined, // LLM extracted nothing new from this confirmation-style reply
    userMessage: "Just go with this detail",
  });
  assert.equal(story, priorStory, "the prior meaningful story must not be clobbered by a generic confirmation phrase");
  assert.equal(nextGuidedStep({ ...READY_FOR_STORY, story }), null);
});

test("5. multiple free-text messages across the same story step are idempotent - first meaningful answer wins", () => {
  const first = resolveStoryOnFreeText({ currentStory: undefined, extractedStory: undefined, userMessage: "Motherhood" });
  assert.equal(first, "Motherhood");

  // A second message arrives in a later turn - currentStory is now what was
  // just resolved, simulating the flow having already advanced/persisted it.
  const second = resolveStoryOnFreeText({ currentStory: first, extractedStory: undefined, userMessage: "Just encouragement for mums" });
  assert.equal(second, "Motherhood", "once answered, a later unrelated message must not silently replace the stored story");
});

test("6. an already-complete draft (story pre-filled before the guided walk ever reaches it) skips straight past the step", () => {
  const alreadyComplete: SongBriefSlots = { ...READY_FOR_STORY, story: "Filled in earlier via a free-text jump-ahead." };
  assert.equal(nextGuidedStep(alreadyComplete), null, "with story already present, nextGuidedStep must not re-ask for it");
});

test("empty/whitespace-only free text does not fabricate a story and does not crash", () => {
  const story = resolveStoryOnFreeText({ currentStory: undefined, extractedStory: undefined, userMessage: "   " });
  assert.equal(story, undefined);
  assert.equal(nextGuidedStep({ ...READY_FOR_STORY, story }), "story", "a genuinely empty reply should still (correctly) leave the step open");
});
