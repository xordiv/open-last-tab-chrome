const STORAGE_MRU_KEY = "mru";
const SLOW_TIMER_VALUE = 1500;
const FAST_TIMER_VALUE = 200;
const LOGGING_ON = false;

let mru = [];
let slowSwitchOngoing = false;
let fastSwitchOngoing = false;
let intSwitchCount = 0;
let lastIntSwitchIndex = 0;
let slowSwitchForward = false;
let initialized = false;
let initializePromise = null;
let timer = null;

function OLTlog(message) {
    if (LOGGING_ON) {
        console.log(message);
    }
}

function runtimeLastError() {
    return chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
}

function getStorageArea() {
    if (chrome.storage && chrome.storage.session) {
        return chrome.storage.session;
    }

    if (chrome.storage && chrome.storage.local) {
        return chrome.storage.local;
    }

    return null;
}

function storageGet(keys) {
    const area = getStorageArea();
    if (!area) {
        return Promise.resolve({});
    }

    return new Promise(function (resolve) {
        area.get(keys, function (items) {
            if (chrome.runtime.lastError) {
                OLTlog("Storage get failed: " + runtimeLastError());
                resolve({});
                return;
            }

            resolve(items || {});
        });
    });
}

function storageSet(items) {
    const area = getStorageArea();
    if (!area) {
        return Promise.resolve();
    }

    return new Promise(function (resolve) {
        area.set(items, function () {
            if (chrome.runtime.lastError) {
                OLTlog("Storage set failed: " + runtimeLastError());
            }

            resolve();
        });
    });
}

function windowsGetAll(queryInfo) {
    return new Promise(function (resolve) {
        chrome.windows.getAll(queryInfo, function (windows) {
            if (chrome.runtime.lastError) {
                OLTlog("windows.getAll failed: " + runtimeLastError());
                resolve([]);
                return;
            }

            resolve(windows || []);
        });
    });
}

function tabsGet(tabId) {
    return new Promise(function (resolve) {
        chrome.tabs.get(tabId, function (tab) {
            if (chrome.runtime.lastError) {
                resolve(null);
                return;
            }

            resolve(tab || null);
        });
    });
}

function tabsUpdate(tabId, updateProperties) {
    return new Promise(function (resolve) {
        chrome.tabs.update(tabId, updateProperties, function (tab) {
            if (chrome.runtime.lastError) {
                OLTlog("tabs.update failed: " + runtimeLastError());
            }

            resolve(tab || null);
        });
    });
}

function windowsUpdate(windowId, updateInfo) {
    return new Promise(function (resolve) {
        chrome.windows.update(windowId, updateInfo, function (window) {
            if (chrome.runtime.lastError) {
                OLTlog("windows.update failed: " + runtimeLastError());
            }

            resolve(window || null);
        });
    });
}

function uniqueValidIds(tabIds, validTabIds) {
    const seen = new Set();
    const result = [];

    tabIds.forEach(function (tabId) {
        if (typeof tabId === "number" && validTabIds.has(tabId) && !seen.has(tabId)) {
            seen.add(tabId);
            result.push(tabId);
        }
    });

    return result;
}

function tabIdsFromWindows(windows) {
    const ids = [];
    windows.forEach(function (window) {
        (window.tabs || []).forEach(function (tab) {
            if (typeof tab.id === "number") {
                ids.unshift(tab.id);
            }
        });
    });

    return ids;
}

async function saveMRU() {
    await storageSet({[STORAGE_MRU_KEY]: mru});
}

async function initialize() {
    if (initialized) {
        return;
    }

    if (initializePromise) {
        await initializePromise;
        return;
    }

    initializePromise = (async function () {
        const windows = await windowsGetAll({populate: true});
        const allTabIds = tabIdsFromWindows(windows);
        const validTabIds = new Set(allTabIds);
        const stored = await storageGet(STORAGE_MRU_KEY);
        const storedMru = Array.isArray(stored[STORAGE_MRU_KEY]) ? stored[STORAGE_MRU_KEY] : [];

        mru = uniqueValidIds(storedMru.concat(allTabIds), validTabIds);
        initialized = true;
        await saveMRU();
        OLTlog("MRU after init: " + mru);
    })();

    await initializePromise;
}

async function addTabToMRUAtBack(tabId) {
    await initialize();

    if (mru.indexOf(tabId) === -1) {
        mru.push(tabId);
        await saveMRU();
    }
}

async function addTabToMRUAtFront(tabId) {
    await initialize();

    if (mru.indexOf(tabId) === -1) {
        mru.unshift(tabId);
        await saveMRU();
    }
}

async function putExistingTabToTop(tabId) {
    await initialize();

    const index = mru.indexOf(tabId);
    if (index !== -1) {
        mru.splice(index, 1);
        mru.unshift(tabId);
        await saveMRU();
    }
}

async function removeTabFromMRU(tabId) {
    await initialize();

    const index = mru.indexOf(tabId);
    if (index !== -1) {
        mru.splice(index, 1);
        await saveMRU();
    }
}

async function removeItemAtIndexFromMRU(index) {
    if (index < mru.length) {
        mru.splice(index, 1);
        await saveMRU();
    }
}

