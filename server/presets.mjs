/**
 * Starter groups.
 *
 * Each person is a small set of public taste signals across domains. They are
 * resolved to Qloo entity IDs at run time, so the same presets work in live
 * mode and in fixture mode.
 */

export const PRESETS = Object.freeze([
  {
    id: "crate-digger",
    title: "The crate digger × the tasting menu",
    blurb: "One hunts for rare records, the other books three months ahead.",
    city: "Brooklyn, NY",
    maxPriceLevel: null,
    people: [
      {
        label: "Sam",
        tagline: "Digs for the B-side",
        signals: [
          { name: "Fela Kuti", type: "music" },
          { name: "Alice Coltrane", type: "music" },
          { name: "Burial", type: "music" },
          { name: "99% Invisible", type: "podcast" },
        ],
      },
      {
        label: "Jules",
        tagline: "Reads the menu before arriving",
        signals: [
          { name: "Aesop", type: "brand" },
          { name: "Le Labo", type: "brand" },
          { name: "Severance", type: "tv" },
          { name: "The Secret History", type: "book" },
        ],
      },
    ],
  },
  {
    id: "second-date",
    title: "The second date",
    blurb: "Both are trying to seem more interesting than they are.",
    city: "Los Angeles, CA",
    maxPriceLevel: 3,
    people: [
      {
        label: "Mira",
        tagline: "Cries at films in public",
        signals: [
          { name: "In the Mood for Love", type: "movie" },
          { name: "Piranesi", type: "book" },
          { name: "Alice Coltrane", type: "music" },
        ],
      },
      {
        label: "Theo",
        tagline: "Owns one very good chair",
        signals: [
          { name: "Khruangbin", type: "music" },
          { name: "The Bear", type: "tv" },
          { name: "Muji", type: "brand" },
        ],
      },
    ],
  },
  {
    id: "eleven-pm",
    title: "The 11pm problem",
    blurb: "One wants a night out, the other wants to be home by ten.",
    city: "Austin, TX",
    maxPriceLevel: 2,
    people: [
      {
        label: "Dev",
        tagline: "Peaks after midnight",
        signals: [
          { name: "Burial", type: "music" },
          { name: "Disco Elysium", type: "videogame" },
          { name: "Twin Peaks", type: "tv" },
        ],
      },
      {
        label: "Ruth",
        tagline: "Has a bedtime and defends it",
        signals: [
          { name: "Nina Simone", type: "music" },
          { name: "Normal People", type: "book" },
          { name: "Aesop", type: "brand" },
        ],
      },
    ],
  },
  {
    id: "the-table",
    title: "The table of five",
    blurb: "A birthday dinner where nobody will say what they want.",
    city: "Chicago, IL",
    maxPriceLevel: 3,
    people: [
      {
        label: "Marcus",
        tagline: "Practical to a fault",
        signals: [
          { name: "Patagonia", type: "brand" },
          { name: "Heat", type: "movie" },
          { name: "Khruangbin", type: "music" },
        ],
      },
      {
        label: "Helen",
        tagline: "Has opinions about wallpaper",
        signals: [
          { name: "The Grand Budapest Hotel", type: "movie" },
          { name: "Le Labo", type: "brand" },
          { name: "Khruangbin", type: "music" },
        ],
      },
      {
        label: "Priya",
        tagline: "Books the loudest room in town",
        signals: [
          { name: "Fela Kuti", type: "music" },
          { name: "Chef's Table", type: "tv" },
          { name: "Khruangbin", type: "music" },
        ],
      },
      {
        label: "Owen",
        tagline: "Will eat anything, enjoys nothing",
        signals: [
          { name: "Radiohead", type: "music" },
          { name: "Parasite", type: "movie" },
          { name: "Le Labo", type: "brand" },
        ],
      },
      {
        label: "Dee",
        tagline: "Arrives last, leaves first",
        signals: [
          { name: "Solange", type: "music" },
          { name: "Atlanta", type: "tv" },
          { name: "Le Labo", type: "brand" },
        ],
      },
    ],
  },
]);

export function findPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}
