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
          { name: "Fela Kuti", type: "music", id: "679CEADA-31C3-4A06-99D0-D7384D6693BF" },
          { name: "Alice Coltrane", type: "music", id: "618BD069-B186-4170-BEC6-C1CA5DF373A7" },
          { name: "Burial", type: "music", id: "0A7B9344-E8BB-47A3-BE4B-B48CDC836BDC" },
          { name: "99% Invisible", type: "podcast", id: "1B466B0E-323A-4EFD-A314-8737F58F1E1B" },
        ],
      },
      {
        label: "Jules",
        tagline: "Reads the menu before arriving",
        signals: [
          { name: "Aesop", type: "brand", id: "32F867B9-E6DF-44C3-BCE4-40160C7ED5E4" },
          { name: "Le Labo", type: "brand", id: "25C88914-2BC2-4E6B-A787-A8DD2DD4F45E" },
          { name: "Severance", type: "tv", id: "569F8294-72DA-4935-B9F2-4FC697AB2A1E" },
          { name: "The Secret History", type: "book", id: "4862C8C1-0412-4042-BF3E-D56DEAFEF854" },
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
          { name: "In the Mood for Love", type: "movie", id: "900B6C69-9D86-4153-B8FD-4D6CD726FCF8" },
          { name: "Piranesi", type: "book", id: "55908017-4CFD-4688-9A7E-7B1FF04B171D" },
          { name: "Alice Coltrane", type: "music", id: "618BD069-B186-4170-BEC6-C1CA5DF373A7" },
        ],
      },
      {
        label: "Theo",
        tagline: "Owns one very good chair",
        signals: [
          { name: "Khruangbin", type: "music", id: "BAF6317A-DF94-4C90-92AE-63F86560C21B" },
          { name: "The Bear", type: "tv", id: "4C305B2F-5A46-4885-A6DA-5E22D11E86E0" },
          { name: "Muji", type: "brand", id: "E12201A5-CC50-40AF-97AE-C54A2CA303F7" },
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
          { name: "Burial", type: "music", id: "0A7B9344-E8BB-47A3-BE4B-B48CDC836BDC" },
          { name: "Disco Elysium", type: "videogame", id: "BF4E74F3-8495-4962-B988-1F0E5BF28453" },
          { name: "Twin Peaks", type: "tv", id: "5E978EC5-A44F-4644-A808-FA09644259AA" },
        ],
      },
      {
        label: "Ruth",
        tagline: "Has a bedtime and defends it",
        signals: [
          { name: "Nina Simone", type: "music", id: "AEB7DA4D-D5A8-43F1-9881-74DA17D8D521" },
          { name: "Normal People", type: "book", id: "28D688C4-0760-4042-BEC1-F6EE75E71CC7" },
          { name: "Aesop", type: "brand", id: "32F867B9-E6DF-44C3-BCE4-40160C7ED5E4" },
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
          { name: "Patagonia", type: "brand", id: "DB4CE34E-3A63-4947-946F-9D52502C5762" },
          { name: "Heat", type: "movie", id: "BEB35893-ABB7-4E0C-8D02-65B43CAF74D0" },
          { name: "Khruangbin", type: "music", id: "BAF6317A-DF94-4C90-92AE-63F86560C21B" },
        ],
      },
      {
        label: "Helen",
        tagline: "Has opinions about wallpaper",
        signals: [
          { name: "The Grand Budapest Hotel", type: "movie", id: "DF788007-B5EA-4F29-872B-96BCB8EEC42F" },
          { name: "Le Labo", type: "brand", id: "25C88914-2BC2-4E6B-A787-A8DD2DD4F45E" },
          { name: "Khruangbin", type: "music", id: "BAF6317A-DF94-4C90-92AE-63F86560C21B" },
        ],
      },
      {
        label: "Priya",
        tagline: "Books the loudest room in town",
        signals: [
          { name: "Fela Kuti", type: "music", id: "679CEADA-31C3-4A06-99D0-D7384D6693BF" },
          { name: "Chef's Table", type: "tv", id: "35D9EDC3-DC6A-42A5-B73B-7A18DCF0C024" },
          { name: "Khruangbin", type: "music", id: "BAF6317A-DF94-4C90-92AE-63F86560C21B" },
        ],
      },
      {
        label: "Owen",
        tagline: "Will eat anything, enjoys nothing",
        signals: [
          { name: "Radiohead", type: "music", id: "70CAE5BF-2F4C-445C-A3E5-4EDACFC3591C" },
          { name: "Parasite", type: "movie", id: "A499EC25-7FF6-46DE-9DA5-3E78E99B9E26" },
          { name: "Le Labo", type: "brand", id: "25C88914-2BC2-4E6B-A787-A8DD2DD4F45E" },
        ],
      },
      {
        label: "Dee",
        tagline: "Arrives last, leaves first",
        signals: [
          { name: "Solange", type: "music", id: "9BC770A7-3369-4BB8-A79E-E3440D308489" },
          { name: "Atlanta", type: "tv", id: "459C6C03-CF24-4479-90A4-030B371CF9EC" },
          { name: "Le Labo", type: "brand", id: "25C88914-2BC2-4E6B-A787-A8DD2DD4F45E" },
        ],
      },
    ],
  },
]);

export function findPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}
