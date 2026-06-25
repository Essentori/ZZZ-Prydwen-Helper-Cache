const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function runScraper() {
    console.log("Initializing Cloudflare bypass via Puppeteer Stealth...");
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to Prydwen characters page...");
        await page.goto('https://www.prydwen.gg/zenless/characters', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        console.log("Waiting for Cloudflare JavaScript challenge to resolve...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        const htmlContent = await page.content();

        if (htmlContent.includes("Just a moment...") || htmlContent.includes("challenge-running")) {
            throw new Error("Cloudflare bypass failed: Browser is stuck on the verification screen.");
        }

        fs.writeFileSync('characters_page.txt', htmlContent, 'utf-8');
        console.log("Success! Extracted page content saved to characters_page.txt");

    } catch (error) {
        console.error("Scraper execution failed:", error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

runScraper();