function incrementSwitchCounter() {
    if (mru.length > 0) {
        intSwitchCount = (intSwitchCount + 1) % mru.length;
    }
}

function decrementSwitchCounter() {
    if (mru.length === 0) {
        return;
    }

    if (intSwitchCount === 0) {
        intSwitchCount = mru.length - 1;
    } else {
        intSwitchCount = intSwitchCount - 1;
    }
}

async function doIntSwitch() {
    await initialize();
    OLTlog("OLT:: in int switch, intSwitchCount: " + intSwitchCount + ", mru.length: " + mru.length);

    if (mru.length < 2 || intSwitchCount < 0 || intSwitchCount >= mru.length) {
        return;
    }

    if (slowSwitchForward) {
        decrementSwitchCounter();
    } else {
        incrementSwitchCounter();
    }

    const tabIdToMakeActive = mru[intSwitchCount];
    const tab = await tabsGet(tabIdToMakeActive);

    if (tab) {
        await windowsUpdate(tab.windowId, {focused: true});
        await tabsUpdate(tabIdToMakeActive, {active: true, highlighted: true});
        lastIntSwitchIndex = intSwitchCount;
        return;
    }

    OLTlog("OLT:: invalid tab found. intSwitchCount: " + intSwitchCount + ", mru.length: " + mru.length);
    await removeItemAtIndexFromMRU(intSwitchCount);
    if (intSwitchCount >= mru.length) {
        intSwitchCount = 0;
    }

    await doIntSwitch();
}

async function endSwitch() {
    await initialize();
    OLTlog("OLT::END_SWITCH");

    slowSwitchOngoing = false;
    fastSwitchOngoing = false;

    const tabId = mru[lastIntSwitchIndex];
    if (typeof tabId === "number") {
        await putExistingTabToTop(tabId);
    }

    OLTlog("mru: " + mru);
}

async function processCommand(command) {
    await initialize();
    OLTlog("Command recd:" + command);

    let fastSwitch = true;
    slowSwitchForward = false;

    if (command === "alt_switch_fast") {
        fastSwitch = true;
    } else if (command === "alt_switch_slow_backward") {
        fastSwitch = false;
        slowSwitchForward = false;
    } else if (command === "alt_switch_slow_forward") {
        fastSwitch = false;
        slowSwitchForward = true;
    } else {
        return;
    }

    if (!slowSwitchOngoing && !fastSwitchOngoing) {
        if (fastSwitch) {
            fastSwitchOngoing = true;
        } else {
            slowSwitchOngoing = true;
        }

        OLTlog("OLT::START_SWITCH");
        intSwitchCount = 0;
        await doIntSwitch();
    } else if ((slowSwitchOngoing && !fastSwitch) || (fastSwitchOngoing && fastSwitch)) {
        OLTlog("OLT::DO_INT_SWITCH");
        await doIntSwitch();
    } else if (slowSwitchOngoing && fastSwitch) {
        await endSwitch();
        fastSwitchOngoing = true;
        OLTlog("OLT::START_SWITCH");
        intSwitchCount = 0;
        await doIntSwitch();
    } else if (fastSwitchOngoing && !fastSwitch) {
        await endSwitch();
        slowSwitchOngoing = true;
        OLTlog("OLT::START_SWITCH");
        intSwitchCount = 0;
        await doIntSwitch();
    }

    if (timer && (fastSwitchOngoing || slowSwitchOngoing)) {
        clearTimeout(timer);
    }

    timer = setTimeout(function () {
        void endSwitch();
    }, fastSwitch ? FAST_TIMER_VALUE : SLOW_TIMER_VALUE);
}

chrome.commands.onCommand.addListener(function (command) {
    void processCommand(command);
});

chrome.action.onClicked.addListener(function () {
    OLTlog("Click recd");
    void processCommand("alt_switch_fast");
});

chrome.runtime.onStartup.addListener(function () {
    OLTlog("on startup");
    void initialize();
});

chrome.runtime.onInstalled.addListener(function (details) {
    const version = chrome.runtime.getManifest().version;

    if (details.reason === "install") {
        OLTlog("Extension Installed: " + version);
    } else if (details.reason === "update") {
        OLTlog("Extension Updated: " + version);
    }

    void initialize();
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
    void (async function () {
        await initialize();

        if (!slowSwitchOngoing && !fastSwitchOngoing) {
            const index = mru.indexOf(activeInfo.tabId);

            if (index === -1) {
                OLTlog("Unexpected scenario hit with tab(" + activeInfo.tabId + ").");
                await addTabToMRUAtFront(activeInfo.tabId);
            } else {
                await putExistingTabToTop(activeInfo.tabId);
            }
        }
    })();
});

chrome.tabs.onCreated.addListener(function (tab) {
    if (typeof tab.id === "number") {
        OLTlog("Tab create event fired with tab(" + tab.id + ")");
        void addTabToMRUAtBack(tab.id);
    }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    OLTlog("Tab remove event fired from tab(" + tabId + ")");
    void removeTabFromMRU(tabId);
});

void initialize();
