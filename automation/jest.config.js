module.exports = {
  rootDir: "..",
  testEnvironment: "node",
  testRegex: "automation/tests/.*\\.test\\.js$",
  modulePathIgnorePatterns: [
    "<rootDir>/.claude/",
    "<rootDir>/automation/dashboard/",
    "<rootDir>/automation/datasets/",
    "<rootDir>/automation/runs/"
  ],
  testPathIgnorePatterns: [
    "/node_modules/"
  ]
};
