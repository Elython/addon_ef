// background.js - DemonicScans Energy Farmer Background Engine

let activeLoopRunning = false;
let workingUrlTemplate = null;
let persistentBgTabId = null;

chrome.runtime.onInstalled.addListener(() => {
    clearNetRules();
    chrome.storage.local.get(["debugMode", "mangaHistory", "farmerState", "logs", "debugLogs"], (res) => {
        if (res.debugMode === undefined) chrome.storage.local.set({ debugMode: false });
        if (!res.mangaHistory) chrome.storage.local.set({ mangaHistory: {} });
        if (!res.logs) chrome.storage.local.set({ logs: [] });
        if (!res.debugLogs) chrome.storage.local.set({ debugLogs: [] });
        if (!res.farmerState) {
            chrome.storage.local.set({
                farmerState: {
                    isRunning: false,
                    isPaused: false,
                    mangaName: "",
                    startCh: 1,
                    endCh: 1,
                    currentCh: 1,
                    delayMs: 500,
                    statusText: "Idle"
                }
            });
        }
    });
});

// Format HTTP errors for Debug Console
function formatResponseError(status, statusText, text) {
    let bodyPreview = text ? text.trim() : "(Empty response body)";
    if (bodyPreview.includes("<html") || bodyPreview.includes("<!DOCTYPE") || bodyPreview.includes("<head")) {
        let titleMatch = bodyPreview.match(/<title>(.*?)<\/title>/i);
        let title = titleMatch ? titleMatch[1] : "HTML Page";
        let textOnly = bodyPreview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        bodyPreview = `[HTML Title: "${title}"] Snippet: ${textOnly.substring(0, 200)}...`;
    }
    return `Status: ${status} ${statusText || ''} | Details: ${bodyPreview}`;
}

// Robust cookie merger across domain, root URL, and www URL
async function getEssentialCookieString() {
    try {
        let list1 = (await chrome.cookies.getAll({ domain: "demonicscans.org" })) || [];
        let list2 = (await chrome.cookies.getAll({ url: "https://demonicscans.org" })) || [];
        let list3 = (await chrome.cookies.getAll({ url: "https://www.demonicscans.org" })) || [];

        let map = new Map();
        [...list1, ...list2, ...list3].forEach(c => {
            if (c && c.name && !c.name.startsWith("reacted_chap_") && !c.name.startsWith("veyra_chat_")) {
                map.set(c.name, c.value);
            }
        });

        if (map.size > 0) {
            let pairs = [];
            for (let [k, v] of map.entries()) {
                pairs.push(`${k}=${v}`);
            }
            let cookieStr = pairs.join("; ");
            debugLog(`Merged ${map.size} essential cookies (${cookieStr.substring(0, 70)}...)`);
            return cookieStr;
        } else {
            debugLog("Warning: No cookies found for demonicscans.org");
        }
    } catch (err) {
        debugLog(`Error gathering cookies: ${err.message}`);
    }
    return "";
}

// Clear any declarativeNetRequest dynamic rules so browser handles headers authentically
async function clearNetRules() {
    try {
        if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [1]
            });
            debugLog("Cleared declarativeNetRequest rules.");
        }
    } catch (e) {
        // ignore
    }
}

// Wait for a tab to finish loading
function waitForTabComplete(tabId, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let isResolved = false;
        let timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(false);
            }
        }, timeoutMs);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timer);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(true);
                }
            }
        }

        chrome.tabs.onUpdated.addListener(listener);

        chrome.tabs.get(tabId).then(tab => {
            if (tab && tab.status === "complete" && !isResolved) {
                isResolved = true;
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(true);
            }
        }).catch(() => {});
    });
}

