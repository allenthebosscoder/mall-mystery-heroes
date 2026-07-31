/**
 * Two projects, one runner.
 *
 *   unit  — node environment, no DOM, no Firebase. Pure game rules and helpers.
 *           Files: src/game/**\/*.test.js, src/utils/**\/*.test.js, functions/**\/*.test.js
 *   dom   — jsdom + Testing Library. React components only.
 *           Files: src/**\/*.test.jsx
 *
 * The `.js` / `.jsx` split on test files is what routes a test to an
 * environment. A test that needs a DOM is named `.test.jsx`.
 *
 * See docs/testing.md for what belongs in each layer.
 */

/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      clearMocks: true,
      testMatch: [
        '<rootDir>/src/game/**/*.test.js',
        '<rootDir>/src/utils/**/*.test.js',
        '<rootDir>/functions/**/*.test.js',
      ],
      testPathIgnorePatterns: ['/node_modules/'],
    },
    {
      displayName: 'dom',
      testEnvironment: 'jsdom',
      clearMocks: true,
      testMatch: ['<rootDir>/src/**/*.test.jsx'],
      testPathIgnorePatterns: ['/node_modules/'],
      setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
      moduleNameMapper: {
        '\\.(css|less|scss)$': '<rootDir>/test/styleStub.js',
        '\\.(png|jpe?g|gif|svg|webp|avif)$': '<rootDir>/test/fileStub.js',
      },
    },
  ],

  // Coverage is opt-in via `npm run test:coverage`. Collecting it on every run
  // in a repo this early just prints a wall of 0%.
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/game/**/*.js',
    'src/utils/**/*.js',
    '!src/**/*.test.js',
  ],
};

module.exports = config;
