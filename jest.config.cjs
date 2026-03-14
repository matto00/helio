module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/?(*.)+(spec|test).[tj]s?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/openspec/", "/.cursor/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