// Get or reuse an open DemonicScans tab for 1st-party requests
async function getOrCreateBackgroundTab() {
    try {
        if (persistentBgTabId) {
            try {
                let existing = await chrome.tabs.get(persistentBgTabId);
                if (existing && existing.url && existing.url.includes("demonicscans.org")) {
                    return persistentBgTabId;
                }
            } catch (e) {
                persistentBgTabId = null;
            }
        }

        let tabs = await chrome.tabs.query({ url: "*://*.demonicscans.org/*" });
        if (tabs && tabs.length > 0) {
            let readyTab = tabs.find(t => t.status === "complete") || tabs[0];
            persistentBgTabId = readyTab.id;
            return persistentBgTabId;
        }

        let newTab = await chrome.tabs.create({ url: "https://demonicscans.org/", active: false });
        persistentBgTabId = newTab.id;
        await waitForTabComplete(newTab.id, 8000);
        return persistentBgTabId;
    } catch (e) {
        debugLog(`Background tab helper error: ${e.message}`);
        return null;
    }
}

// Fast in-tab reaction fetch without navigating the tab (takes ~100ms)
async function executeFastUpvoteInTab(tabId, chapterId, userUid) {
    try {
        let scriptOptions = {
            target: { tabId: tabId },
            func: (chapId, uid) => {
                return new Promise((resolve) => {
                    let formData = new FormData();
                    formData.append("chapterid", String(chapId));
                    formData.append("reaction", "1");
                    formData.append("useruid", String(uid));

                    fetch("/postreaction.php", {
                        method: "POST",
                        body: formData
                    })
                    .then(async r => {
                        let text = await r.text();
                        resolve({ status: r.status, ok: r.ok, text });
                    })
                    .catch(e => resolve({ status: 0, ok: false, error: e.message }));
                });
            },
            args: [chapterId, userUid]
        };

        if (chrome.scripting && chrome.scripting.ExecutionWorld) {
            scriptOptions.world = chrome.scripting.ExecutionWorld.MAIN;
        }

        let results = await chrome.scripting.executeScript(scriptOptions);
        if (results && results[0] && results[0].result) {
            return results[0].result;
        }
    } catch (e) {
        debugLog(`Fast in-tab upvote error: ${e.message}`);
    }
    return null;
}

