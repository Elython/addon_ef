// popup.js - Energy Farmer Extension Popup Logic

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initControls();
    initHistory();
    syncStateUI();

    // Listen for live state or log messages from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "log") {
            appendLogEntry(msg.entry);
        } else if (msg.type === "historyUpdated") {
            renderHistoryList();
        }
    });

    // Poll status every 800ms while popup is open to ensure smooth UI updates
    setInterval(syncStateUI, 800);
});

// --- TAB NAVIGATION ---
function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            
            tab.classList.add("active");
            const targetId = tab.getAttribute("data-target");
            document.getElementById(targetId).classList.add("active");

            if (targetId === "contentHistory") {
                renderHistoryList();
            }
        });
    });
}

// --- CHAPTER RANGE PARSER ---
function parseChapterRange(rangeStr) {
    if (!rangeStr) return { startCh: 1, endCh: 1 };
    let clean = rangeStr.trim();
    let match = clean.match(/^(\d+)\s*[-–—:]\s*(\d+)$/);
    if (match) {
        let start = parseInt(match[1]);
        let end = parseInt(match[2]);
        if (start > end) [start, end] = [end, start];
        return { startCh: start, endCh: end };
    }
    let singleMatch = clean.match(/^(\d+)$/);
    if (singleMatch) {
        let val = parseInt(singleMatch[1]);
        return { startCh: val, endCh: val };
    }
    return { startCh: 1, endCh: 10 };
}

// --- HELPER TO FORMAT CHAPTER RANGES ---
function formatChapterRanges(chapters) {
    if (!chapters || chapters.length === 0) return "None";
    let sorted = Array.from(new Set(chapters)).map(Number).sort((a, b) => a - b);
    let ranges = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === prev + 1) {
            prev = sorted[i];
        } else {
            if (start === prev) ranges.push(`${start}`);
            else ranges.push(`${start}-${prev}`);
            start = sorted[i];
            prev = sorted[i];
        }
    }
    if (start === prev) ranges.push(`${start}`);
    else ranges.push(`${start}-${prev}`);

    return "Ch " + ranges.join(", ");
}

// --- CONTROLS & EVENT LISTENERS ---
function initControls() {
    const btnStart = document.getElementById("btnStart");
    const btnPause = document.getElementById("btnPause");
    const btnStop = document.getElementById("btnStop");
    const btnCloudflare = document.getElementById("btnCloudflare");
    const btnOpenConsole = document.getElementById("btnOpenConsole");
    const btnOpenConsoleTab = document.getElementById("btnOpenConsoleTab");
    const btnClearTerminal = document.getElementById("btnClearTerminal");
    const chkDebugMode = document.getElementById("chkDebugMode");

    btnStart.addEventListener("click", () => {
        const mangaInput = document.getElementById("mangaName").value.trim();
        const rangeStr = document.getElementById("chapterRange").value;
        const delayMs = parseInt(document.getElementById("delaySelect").value) || 500;

        if (!mangaInput) {
            appendLogEntry({ text: "Please enter a Manga Name or paste a URL.", isError: true });
            return;
        }

        const { startCh, endCh } = parseChapterRange(rangeStr);

        chrome.runtime.sendMessage({
            action: "startFarming",
            mangaName: mangaInput,
            startCh,
            endCh,
            delayMs
        }, () => {
            syncStateUI();
        });
    });

    btnPause.addEventListener("click", () => {
        chrome.storage.local.get(["farmerState"], (res) => {
            const state = res.farmerState || {};
            if (state.isPaused) {
                chrome.runtime.sendMessage({ action: "resumeFarming" }, () => syncStateUI());
            } else {
                chrome.runtime.sendMessage({ action: "pauseFarming" }, () => syncStateUI());
            }
        });
    });

    btnStop.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "stopFarming" }, () => syncStateUI());
    });

    btnCloudflare.addEventListener("click", () => {
        chrome.tabs.create({ url: "https://demonicscans.org" });
    });

    const openConsoleFn = () => {
        const consoleUrl = chrome.runtime.getURL("console.html");
        chrome.tabs.create({ url: consoleUrl });
    };

    btnOpenConsole.addEventListener("click", openConsoleFn);
    btnOpenConsoleTab.addEventListener("click", openConsoleFn);

    btnClearTerminal.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "clearLogs" }, () => {
            document.getElementById("logTerminal").innerHTML = "";
            appendLogEntry({ text: "Logs cleared." });
        });
    });

    // Debug mode switch
    chrome.storage.local.get(["debugMode"], (res) => {
        chkDebugMode.checked = !!res.debugMode;
        toggleDebugBanner(!!res.debugMode);
    });

    chkDebugMode.addEventListener("change", (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ debugMode: enabled });
        toggleDebugBanner(enabled);
        appendLogEntry({ text: `Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}.` });
    });
}

function toggleDebugBanner(enabled) {
    const banner = document.getElementById("debugBanner");
    banner.style.display = enabled ? "block" : "none";
}

