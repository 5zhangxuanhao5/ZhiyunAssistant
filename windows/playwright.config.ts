import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',timeout:45000,expect:{timeout:10000},workers:1,reporter:[['list'],['html',{open:'never'}]],use:{trace:'retain-on-failure'},outputDir:'test-results'});
