// =====================================================================
//  The only file you need to edit.
// =====================================================================
window.PUZZLE_CONFIG = {
  // From Supabase → Project Settings → API (or "API Keys").
  // Leave both empty to try the pages in demo mode (nothing goes online).
  SUPABASE_URL: "https://cwoxrdiquxvohmsvucie.supabase.co",
  SUPABASE_KEY: "sb_publishable_9IbJl6NzdLkXymFxMFoTdg_t39uPvtJ",          // the "anon" or "publishable" key (never the secret one)

  // How many pieces the puzzle has (pieces are numbered 1 to this number).
  TOTAL_PIECES: 200,

  // Pieces per puzzle: pieces 1-100 belong to the first puzzle, 101-200 to the second.
  FRAME_SIZE: 100,

  // The name of each puzzle, in order (first = pieces 1-100, second = 101-200).
  FRAME_NAMES: [
    { en: "Family puzzle", ar: "بازل العيلة", short_en: "Family", short_ar: "العيلة", ico: "👨‍👩‍👧‍👦" },
    { en: "Friends puzzle", ar: "بازل الأصحاب", short_en: "Friends", short_ar: "الأصحاب", ico: "🥳" },
  ],

  // The couple's names, shown at the top of both pages.
  COUPLE: { en: "Mohamed & Habiba", ar: "محمد وحبيبة" },

  // First names used inside the questions ("Teach Mohamed how to make up with Habiba…").
  NAMES: {
    groom: { en: "Mohamed", ar: "محمد" },   // Mohamed Adel
    bride: { en: "Habiba", ar: "حبيبة" },   // Habiba El Sisi
  },

  // Language the page opens in: "ar" or "en" (guests can switch with one tap).
  DEFAULT_LANG: "ar",

  // Longest voice note, in seconds.
  MAX_VOICE_SECONDS: 90,
};
