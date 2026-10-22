export const referenceDetailProfiles = [
  {
    id: "overview",
    name: "Overview",
    purpose: "Content, narrative and style summary",
    completeShotInventory: false,
  },
  {
    id: "shots",
    name: "Shot breakdown",
    purpose: "Enumerate separate editing shots including short inserts",
    completeShotInventory: "requested-not-guaranteed",
  },
  {
    id: "recreate",
    name: "Recreation",
    purpose:
      "Full shot states, action stages, spatial relations and continuity for generation",
    completeShotInventory: "requested-not-guaranteed",
  },
] as const;
