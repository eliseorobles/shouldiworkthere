import {defineConfig} from '@playwright/test';
// Runs every tests/browser*.spec.ts against a local stack (node tools/dev.mjs) or PREVIEW_URL. Specs stub /api/canvas
// wherever a hosted interpretation would otherwise make them nondeterministic.
export default defineConfig({testDir:'./tests',testMatch:/browser.*\.spec\.ts$/,workers:1,timeout:30000,expect:{timeout:8000},use:{baseURL:process.env.PREVIEW_URL??'http://localhost:8788',headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure'},reporter:'list'});