// Execute upvote directly inside the live chapter page context (Fallback with tab navigation)
async function executeUpvoteOnChapterPage(tabId, targetUrl) {
    try {
        debugLog(`Navigating tab to ${targetUrl}...`);
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForTabComplete(tabId, 10000);

        // Allow 400ms for Cloudflare challenge & DOM scripts to settle
        await new Promise(r => setTimeout(r, 400));

        let scriptOptions = {
            target: { tabId: tabId },
            func: () => {
                return new Promise(async (resolve) => {
                    try {
                        let html = document.documentElement.innerHTML;

                        // Check Cloudflare block/challenge
                        if (document.title.includes("Just a moment...") || html.includes("challenge-platform")) {
                            if (document.querySelector('#challenge-stage') || document.querySelector('.cf-turnstile-wrapper')) {
                                resolve({ isCloudflare: true });
                                return;
                            }
                        }

                        // Check 404
                        if (document.title.includes("404") || document.title.includes("Not Found")) {
                            resolve({ is404: true });
                            return;
                        }

                        // Check Sign in
                        if (html.includes("Sign in to your account") && !document.querySelector('.reaction')) {
                            resolve({ isLoggedOut: true });
                            return;
                        }

                        // Extract chapter ID and user UID from live DOM/scripts
                        let chapMatch = html.match(/reacted_chap_(\d+)/i) ||
                                        html.match(/formData\.append\(\s*['"]chapterid['"]\s*,\s*['"]?(\d+)['"]?\s*\)/i) ||
                                        html.match(/submitcomment\s*\([^,]+,\s*['"]?(\d+)['"]?/i);
                        let chapterId = chapMatch ? chapMatch[1] : null;

                        let uid = typeof userUID !== 'undefined' ? userUID : null;
                        if (!uid) {
                            const uidCookie = document.cookie.split('; ').find(row => row.startsWith('useruid='));
                            if (uidCookie) uid = uidCookie.split('=')[1];
                        }

                        // Click the reaction button directly on the page
                        const reactionBtn = document.querySelector('.reaction[data-reaction="1"]') || 
                                            document.querySelector('.reaction');
                        let clicked = false;
                        if (reactionBtn) {
                            reactionBtn.click();
                            clicked = true;
                        }

                        // Also send fetch in the live chapter page context to guarantee reaction submission
                        if (chapterId && uid) {
                            let formData = new FormData();
                            formData.append("chapterid", String(chapterId));
                            formData.append("reaction", "1");
                            formData.append("useruid", String(uid));

                            let resp = await fetch("/postreaction.php", {
                                method: "POST",
                                body: formData
                            });

                            let text = await resp.text();
                            let trimmed = text.trim().toLowerCase();
                            let ok = (resp.status === 200) && (trimmed === "updated" || trimmed === "added" || trimmed.includes("updated") || trimmed.includes("added"));
                            
                            resolve({
                                success: ok || clicked,
                                status: resp.status,
                                text: text,
                                chapterId: chapterId
                            });
                            return;
                        }

                        if (clicked) {
                            resolve({ success: true, status: 200, text: "Reaction clicked", chapterId });
                            return;
                        }

                        resolve({ success: false, status: 404, text: "No reaction button found", chapterId });
                    } catch (err) {
                        resolve({ success: false, error: err.message });
                    }
                });
            }
        };

        if (chrome.scripting && chrome.scripting.ExecutionWorld) {
            scriptOptions.world = chrome.scripting.ExecutionWorld.MAIN;
        }

        let results = await chrome.scripting.executeScript(scriptOptions);
        if (results && results[0] && results[0].result) {
            return results[0].result;
        }
    } catch (e) {
        debugLog(`Upvote chapter page error: ${e.message}`);
    }
    return null;
}

// Alarm heartbeat for MV3 execution
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "farmerHeartbeat") {
        checkAndContinueFarming();
    }
});

// Broadcast standard log
function broadcastLog(text, isError = false, isWarn = false) {
    console.log(`[Farmer] ${text}`);
    let timestamp = new Date().toLocaleTimeString();
    let entry = { time: timestamp, text, isError, isWarn };

    chrome.runtime.sendMessage({ type: "log", entry }).catch(() => {});

    chrome.storage.local.get(["logs"], (res) => {
        let logs = res.logs || [];
        logs.push(entry);
        if (logs.length > 500) logs = logs.slice(logs.length - 500);
        chrome.storage.local.set({ logs });
    });
}

// Broadcast debug log
function debugLog(text) {
    chrome.storage.local.get(["debugMode"], (res) => {
        if (!res.debugMode) return;
        console.log(`[DEBUG] ${text}`);
        let timestamp = new Date().toLocaleTimeString();
        let entry = { time: timestamp, text };

        chrome.runtime.sendMessage({ type: "debugLog", entry }).catch(() => {});

        chrome.storage.local.get(["debugLogs"], (res) => {
            let debugLogs = res.debugLogs || [];
            debugLogs.push(entry);
            if (debugLogs.length > 1000) debugLogs = debugLogs.slice(debugLogs.length - 1000);
            chrome.storage.local.set({ debugLogs });
        });
    });
}

// Message router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startFarming") {
        startFarmingTask(request.mangaName, request.startCh, request.endCh, request.delayMs || 500);
        sendResponse({ success: true });
    } else if (request.action === "pauseFarming") {
        pauseFarmingTask("User paused farming.");
        sendResponse({ success: true });
    } else if (request.action === "resumeFarming") {
        resumeFarmingTask();
        sendResponse({ success: true });
    } else if (request.action === "stopFarming") {
        stopFarmingTask("Farming stopped by user.");
        sendResponse({ success: true });
    } else if (request.action === "clearLogs") {
        chrome.storage.local.set({ logs: [], debugLogs: [] });
        sendResponse({ success: true });
    }
    return true;
});

