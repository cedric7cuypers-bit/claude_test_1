const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 10_000,
  expect: { timeout: 3_000 },
  fullyParallel: true,
  reporter: 'list',
  use: {
    // Open files directly — no server needed for plain HTML
    baseURL: 'file://' + path.resolve(__dirname).replace(/\\/g, '/'),
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
