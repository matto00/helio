module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/src/test/jest.setup.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
