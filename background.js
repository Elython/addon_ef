// background.js - DemonicScans Energy Farmer Background Engine

let activeLoopRunning = false;
let workingUrlTemplate = null;
let persistentBgTabId = null;

chrome.runtime.onInstalled.addListener(() => {
    updateNetRules();
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

// Update declarativeNetRequest dynamic rules with exact browser headers
async function updateNetRules(refererUrl = "https://demonicscans.org/") {
    try {
        let cookieStr = await getEssentialCookieString();
        if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
            const reqHeaders = [
                { header: "Referer", operation: "set", value: refererUrl },
                { header: "Origin", operation: "set", value: "https://demonicscans.org" },
                { header: "Sec-Fetch-Dest", operation: "set", value: "empty" },
                { header: "Sec-Fetch-Mode", operation: "set", value: "cors" },
                { header: "Sec-Fetch-Site", operation: "set", value: "same-origin" }
            ];

            if (cookieStr) {
                reqHeaders.push({ header: "Cookie", operation: "set", value: cookieStr });
            }

            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [1],
                addRules: [{
                    id: 1,
                    priority: 1,
                    action: {
                        type: "modifyHeaders",
                        requestHeaders: reqHeaders
                    },
                    condition: {
                        urlFilter: "*://*.demonicscans.org/*",
                        resourceTypes: ["xmlhttprequest", "main_frame", "sub_frame", "other"]
                    }
                }]
            });
            debugLog(`declarativeNetRequest rule updated with Referer: ${refererUrl}`);
        }
    } catch (e) {
        debugLog(`declarativeNetRequest update warning: ${e.message}`);
    }
}

// Get or reuse a silent background tab for 1st-party requests (active: false)
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
            persistentBgTabId = tabs[0].id;
            return persistentBgTabId;
        }

        let newTab = await chrome.tabs.create({ url: "https://demonicscans.org/", active: false });
        persistentBgTabId = newTab.id;
        await new Promise(r => setTimeout(r, 1500));
        return persistentBgTabId;
    } catch (e) {
        debugLog(`Background tab helper error: ${e.message}`);
        return null;
    }
}

