/**
 * This config exists for Jest only.
 *
 * Create React App pins `babelrc: false, configFile: false` in its webpack
 * setup, so `react-scripts build` and `react-scripts start` do NOT read this
 * file — they use babel-preset-react-app. Targeting current Node here is
 * therefore safe and does not affect the shipped bundle.
 *
 * `runtime: 'automatic'` is required: several components (ChatInput, Log, …)
 * use JSX without importing React.
 */
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
