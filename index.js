const express = require('express');
const puppeteer = require('puppeteer');
const app = express();

app.use(express.json());

app.post('/validate-code', async (req, res) => {
  const { store_url, code, product_url } = req.body;
  
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    
    console.log(`[${code}] Visiting product: ${product_url}`);
    await page.goto(product_url, { waitUntil: 'networkidle2' });
    
    // STEP 2: GET ORIGINAL PRICE (Noon)
    const originalPrice = await page.evaluate(() => {
      const selector = '[data-qa="div-price-now"]';
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : 'N/A';
    });
    
    console.log(`[${code}] Original price: ${originalPrice}`);
    
    // STEP 3: ADD TO CART (Noon)
    try {
      const addToCartSelector = '.QuickAtc-module-scss-module__x7ROma__atcCta';
      await page.click(addToCartSelector);
      console.log(`[${code}] Added to cart`);
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log(`[${code}] Add to cart failed: ${err.message}`);
    }
    
    // STEP 4: GO TO CART (Noon)
    const cartPath = '/saudi-en/cart/';   // from href on cart link [web:3]
    const cartUrl = new URL(store_url).origin + cartPath;
    
    console.log(`[${code}] Navigating to cart: ${cartUrl}`);
    try {
      await page.goto(cartUrl, { waitUntil: 'networkidle2' });
    } catch (err) {
      console.log(`[${code}] Cart navigation warning: ${err.message}`);
    }
    
    // STEP 5: PROMO INPUT (Noon)
    const codeInputSelector = '[data-qa="cart-input_coupon_code"]';
    const codeInput = await page.$(codeInputSelector).catch(() => null);
    
    if (!codeInput) {
      await browser.close();
      return res.json({
        code,
        valid: 'ERROR',
        reason: 'Promo code input field not found',
        original_price: originalPrice,
        final_price: 'N/A'
      });
    }
    
    console.log(`[${code}] Found promo input, typing code`);
    await codeInput.type(code);
    await page.waitForTimeout(1000);
    
    // STEP 6: APPLY BUTTON (Noon)
    const applyButtonSelector = '[data-qa="cart-apply_coupon_code"]';
    const applyBtn = await page.$(applyButtonSelector).catch(() => null);
    
    if (applyBtn) {
      console.log(`[${code}] Clicking apply button`);
      await applyBtn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log(`[${code}] Apply button not found, pressing Enter instead`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }
    
    // STEP 7: FINAL TOTAL (Noon)
    const finalPrice = await page.evaluate(() => {
      const totalSelector = '.CartInvoiceSummary-module-scss-module__97FMcq__column.CartInvoiceSummary-module-scss-module__97FMcq__largerText';
      const errorSelector = '.error, .alert-danger, [class*="error"]';
      
      const totalEl = document.querySelector(totalSelector);
      const total = totalEl ? totalEl.textContent.trim() : 'N/A';
      const errorMsg = document.querySelector(errorSelector)?.textContent.trim() || '';
      
      return { total, errorMsg };
    });
    
    console.log(`[${code}] Final price: ${finalPrice.total}`);
    console.log(`[${code}] Error message: ${finalPrice.errorMsg}`);
    
    // STEP 8: DETERMINE IF DISCOUNT APPLIED
    const discountApplied = (
      originalPrice !== finalPrice.total && 
      finalPrice.total !== 'N/A' &&
      !finalPrice.errorMsg
    );
    
    await browser.close();
    
    return res.json({
      code,
      valid: discountApplied ? 'PASS' : 'FAIL',
      original_price: originalPrice,
      final_price: finalPrice.total,
      error_message: finalPrice.errorMsg || 'None',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[${code}] Fatal error: ${error.message}`);
    if (browser) await browser.close();
    
    return res.json({
      code,
      valid: 'ERROR',
      reason: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'running', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Validation server running on port ${PORT}`));
