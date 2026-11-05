/** @type {import('tailwindcss').Config} */
const { themeColors } = require("./src/theme.config");

function flattenLight(colors) {
  return Object.fromEntries(Object.entries(colors).map(([name, { light }]) => [name, light]));
}

module.exports = {
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: flattenLight(themeColors),
    },
  },
  plugins: [],
};