// --- STATE SYNCHRONIZATION ---
function syncStateUI() {
    chrome.storage.local.get(["farmerState", "logs"], (res) => {
        const state = res.farmerState || { isRunning: false, isPaused: false, statusText: "Idle" };
        const statusLabel = document.getElementById("statusLabel");
        const progressPercent = document.getElementById("progressPercent");
        const progressBarFill = document.getElementById("progressBarFill");
        const btnStart = document.getElementById("btnStart");
        const btnPause = document.getElementById("btnPause");
        const btnStop = document.getElementById("btnStop");
        const btnCloudflare = document.getElementById("btnCloudflare");

        statusLabel.innerText = state.statusText || "Idle";

        if (state.isRunning) {
            btnStart.style.display = "none";
            btnPause.style.display = "flex";
            btnStop.style.display = "flex";

            if (state.isPaused) {
                btnPause.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg> Resume`;
                btnPause.className = "btn btn-warning";
                if (state.statusText && state.statusText.includes("Cloudflare")) {
                    btnCloudflare.style.display = "flex";
                } else {
                    btnCloudflare.style.display = "none";
                }
            } else {
                btnPause.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg> Pause`;
                btnPause.className = "btn btn-warning";
                btnCloudflare.style.display = "none";
            }

            // Progress percentage
            let total = (state.endCh - state.startCh + 1) || 1;
            let currentDone = (state.currentCh - state.startCh);
            if (currentDone < 0) currentDone = 0;
            let pct = Math.min(100, Math.max(0, Math.round((currentDone / total) * 100)));

            progressPercent.innerText = `${pct}%`;
            progressBarFill.style.width = `${pct}%`;
        } else {
            btnStart.style.display = "flex";
            btnPause.style.display = "none";
            btnStop.style.display = "none";
            btnCloudflare.style.display = "none";
            progressPercent.innerText = "0%";
            progressBarFill.style.width = "0%";
        }

        // Restore logs stream
        if (res.logs && Array.isArray(res.logs)) {
            const terminal = document.getElementById("logTerminal");
            if (terminal.children.length <= 1 && res.logs.length > 0) {
                terminal.innerHTML = "";
                res.logs.slice(-50).forEach(entry => appendLogEntry(entry));
            }
        }
    });
}

// --- LOG TERMINAL HELPER ---
function appendLogEntry(entry) {
    const terminal = document.getElementById("logTerminal");
    if (!terminal) return;
    const div = document.createElement("div");
    div.className = "log-entry";
    if (entry.isError) div.classList.add("log-error");
    else if (entry.isWarn) div.classList.add("log-warn");
    else div.classList.add("log-info");

    const timeStr = entry.time ? `[${entry.time}] ` : "";
    div.innerText = `> ${timeStr}${entry.text}`;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

// --- HISTORY TAB FUNCTIONALITY ---
function initHistory() {
    const searchInput = document.getElementById("historySearch");
    searchInput.addEventListener("input", renderHistoryList);

    document.getElementById("btnClearHistory").addEventListener("click", () => {
        chrome.storage.local.set({ mangaHistory: {} }, () => renderHistoryList());
    });
}

function renderHistoryList() {
    const historyList = document.getElementById("historyList");
    const searchQuery = (document.getElementById("historySearch").value || "").toLowerCase().trim();

    chrome.storage.local.get(["mangaHistory"], (res) => {
        const history = res.mangaHistory || {};
        const mangaKeys = Object.keys(history);

        if (mangaKeys.length === 0) {
            historyList.innerHTML = `<div class="empty-history">No manga history recorded yet.</div>`;
            return;
        }

        historyList.innerHTML = "";
        let count = 0;

        mangaKeys.sort((a, b) => new Date(history[b].lastUpdated) - new Date(history[a].lastUpdated));

        mangaKeys.forEach(mangaKey => {
            const item = history[mangaKey];
            if (searchQuery && !item.mangaName.toLowerCase().includes(searchQuery)) return;

            count++;
            const card = document.createElement("div");
            card.className = "history-card";

            const formattedRanges = formatChapterRanges(item.completedChapters);
            const totalCount = item.totalUpvoted || item.completedChapters.length;
            const updatedDate = new Date(item.lastUpdated).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            let maxCompleted = item.completedChapters.length > 0 ? Math.max(...item.completedChapters) : 0;
            let nextStart = maxCompleted + 1;
            let nextEnd = maxCompleted + 10;

            card.innerHTML = `
                <div class="history-title">${item.mangaName}</div>
                <div class="history-chapters"><strong>Completed:</strong> ${formattedRanges} (${totalCount} total)</div>
                <div class="history-meta">
                    <span>Active: ${updatedDate}</span>
                    <div class="history-actions">
                        <button class="mini-btn farm-again-btn" title="Farm Next Chapters">
                            <svg class="icon" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                            Farm Ch ${nextStart}-${nextEnd}
                        </button>
                        <button class="mini-btn del del-btn" title="Delete record">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;

            card.querySelector(".farm-again-btn").addEventListener("click", () => {
                document.getElementById("mangaName").value = item.mangaName;
                document.getElementById("chapterRange").value = `${nextStart}-${nextEnd}`;
                document.getElementById("tabFarm").click();
            });

            card.querySelector(".del-btn").addEventListener("click", () => {
                delete history[mangaKey];
                chrome.storage.local.set({ mangaHistory: history }, () => renderHistoryList());
            });

            historyList.appendChild(card);
        });

        if (count === 0) {
            historyList.innerHTML = `<div class="empty-history">No matching manga found.</div>`;
        }
    });
}
