// console.js - Debug Console Controller for Energy Farmer Extension

document.addEventListener("DOMContentLoaded", () => {
    loadStoredLogs();
    checkDebugModeStatus();

    document.getElementById("downloadBtn").addEventListener("click", downloadLogs);
    document.getElementById("refreshBtn").addEventListener("click", loadStoredLogs);
    document.getElementById("clearBtn").addEventListener("click", clearLogs);

    // Listen for live debug logs while console tab is open
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "debugLog" || msg.type === "log") {
            appendLogLine(msg.entry || { text: msg.text, isError: msg.isError, isWarn: msg.isWarn });
        }
    });

    setInterval(checkDebugModeStatus, 3000);
});

function checkDebugModeStatus() {
    chrome.storage.local.get(["debugMode"], (res) => {
        const badge = document.getElementById("statusBadge");
        if (res.debugMode) {
            badge.innerText = "Debug Mode: ENABLED";
            badge.style.color = "#a6e3a1";
            badge.style.borderColor = "#a6e3a1";
        } else {
            badge.innerText = "Debug Mode: DISABLED (Enable in extension settings)";
            badge.style.color = "#f9e2af";
            badge.style.borderColor = "#f9e2af";
        }
    });
}

function loadStoredLogs() {
    chrome.storage.local.get(["debugLogs", "logs"], (res) => {
        const container = document.getElementById("logs");
        container.innerHTML = "";

        const debugLogs = res.debugLogs || [];
        const logs = res.logs || [];

        if (debugLogs.length === 0 && logs.length === 0) {
            container.innerHTML = `<div class="log-debug">No logs recorded yet. Start farming or enable Debug Mode to record detailed logs.</div>`;
            return;
        }

        // Render standard logs first or combined debug logs
        const all = [];

        logs.forEach(l => all.push({ time: l.time || "", text: l.text, type: l.isError ? 'error' : (l.isWarn ? 'warn' : 'info') }));
        debugLogs.forEach(d => all.push({ time: d.time || "", text: `[DEBUG] ${d.text}`, type: 'debug' }));

        all.forEach(item => appendLogLine(item));
    });
}

function appendLogLine(item) {
    const container = document.getElementById("logs");
    const div = document.createElement("div");
    div.className = "log-line";

    if (item.type === 'error' || item.isError) div.classList.add("log-error");
    else if (item.type === 'warn' || item.isWarn) div.classList.add("log-warn");
    else if (item.type === 'info') div.classList.add("log-info");
    else div.classList.add("log-debug");

    const timeStr = item.time ? `[${item.time}] ` : "";
    div.innerText = `${timeStr}${item.text}`;
    container.appendChild(div);

    if (document.getElementById("chkAutoScroll").checked) {
        container.scrollTop = container.scrollHeight;
    }
}

function downloadLogs() {
    chrome.storage.local.get(["debugLogs", "logs"], (res) => {
        const debugLogs = res.debugLogs || [];
        const logs = res.logs || [];

        if (debugLogs.length === 0 && logs.length === 0) {
            alert("No logs to download!");
            return;
        }

        let lines = [];
        lines.push("==================================================");
        lines.push(`DEMONICSCANS ENERGY FARMER DEBUG LOG - ${new Date().toLocaleString()}`);
        lines.push("==================================================\n");

        lines.push("--- USER LOGS ---");
        logs.forEach(l => lines.push(`[${l.time || 'N/A'}] ${l.text}`));

        lines.push("\n--- VERBOSE DEBUG LOGS ---");
        debugLogs.forEach(d => lines.push(`[${d.time || 'N/A'}] ${d.text}`));

        const blob = new Blob([lines.join("\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `energy_farmer_debug_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

function clearLogs() {
    chrome.runtime.sendMessage({ action: "clearLogs" }, () => {
        document.getElementById("logs").innerHTML = `<div class="log-debug">Logs cleared.</div>`;
    });
}
