// eslint.config.js
module.exports = [
  {
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
    languageOptions: {
      globals: {
        node: true,
      },
    },
  },
];