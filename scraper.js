const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

function extractJsonArray(html, keyName) {
    const regex = new RegExp(`\\\\"${keyName}\\\\"\\s*:\\s*\\[|["']${keyName}["']\\s*:\\s*\\[`);
    const match = html.match(regex);
    if (!match) return null;
    
    const startIdx = match.index + match[0].length - 1;
    let bracketCount = 0;
    let endIdx = -1;
    
    for (let i = startIdx; i < html.length; i++) {
        if (html[i] === '[') bracketCount++;
        else if (html[i] === ']') {
            bracketCount--;
            if (bracketCount === 0) {
                endIdx = i;
                break;
            }
        }
    }
    
    if (endIdx === -1) return null;
    let rawStr = html.substring(startIdx, endIdx + 1);
    rawStr = rawStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    try {
        return JSON.parse(rawStr);
    } catch (e) {
        return null;
    }
}

function extractUpdateDate(html) {
    const match = html.match(/(?:\\"last_updated\\"|\\"updated_at\\"|["']last_updated["']|["']updated_at["'])\s*:\s*\\?"([^\\"]+)\\?"/);
    if (match) return match[1];
    
    const visibleMatch = html.match(/Last updated:\s*([A-Za-z0-9\s,]+)/i);
    if (visibleMatch) return visibleMatch[1].trim();
    
    return null;
}

async function runScraper() {
    console.log("Initializing Cloudflare bypass via Puppeteer Stealth...");
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to Prydwen characters page...");
        await page.goto('https://www.prydwen.gg/zenless/characters', { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        console.log("DOM content loaded. Waiting 15 seconds for Cloudflare checks and script execution...");
        await new Promise(resolve => setTimeout(resolve, 15000));

        const htmlContent = await page.content();

        if (htmlContent.includes("Just a moment...") || htmlContent.includes("challenge-running")) {
            throw new Error("Cloudflare bypass failed: Browser is stuck on the verification screen.");
        }

        console.log("Extracting raw character data from page content...");
        const rosterCharacters = extractJsonArray(htmlContent, "characters");
        if (!rosterCharacters) {
            throw new Error("Could not find characters array identifier in the page content.");
        }
        
        console.log(`Successfully parsed ${rosterCharacters.length} characters from raw page data.`);

        const processedCharacters = rosterCharacters.map(char => {
            return {
                Id: char.id || "",
                Name: char.name || "",
                Link: char.slug ? `/zenless/characters/${char.slug}` : "",
                Rarity: char.rarity ? `${char.rarity}-Rank` : "",
                Element: char.element || "",
                Style: char.style || "",
                Faction: char.faction || "",
                SmallImage: char.smallImage || ""
            };
        });

        const outputPath = path.join(process.cwd(), 'characters.json');
        fs.writeFileSync(outputPath, JSON.stringify(processedCharacters, null, 2), 'utf-8');
        console.log(`Success! Finalized clean database saved to ${outputPath}`);

        const activeCharacters = processedCharacters.filter(char => char.Element !== "Unknown" && char.Style !== "Unknown");
        console.log(`Filtered roster: ${activeCharacters.length} active characters ready for incremental deep-parsing.`);

        const charactersDir = path.join(process.cwd(), 'characters');
        if (!fs.existsSync(charactersDir)) {
            fs.mkdirSync(charactersDir, { recursive: true });
            console.log(`Created directory: ${charactersDir}`);
        }

        for (const char of activeCharacters) {
            const slug = char.Link.split('/').pop();
            if (!slug) continue;

            const charFilePath = path.join(charactersDir, `${slug}.json`);
            let localLastUpdated = null;

            if (fs.existsSync(charFilePath)) {
                try {
                    const localData = JSON.parse(fs.readFileSync(charFilePath, 'utf-8'));
                    if (localData.Meta && localData.Meta.LastUpdated) {
                        localLastUpdated = localData.Meta.LastUpdated;
                    }
                } catch (e) {
                    console.log(`[Warning] Failed to parse local json cache for ${char.Name}, discarding cache.`);
                }
            }

            console.log(`--------------------------------------------------`);
            console.log(`Processing character data: ${char.Name} (${slug})`);
            
            const targetUrl = `https://www.prydwen.gg${char.Link}`;
            console.log(`Navigating to profile: ${targetUrl}`);
            
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(resolve => setTimeout(resolve, 5000));

                const detailHtml = await page.content();
                const remoteLastUpdated = extractUpdateDate(detailHtml) || new Date().toISOString();

                if (localLastUpdated && remoteLastUpdated === localLastUpdated) {
                    console.log(`[Status] ${char.Name} data is up-to-date (${remoteLastUpdated}). Skipping deep extraction.`);
                    continue;
                }

                console.log(`[Update Detected] Local: ${localLastUpdated} | Remote: ${remoteLastUpdated}. Processing arrays...`);

                const rawEngines = extractJsonArray(detailHtml, "wEngines") || extractJsonArray(detailHtml, "engines") || [];
                const bestWEngines = rawEngines.map(e => ({
                    Name: e.name || e.title || e.id || "Unknown Engine",
                    Rating: e.rating || e.percentage || e.value || "100%"
                }));

                const rawSets = extractJsonArray(detailHtml, "driveSets") || extractJsonArray(detailHtml, "diskSets") || [];
                const bestDiskSets = rawSets.map(s => ({
                    Name: s.name || s.title || "Unknown Set",
                    Rating: s.rating || s.percentage || s.value || "100%"
                }));

                const rawStats = extractJsonArray(detailHtml, "statsPriority") || extractJsonArray(detailHtml, "mainStats") || [];
                const mainStats = rawStats
                    .filter(s => s && (s.slot === "4" || s.slot === "5" || s.slot === "6" || s.slot === 4 || s.slot === 5 || s.slot === 6))
                    .map(s => ({
                        Slot: String(s.slot),
                        Stats: Array.isArray(s.stats) ? s.stats : [s.stats || ""]
                    }));

                const rawCalc = extractJsonArray(detailHtml, "calculations") || extractJsonArray(detailHtml, "mindscapes") || [];
                const calculation = rawCalc.map(c => c.value || c.percentage || c.rating || String(c));

                const finalizedCharacterData = {
                    Meta: {
                        Id: char.Id,
                        Name: char.Name,
                        LastUpdated: remoteLastUpdated
                    },
                    Build: {
                        BestWEngines: bestWEngines,
                        BestDiskSets: bestDiskSets,
                        MainStats: mainStats,
                        SubStats: []
                    },
                    Calculation: calculation
                };

                fs.writeFileSync(charFilePath, JSON.stringify(finalizedCharacterData, null, 2), 'utf-8');
                console.log(`[Success] Saved localized granular cache for ${char.Name} -> ${charFilePath}`);

            } catch (charError) {
                console.error(`[Error] Encountered failure while processing page logic for ${char.Name}:`, charError.message);
            }
        }

    } catch (error) {
        console.error("Scraper execution failed:", error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

runScraper();
