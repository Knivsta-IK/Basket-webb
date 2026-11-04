import { test, expect } from '@playwright/test';
import { openAccess } from '../src/access.js';
test('mobilinställning lämnar bara krypterad data att dela', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('https://api.github.com/repos/Knivsta-IK/Basket',route=>route.fulfill({json:{full_name:'Knivsta-IK/Basket',private:true}}));
  await page.goto('/installera.html');await page.getByLabel('Åtkomstnyckel',{exact:true}).fill('github_pat_only_test');await page.getByLabel('Välj lösenord',{exact:true}).fill('slumpade ord bildar en fras');await page.getByLabel('Skriv lösenordet igen',{exact:true}).fill('slumpade ord bildar en fras');await page.getByRole('button',{name:'Skapa krypterad inställning'}).click();
  await expect(page.locator('#setup-result')).toBeVisible();const cipher=await page.locator('#encrypted-result').inputValue();expect(cipher).not.toContain('github_pat_only_test');expect(cipher).not.toContain('slumpade ord bildar en fras');expect(await openAccess(JSON.parse(cipher),'slumpade ord bildar en fras')).toBe('github_pat_only_test');await expect(page.locator('#setup-token')).toHaveValue('');await expect(page.locator('#setup-password')).toHaveValue('');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
