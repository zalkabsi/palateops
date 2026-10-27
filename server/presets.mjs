/**
 * Starter duos.
 *
 * Each side is a small set of public taste signals across domains. They are
 * resolved to Qloo entity IDs at run time, so the same presets work in live
 * mode and in fixture mode.
 */

export const PRESETS = Object.freeze([
  {
    id: "crate-digger",
    title: "The crate digger × the tasting menu",
    blurb: "One hunts for rare records, the other books three months ahead.",
    city: "Brooklyn, NY",
    a: {
      label: "Sam",
      tagline: "Digs for the B-side",
      signals: [
        { name: "Fela Kuti", type: "music" },
        { name: "Alice Coltrane", type: "music" },
        { name: "Burial", type: "music" },
        { name: "99% Invisible", type: "podcast" },
      ],
    },
    b: {
      label: "Jules",
      tagline: "Reads the menu before arriving",
      signals: [
        { name: "Aesop", type: "brand" },
        { name: "Le Labo", type: "brand" },
        { name: "Severance", type: "tv" },
        { name: "The Secret History", type: "book" },
      ],
    },
  },
  {
    id: "second-date",
    title: "The second date",
    blurb: "Both are trying to seem more interesting than they are.",
    city: "Los Angeles, CA",
    a: {
      label: "Mira",
      tagline: "Cries at films in public",
      signals: [
        { name: "In the Mood for Love", type: "movie" },
        { name: "Piranesi", type: "book" },
        { name: "Alice Coltrane", type: "music" },
      ],
    },
    b: {
      label: "Theo",
      tagline: "Owns one very good chair",
      signals: [
        { name: "Khruangbin", type: "music" },
        { name: "The Bear", type: "tv" },
        { name: "Muji", type: "brand" },
      ],
    },
  },
  {
    id: "eleven-pm",
    title: "The 11pm problem",
    blurb: "One wants a night out, the other wants to be home by ten.",
    city: "Austin, TX",
    a: {
      label: "Dev",
      tagline: "Peaks after midnight",
      signals: [
        { name: "Burial", type: "music" },
        { name: "Disco Elysium", type: "videogame" },
        { name: "Twin Peaks", type: "tv" },
      ],
    },
    b: {
      label: "Ruth",
      tagline: "Has a bedtime and defends it",
      signals: [
        { name: "Nina Simone", type: "music" },
        { name: "Normal People", type: "book" },
        { name: "Aesop", type: "brand" },
      ],
    },
  },
  {
    id: "the-relatives",
    title: "The relatives",
    blurb: "You have known each other for twenty years and have nothing in common.",
    city: "Chicago, IL",
    a: {
      label: "Marcus",
      tagline: "Practical to a fault",
      signals: [
        { name: "Patagonia", type: "brand" },
        { name: "Heat", type: "movie" },
        { name: "Stardew Valley", type: "videogame" },
      ],
    },
    b: {
      label: "Helen",
      tagline: "Has opinions about wallpaper",
      signals: [
        { name: "The Grand Budapest Hotel", type: "movie" },
        { name: "Le Labo", type: "brand" },
        { name: "Sault", type: "music" },
      ],
    },
  },
]);

export function findPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}
