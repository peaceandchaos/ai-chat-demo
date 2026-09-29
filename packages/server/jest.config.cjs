module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [
          [
            '@babel/preset-env',
            {
              targets: { node: 'current' },
              exclude: ['transform-dynamic-import'],
            },
          ],
        ],
        plugins: ['@babel/plugin-transform-typescript'],
      },
    ],
  },
};
