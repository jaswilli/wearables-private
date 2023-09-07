module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-var-requires': 0,
    eqeqeq: ['error', 'always'],
    'prefer-promise-reject-errors': ['error'],
    'space-before-function-paren': [
      'error',
      {
        anonymous: 'always',
        asyncArrow: 'always',
        named: 'never',
      },
    ],
  },
  overrides: [
    // set up linting for .js files
    {
      files: ['**/*.js'],
      extends: ['eslint:recommended', 'prettier'],
    },
  ],
};