// Robust Manga Slug Parser
function parseMangaSlug(input) {
    if (!input) return "";
    let str = input.trim();

    if (str.includes("title/")) {
        let match = str.match(/title\/([^\/\?#]+)/i);
        if (match) str = match[1];
    } else if (str.includes("manga/")) {
        let match = str.match(/manga\/([^\/\?#]+)/i);
        if (match) str = match[1];
    } else {
        str = str.replace(/^https?:\/\/[^\/]+\//i, '');
        str = str.split('/')[0];
    }

    str = str.replace(/\.+$/, '');
    return str;
}

// Generate candidate slug variations for tricky manga titles
function getSlugCandidates(rawSlug) {
    let candidates = [rawSlug];

    try {
        let decoded = decodeURIComponent(rawSlug);
        candidates.push(decoded);
        if (decoded.includes("%")) {
            candidates.push(decodeURIComponent(decoded));
        }
    } catch (e) {}

    candidates.forEach(s => {
        candidates.push(s.replace(/%252C|%2C|,/gi, ''));
        candidates.push(s.replace(/%252C|%2C|,/gi, '-'));
        candidates.push(s.replace(/%252C|%2C|,/gi, '%2C'));
    });

    let finalSet = new Set();
    candidates.forEach(c => {
        let cleaned = c.trim().replace(/\s+/g, '-').replace(/\.+$/, '');
        if (cleaned) finalSet.add(cleaned);
    });

    return Array.from(finalSet);
}

// Robust Chapter ID Extractor specifically targeting DemonicScans structure
function extractChapterId(htmlText) {
    if (!htmlText) return null;

    // 1. formData.append('chapterid', '103096') or ['"]chapterid['"], '103096'
    let match = htmlText.match(/formData\.append\(\s*['"]chapterid['"]\s*,\s*['"]?(\d{2,12})['"]?\s*\)/i) ||
                htmlText.match(/['"]chapterid['"]\s*,\s*['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    // 2. Cookie name check: reacted_chap_103096
    match = htmlText.match(/reacted_chap_(\d{2,12})/i);
    if (match) return match[1];

    // 3. submitcomment call in site script: submitcomment(..., '103096', ...)
    match = htmlText.match(/submitcomment\s*\([^,]+,\s*['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    // 4. Exact chapter ID attribute or variable
    match = htmlText.match(/(?:chapter_?id|chap_?id|chapterid)\s*[:=]\s*['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    // 5. React / vote function parameters
    match = htmlText.match(/(?:react|postReaction|reaction|likeChapter|upvoteChapter|vote)\s*\(\s*['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    // 6. Explicit data-chapter-id or data-chap-id (Do NOT use generic data-id to avoid comment IDs)
    match = htmlText.match(/data-(?:chapter-?id|chap-?id)=['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    // 7. Input fields named chapterid
    match = htmlText.match(/name=['"]?(?:chapter_?id|chap_?id)['"]?\s+value=['"]?(\d{2,12})['"]?/i) ||
            htmlText.match(/value=['"]?(\d{2,12})['"]?\s+name=['"]?(?:chapter_?id|chap_?id)['"]?/i);
    if (match) return match[1];

    // 8. Element ID with chapter_12345
    match = htmlText.match(/id=['"]?(?:chapter|chap)_?(\d{2,12})['"]?/i);
    if (match) return match[1];

    // 9. postreaction.php?chapter_id=12345
    match = htmlText.match(/(?:postreaction\.php|reaction\.php|chapter)\?(?:[a-z0-9_]+=[^&]*&)*?(?:chapter_?id|chapterid|chap_?id)=(\d{2,12})/i);
    if (match) return match[1];

    return null;
}

function extractUserUidFromHtml(htmlText) {
    if (!htmlText) return null;
    let match = htmlText.match(/useruid\s*[:=]\s*['"]?([a-zA-Z0-9_\-]+)['"]?/i) || 
                htmlText.match(/name=['"]useruid['"]\s+value=['"]?([a-zA-Z0-9_\-]+)['"]?/i) ||
                htmlText.match(/userUID\s*=\s*['"]?([a-zA-Z0-9_\-]+)['"]?/i);
    if (match) return match[1];
    return null;
}

function generateFallbackUserUid() {
    return 'uid-' + Math.random().toString(36).substring(2, 16) + Date.now();
}

async function getUserUid() {
    try {
        let cookie = await chrome.cookies.get({ url: "https://demonicscans.org", name: "useruid" }) 
                  || await chrome.cookies.get({ url: "https://www.demonicscans.org", name: "useruid" });
                  
        if (cookie && cookie.value) {
            debugLog(`Found exact cookie useruid: ${cookie.value.substring(0, 5)}...`);
            return cookie.value;
        }

        let cookies = await chrome.cookies.getAll({ domain: "demonicscans.org", name: "useruid" });
        if (cookies && cookies.length > 0) {
            debugLog(`Found domain cookie useruid: ${cookies[0].value.substring(0, 5)}...`);
            return cookies[0].value;
        }
    } catch (err) {
        debugLog(`Cookie reading error: ${err.message}`);
    }
    return null;
}

async function startFarmingTask(mangaInput, startCh, endCh, delayMs = 500) {
    await clearNetRules();
    let mangaSlug = parseMangaSlug(mangaInput);
    if (!mangaSlug) {
        broadcastLog("[ERROR] Invalid manga name or URL provided.", true);
        return;
    }

    workingUrlTemplate = null;

    let state = {
        isRunning: true,
        isPaused: false,
        mangaName: mangaSlug,
        startCh: parseInt(startCh),
        endCh: parseInt(endCh),
        currentCh: parseInt(startCh),
        delayMs: parseInt(delayMs) || 500,
        statusText: `Starting ${mangaSlug} (Ch ${startCh} to ${endCh})`
    };

    await chrome.storage.local.set({ farmerState: state });
    chrome.alarms.create("farmerHeartbeat", { periodInMinutes: 0.5 });
    
    broadcastLog(`[START] Upvote sequence: ${mangaSlug} (Ch ${startCh} to ${endCh})`);
    broadcastLog(`[INFO] Delay set to ${(state.delayMs / 1000).toFixed(1)}s per chapter.`);
    debugLog(`Task params: Manga=${mangaSlug}, Start=${startCh}, End=${endCh}, Delay=${state.delayMs}ms`);

    runFarmingLoop();
}

async function checkAndContinueFarming() {
    let res = await chrome.storage.local.get(["farmerState"]);
    let state = res.farmerState;
    if (state && state.isRunning && !state.isPaused && !activeLoopRunning) {
        debugLog("Heartbeat wake-up triggered loop continuation.");
        runFarmingLoop();
    }
}

async function pauseFarmingTask(reason) {
    let res = await chrome.storage.local.get(["farmerState"]);
    let state = res.farmerState || {};
    state.isPaused = true;
    state.statusText = `Paused: ${reason}`;
    await chrome.storage.local.set({ farmerState: state });
    broadcastLog(`[PAUSE] ${reason}`, false, true);
    debugLog(`Task paused. Reason: ${reason}`);
}

async function resumeFarmingTask() {
    let res = await chrome.storage.local.get(["farmerState"]);
    let state = res.farmerState || {};
    if (!state.isRunning) return;
    state.isPaused = false;
    state.statusText = `Resuming ${state.mangaName} at Ch ${state.currentCh}...`;
    await chrome.storage.local.set({ farmerState: state });
    broadcastLog(`[RESUME] Continuing ${state.mangaName} from Ch ${state.currentCh}`);
    debugLog(`Task resumed at Ch ${state.currentCh}`);
    runFarmingLoop();
}

async function stopFarmingTask(reason) {
    activeLoopRunning = false;
    chrome.alarms.clear("farmerHeartbeat");
    let res = await chrome.storage.local.get(["farmerState"]);
    let state = res.farmerState || {};
    state.isRunning = false;
    state.isPaused = false;
    state.statusText = `Stopped: ${reason}`;
    await chrome.storage.local.set({ farmerState: state });
    broadcastLog(`[STOP] ${reason}`, true);
    debugLog(`Task stopped. Reason: ${reason}`);
}

async function recordCompletedChapter(mangaName, chapterNum) {
    let res = await chrome.storage.local.get(["mangaHistory"]);
    let history = res.mangaHistory || {};

    if (!history[mangaName]) {
        history[mangaName] = {
            mangaName: mangaName,
            completedChapters: [],
            lastUpdated: new Date().toISOString(),
            totalUpvoted: 0
        };
    }

    let mangaRecord = history[mangaName];
    if (!mangaRecord.completedChapters.includes(chapterNum)) {
        mangaRecord.completedChapters.push(chapterNum);
        mangaRecord.completedChapters.sort((a, b) => a - b);
        mangaRecord.totalUpvoted = mangaRecord.completedChapters.length;
    }
    mangaRecord.lastUpdated = new Date().toISOString();

    history[mangaName] = mangaRecord;
    await chrome.storage.local.set({ mangaHistory: history });
    
    chrome.runtime.sendMessage({ type: "historyUpdated", mangaName, history }).catch(() => {});
}

async function fetchChapterWithFallbacks(rawMangaSlug, ch) {
    let slugCandidates = getSlugCandidates(rawMangaSlug);
    let candidateUrls = [];

    if (workingUrlTemplate) {
        candidateUrls.push(workingUrlTemplate.replace("{ch}", ch));
    }

    slugCandidates.forEach(slug => {
        candidateUrls.push(`https://demonicscans.org/title/${slug}/chapter/${ch}/`);
        candidateUrls.push(`https://demonicscans.org/title/${slug}/chapter/${ch}/1`);
        candidateUrls.push(`https://demonicscans.org/title/${slug}/chapter/${ch}`);
        candidateUrls.push(`https://demonicscans.org/manga/${slug}/chapter/${ch}`);
    });

    candidateUrls = Array.from(new Set(candidateUrls));

    for (let url of candidateUrls) {
        debugLog(`[Ch ${ch}] Attempting URL: ${url}`);
        try {
            let response = await fetch(url, { credentials: 'include' });
            let htmlText = await response.text();
            debugLog(`[Ch ${ch}] ${url} -> Status: ${response.status}, HTML length: ${htmlText.length}`);

            if (htmlText.includes("Just a moment...") || response.status === 403 || response.status === 503) {
                return { isCloudflare: true, url };
            }

            if (response.status === 200 && htmlText.length > 200) {
                let chapterId = extractChapterId(htmlText);
                if (chapterId) {
                    let basePattern = url.replace(`/chapter/${ch}/1`, '/chapter/{ch}/1')
                                         .replace(`/chapter/${ch}/`, '/chapter/{ch}/')
                                         .replace(`/chapter/${ch}`, '/chapter/{ch}');
                    workingUrlTemplate = basePattern;
                    
                    return { success: true, url, htmlText, chapterId, status: 200 };
                }
            }
        } catch (err) {
            debugLog(`[Ch ${ch}] Error fetching ${url}: ${err.message}`);
        }
    }

    return { success: false, status: 404 };
}

async function runFarmingLoop() {
    if (activeLoopRunning) return;
    activeLoopRunning = true;

    try {
        let tabId = await getOrCreateBackgroundTab();
        if (!tabId) {
            broadcastLog("[ERROR] Unable to open or access DemonicScans tab.", true);
            await pauseFarmingTask("No tab available.");
            activeLoopRunning = false;
            return;
        }

        while (true) {
            let res = await chrome.storage.local.get(["farmerState"]);
            let state = res.farmerState;

            if (!state || !state.isRunning || state.isPaused) {
                activeLoopRunning = false;
                return;
            }

            if (state.currentCh > state.endCh) {
                broadcastLog(`[COMPLETE] Farming complete for ${state.mangaName}! (Ch ${state.startCh} - ${state.endCh})`);
                debugLog(`Reached end chapter ${state.endCh}. Finishing task.`);
                await stopFarmingTask(`Completed range Ch ${state.startCh} to ${state.endCh}`);
                activeLoopRunning = false;
                return;
            }

            let ch = state.currentCh;
            state.statusText = `Processing Chapter ${ch} / ${state.endCh}...`;
            await chrome.storage.local.set({ farmerState: state });

            broadcastLog(`[*] Processing Chapter ${ch}...`, false, true);

            // Re-verify tab existence
            tabId = await getOrCreateBackgroundTab();
            if (!tabId) {
                broadcastLog("[ERROR] DemonicScans tab closed or not found.", true);
                await pauseFarmingTask("Tab closed.");
                activeLoopRunning = false;
                return;
            }

            let userUid = await getUserUid();
            if (!userUid) userUid = generateFallbackUserUid();

            let upvoteSuccess = false;
            let finalChapterId = null;

            // 1. FAST PATH: Fetch chapter HTML in background (~100ms) and post reaction in tab (~50ms)
            let fetchResult = await fetchChapterWithFallbacks(state.mangaName, ch);

            if (fetchResult && fetchResult.isCloudflare) {
                broadcastLog(`[ERROR] Cloudflare Verification Required on Chapter ${ch}!`, true);
                debugLog(`Cloudflare challenge detected on Chapter ${ch}`);
                await pauseFarmingTask("Cloudflare block detected. Please open site to solve captcha.");
                activeLoopRunning = false;
                return;
            }

            if (fetchResult && fetchResult.success && fetchResult.chapterId) {
                finalChapterId = fetchResult.chapterId;
                let fastRes = await executeFastUpvoteInTab(tabId, finalChapterId, userUid);
                if (fastRes) {
                    let trimmed = (fastRes.text || "").trim().toLowerCase();
                    if (fastRes.ok && (trimmed === "updated" || trimmed === "added" || trimmed.includes("updated") || trimmed.includes("added") || fastRes.status === 200)) {
                        if (!trimmed.includes("sign in to your account") && !trimmed.includes("signin.php")) {
                            upvoteSuccess = true;
                        }
                    }
                    if (trimmed.includes("sign in to your account") || trimmed.includes("signin.php")) {
                        broadcastLog(`[ERROR] Not logged in or session expired. Please log into demonicscans.org in your browser.`, true);
                        await pauseFarmingTask("User session not authenticated.");
                        activeLoopRunning = false;
                        return;
                    }
                }
            }

            // 2. FALLBACK PATH: If Fast Path didn't succeed, navigate the tab directly to the chapter page
            if (!upvoteSuccess) {
                let candidateUrls = [
                    `https://demonicscans.org/title/${state.mangaName}/chapter/${ch}/`,
                    `https://demonicscans.org/title/${state.mangaName}/chapter/${ch}/1`,
                    `https://demonicscans.org/title/${state.mangaName}/chapter/${ch}`
                ];

                if (workingUrlTemplate) {
                    candidateUrls.unshift(workingUrlTemplate.replace("{ch}", ch));
                    candidateUrls = Array.from(new Set(candidateUrls));
                }

                let upvoteResult = null;
                let successUrl = null;

                for (let url of candidateUrls) {
                    upvoteResult = await executeUpvoteOnChapterPage(tabId, url);
                    if (upvoteResult) {
                        if (upvoteResult.isCloudflare) break;
                        if (upvoteResult.isLoggedOut) break;
                        if (upvoteResult.success) {
                            successUrl = url;
                            finalChapterId = upvoteResult.chapterId || finalChapterId;
                            upvoteSuccess = true;
                            break;
                        }
                    }
                }

                if (upvoteResult && upvoteResult.isCloudflare) {
                    broadcastLog(`[ERROR] Cloudflare Verification Required on Chapter ${ch}!`, true);
                    debugLog(`Cloudflare challenge detected on Chapter ${ch}`);
                    await pauseFarmingTask("Cloudflare block detected. Please open site to solve captcha.");
                    activeLoopRunning = false;
                    return;
                }

                if (upvoteResult && upvoteResult.isLoggedOut) {
                    broadcastLog(`[ERROR] Not logged in or session expired. Please log into demonicscans.org in your browser.`, true);
                    await pauseFarmingTask("User session not authenticated.");
                    activeLoopRunning = false;
                    return;
                }

                if (successUrl) {
                    let basePattern = successUrl.replace(`/chapter/${ch}/1`, '/chapter/{ch}/1')
                                               .replace(`/chapter/${ch}/`, '/chapter/{ch}/')
                                               .replace(`/chapter/${ch}`, '/chapter/{ch}');
                    workingUrlTemplate = basePattern;
                }
            }

            if (upvoteSuccess) {
                let cidText = finalChapterId ? ` (ID: ${finalChapterId})` : "";
                broadcastLog(`[OK] Upvoted Chapter ${ch}${cidText}`);
                await recordCompletedChapter(state.mangaName, ch);
            } else {
                broadcastLog(`[WARN] Could not upvote Chapter ${ch}`, false, true);
            }

            // Move to next chapter and update state
            state.currentCh = ch + 1;
            await chrome.storage.local.set({ farmerState: state });

            // Apply delay (default 0.5s / 500ms)
            let delay = state.delayMs || 500;
            await new Promise(r => setTimeout(r, delay));
        }
    } finally {
        activeLoopRunning = false;
    }
}
