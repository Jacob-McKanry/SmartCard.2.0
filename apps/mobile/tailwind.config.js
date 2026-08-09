/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind only turns `className` into styles for files this glob matches —
  // anything outside src/ (e.g. generated code) is intentionally not scanned.
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