// Execute upvote directly inside the 1st-party window context
async function executeUpvoteInTabContext(tabId, chapterId, userUid) {
    try {
        let scriptOptions = {
            target: { tabId: tabId },
            func: (chapId, uid) => {
                return new Promise((resolve) => {
                    let urlParams = new URLSearchParams();
                    urlParams.append("chapterid", chapId);
                    urlParams.append("reaction", "1");
                    urlParams.append("useruid", uid);

                    fetch("https://demonicscans.org/postreaction.php", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                        },
                        body: urlParams
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
        debugLog(`Tab context upvote error: ${e.message}`);
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

// 7-strategy Chapter ID Extractor
function extractChapterId(htmlText) {
    if (!htmlText) return null;

    let match = htmlText.match(/(?:chapter_?id|chap_?id|chapterid)\s*[:=]\s*['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    match = htmlText.match(/(?:react|postReaction|reaction|likeChapter|upvoteChapter|vote)\s*\(\s*['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    match = htmlText.match(/data-(?:chapter-?id|chap-?id|id)=['"]?(\d{2,12})['"]?/i);
    if (match) return match[1];

    match = htmlText.match(/name=['"]?(?:chapter_?id|chap_?id)['"]?\s+value=['"]?(\d{2,12})['"]?/i) ||
            htmlText.match(/value=['"]?(\d{2,12})['"]?\s+name=['"]?(?:chapter_?id|chap_?id)['"]?/i);
    if (match) return match[1];

    match = htmlText.match(/id=['"]?(?:chapter|chap)_?(\d{2,12})['"]?/i);
    if (match) return match[1];

    match = htmlText.match(/(?:postreaction\.php|reaction\.php|chapter)\?(?:[a-z0-9_]+=[^&]*&)*?(?:chapter_?id|id|chap_?id)=(\d{2,12})/i);
    if (match) return match[1];

    match = htmlText.match(/content=['"]?[^'"]*\/chapter\/(\d{2,12})['"]?/i) ||
            matchText.match(/href=['"]?[^'"]*\/chapter\/(\d{2,12})['"]?/i);
    if (match) return match[1];

    return null;
}

function extractUserUidFromHtml(htmlText) {
    if (!htmlText) return null;
    let match = htmlText.match(/useruid\s*[:=]\s*['"]?(\d+)['"]?/i) || 
                htmlText.match(/name=['"]useruid['"]\s+value=['"]?(\d+)['"]?/i);
    if (match) return match[1];
    return null;
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
    await updateNetRules();
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
        await updateNetRules(url);
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
        let userUid = await getUserUid();

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

            broadcastLog(`[*] Fetching Chapter ${ch}...`, false, true);

            let fetchResult = await fetchChapterWithFallbacks(state.mangaName, ch);

            if (fetchResult.isCloudflare) {
                broadcastLog(`[ERROR] Cloudflare Verification Required on Chapter ${ch}!`, true);
                debugLog(`Cloudflare challenge detected on ${fetchResult.url}`);
                await pauseFarmingTask("Cloudflare block detected. Please open site to solve captcha.");
                activeLoopRunning = false;
                return;
            }

            if (!fetchResult.success) {
                broadcastLog(`[SKIP] Could not locate Chapter ${ch} ID or page (404 / Missing ID).`, true);
                debugLog(`[Ch ${ch}] All URL candidates failed or extractChapterId returned null.`);
            } else {
                let { chapterId, htmlText, url } = fetchResult;

                if (!userUid) {
                    userUid = extractUserUidFromHtml(htmlText);
                    if (userUid) debugLog(`Extracted User UID from HTML: ${userUid}`);
                }

                if (!userUid) {
                    broadcastLog(`[ERROR] User UID not found. Please log in to demonicscans.org in your browser.`, true);
                    await pauseFarmingTask("Missing useruid cookie or session.");
                    activeLoopRunning = false;
                    return;
                }

                await updateNetRules(url);
                debugLog(`[Ch ${ch}] Upvoting chapterId ${chapterId}...`);

                let isSuccess = false;

                // First-party background tab execution (bypasses Cloudflare & Firefox extension sandbox 403)
                let tabId = await getOrCreateBackgroundTab();
                if (tabId) {
                    let tabRes = await executeUpvoteInTabContext(tabId, chapterId, userUid);
                    if (tabRes) {
                        let tabErrFmt = formatResponseError(tabRes.status, "", tabRes.text);
                        debugLog(`[Ch ${ch}] First-Party Tab Context -> ${tabErrFmt}`);
                        if (tabRes.ok || tabRes.status === 200 || (tabRes.text && tabRes.text.includes("updated"))) {
                            isSuccess = true;
                        }
                    }
                }

                // Fallback: Direct POST (URLSearchParams)
                if (!isSuccess) {
                    try {
                        let urlParams = new URLSearchParams();
                        urlParams.append("chapterid", chapterId);
                        urlParams.append("reaction", "1");
                        urlParams.append("useruid", userUid);

                        let postResp = await fetch("https://demonicscans.org/postreaction.php", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                            },
                            credentials: 'include',
                            body: urlParams
                        });
                        let postText = await postResp.text();
                        let errFmt = formatResponseError(postResp.status, postResp.statusText, postText);
                        debugLog(`[Ch ${ch}] Direct POST (URLSearchParams) -> ${errFmt}`);

                        if (postResp.ok && (postText.includes("updated") || postText.includes("success") || postResp.status === 200)) {
                            isSuccess = true;
                        }
                    } catch (e) {
                        debugLog(`[Ch ${ch}] Direct POST Exception: ${e.message}`);
                    }
                }

                if (isSuccess) {
                    broadcastLog(`[OK] Upvoted Chapter ${ch} (ID: ${chapterId})`);
                    await recordCompletedChapter(state.mangaName, ch);
                } else {
                    broadcastLog(`[WARN] Upvote returned HTTP 403 on Chapter ${ch}`, false, true);
                }
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
