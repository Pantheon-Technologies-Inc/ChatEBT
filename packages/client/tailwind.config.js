const { createTailwindColors } = require('./src/theme/utils/createTailwindColors.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        ...createTailwindColors(),
        pantheon: {
          secondary: 'rgb(255 198 114)',
        },
      },
    },
  },
  plugins: [],
};
