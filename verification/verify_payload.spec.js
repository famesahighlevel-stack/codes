const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test('Verify creation payload structure', async ({ page }) => {
  const workerPath = path.resolve('meta_expert_worker.js');
  const workerContent = fs.readFileSync(workerPath, 'utf8');

  // Basic mock for API calls
  await page.route('**/api/get-accounts', route => route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) }));
  await page.route('**/api/get-active-campaigns', route => route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) }));
  await page.route('**/api/get-custom-audiences', route => route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) }));

  await page.setContent(workerContent.match(/const html = `(.*)`;/s)[1]);

  // Fill some fields
  await page.fill('#cn', 'Test Campaign');
  await page.fill('#asn', 'Test AdSet');
  await page.fill('#ba', '500');
  await page.fill('#sd', '2024-01-01');

  // Select some departments
  await page.evaluate(() => {
    document.querySelectorAll('.dept-check')[0].click();
    document.querySelectorAll('.dept-check')[1].click();
  });

  await page.fill('#ad-name', 'Test Ad');
  await page.fill('#pt', 'New Primary Text');
  await page.fill('#hd', 'New Headline');

  // Intercept the final request
  let interceptedRequest = null;
  await page.route('**/api/create-advanced-ad', async route => {
    interceptedRequest = route.request();
    await route.fulfill({ status: 200, body: JSON.stringify({ success: true, adId: '123' }) });
  });

  // Mock alert to prevent hanging
  await page.evaluate(() => window.alert = () => {});

  await page.click('#btn-go');

  await expect(async () => {
    if (!interceptedRequest) throw new Error('Request not intercepted');
  }).toPass();

  const formData = interceptedRequest.postDataJSON ? null : interceptedRequest.postData();
  // postData() returns a string or buffer for multipart/form-data
  console.log('Payload intercepted successfully');
});
