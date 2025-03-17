var mru = [];
var slowSwitchOngoing = false;
var fastSwitchOngoing = false;
var intSwitchCount = 0;
var lastIntSwitchIndex = 0;
var altPressed = false;
var wPressed = false;

var quickActive = 0;
var slowActive = 0;

var prevTimestamp = 0;
var slowTimerValue = 1500;
var fastTimerValue = 200;
var timer;

var slowSwitchForward = false;

var initialized = false;

var loggingOn = false;

var OLTlog = function (str) {
    if (loggingOn) {
        console.log(str);
    }
};

var processCommand = function (command) {
    OLTlog('Command recd:' + command);

    var fastSwitch = true;
    slowSwitchForward = false;
    if (command == "alt_switch_fast") {
        fastSwitch = true;
        quickSwitchActiveUsage();
    } else if (command == "alt_switch_slow_backward") {
        fastSwitch = false;
        slowSwitchForward = false;
        slowSwitchActiveUsage();
    } else if (command == "alt_switch_slow_forward") {
        fastSwitch = false;
        slowSwitchForward = true;
        slowSwitchActiveUsage();
    }

    if (!slowSwitchOngoing && !fastSwitchOngoing) {

        if (fastSwitch) {
            fastSwitchOngoing = true;
        } else {
            slowSwitchOngoing = true;
        }
        OLTlog("OLT::START_SWITCH");
        intSwitchCount = 0;
        doIntSwitch();

    } else if ((slowSwitchOngoing && !fastSwitch) || (fastSwitchOngoing && fastSwitch)) {
        OLTlog("OLT::DO_INT_SWITCH");
        doIntSwitch();

    } else if (slowSwitchOngoing && fastSwitch) {
        endSwitch();
        fastSwitchOngoing = true;
        OLTlog("OLT::START_SWITCH");
        intSwitchCount = 0;
        doIntSwitch();

    } else if (fastSwitchOngoing && !fastSwitch) {
        endSwitch();
        slowSwitchOngoing = true;
        OLTlog("OLT::START_SWITCH");
        intSwitchCount = 0;
        doIntSwitch();
    }

    if (timer) {
        if (fastSwitchOngoing || slowSwitchOngoing) {
            clearTimeout(timer);
        }
    }
    if (fastSwitch) {
        timer = setTimeout(function () {
            endSwitch()
        }, fastTimerValue);
    } else {
        timer = setTimeout(function () {
            endSwitch()
        }, slowTimerValue);
    }

};

chrome.commands.onCommand.addListener(processCommand);

chrome.action.onClicked.addListener(function (tab) {
    OLTlog('Click recd');
    processCommand('alt_switch_fast');
});

chrome.runtime.onStartup.addListener(function () {
    OLTlog("on startup");
    initialize();

});

chrome.runtime.onInstalled.addListener(function () {
    OLTlog("on startup");
    initialize();

});

var doIntSwitch = function () {
    OLTlog("OLT:: in int switch, intSwitchCount: " + intSwitchCount + ", mru.length: " + mru.length);
    if (intSwitchCount < mru.length && intSwitchCount >= 0) {
        var tabIdToMakeActive;
        //check if tab is still present
        //sometimes tabs have gone missing
        var thisWindowId;
        if (slowSwitchForward) {
            decrementSwitchCounter();
        } else {
            incrementSwitchCounter();
        }
        tabIdToMakeActive = mru[intSwitchCount];
        chrome.tabs.get(tabIdToMakeActive, function (tab) {
            if (tab) {
                thisWindowId = tab.windowId;

                chrome.windows.update(thisWindowId, { "focused": true });
                chrome.tabs.update(tabIdToMakeActive, { active: true, highlighted: true });
                lastIntSwitchIndex = intSwitchCount;
            } else {
                OLTlog("OLT:: in int switch, >>invalid tab found.intSwitchCount: " + intSwitchCount + ", mru.length: " + mru.length);
                removeItemAtIndexFromMRU(intSwitchCount);
                if (intSwitchCount >= mru.length) {
                    intSwitchCount = 0;
                }
                doIntSwitch();
            }
        });


    }
};

var endSwitch = function () {
    OLTlog("OLT::END_SWITCH");

    slowSwitchOngoing = false;
    fastSwitchOngoing = false;
    var tabId = mru[lastIntSwitchIndex];
    putExistingTabToTop(tabId);
    printMRUSimple();
};

chrome.tabs.onActivated.addListener(function (activeInfo) {
    trackActiveTab(activeInfo.tabId);
});

chrome.tabs.onCreated.addListener(function (tab) {
    OLTlog("Tab create event fired with tab(" + tab.id + ")");
    addTabToMRUAtBack(tab.id);
});

chrome.tabs.onRemoved.addListener(function (tabId, removedInfo) {
    OLTlog("Tab remove event fired from tab(" + tabId + ")");
    removeTabFromMRU(tabId);
});

chrome.windows.onFocusChanged.addListener(function (windowId) {
    OLTlog("Window focus event fired from(" + windowId + ")");
    if (windowId != chrome.windows.WINDOW_ID_NONE) {
        let queryOptions = { active: true, lastFocusedWindow: true };
        chrome.tabs.query(queryOptions, ([tab]) => {
            if (!chrome.runtime.lastError) {
                trackActiveTab(tab.id);
            }
        });
    }

}, { windowTypes: ['normal'] });

var trackActiveTab = function (tabId) {
    if (!slowSwitchOngoing && !fastSwitchOngoing) {
        OLTlog("Tracking active tab(" + tabId + ").");
        var index = mru.indexOf(tabId);

        //probably should not happen since tab created gets called first than activated for new tabs,
        // but added as a backup behavior to avoid orphan tabs
        if (index == -1) {
            OLTlog("Unexpected scenario hit with tab(" + tabId + ").")
            addTabToMRUAtFront(tabId)
        } else {
            putExistingTabToTop(tabId);
        }
    }
}


var addTabToMRUAtBack = function (tabId) {

    var index = mru.indexOf(tabId);
    if (index == -1) {
        //add to the end of mru
        mru.splice(-1, 0, tabId);
    }
    saveMRU();
};

var addTabToMRUAtFront = function (tabId) {

    var index = mru.indexOf(tabId);
    if (index == -1) {
        //add to the front of mru
        mru.splice(0, 0, tabId);
    }
    saveMRU();
};

var putExistingTabToTop = function (tabId) {
    var index = mru.indexOf(tabId);
    if (index != -1) {
        mru.splice(index, 1);
        mru.unshift(tabId);
    }
    saveMRU();
};

var removeTabFromMRU = function (tabId) {
    var index = mru.indexOf(tabId);
    if (index != -1) {
        mru.splice(index, 1);
    }
    saveMRU();
};

var removeItemAtIndexFromMRU = function (index) {
    if (index < mru.length) {
        mru.splice(index, 1);
    }
    saveMRU();
};

var incrementSwitchCounter = function () {
    intSwitchCount = (intSwitchCount + 1) % mru.length;
};

var decrementSwitchCounter = function () {
    if (intSwitchCount == 0) {
        intSwitchCount = mru.length - 1;
    } else {
        intSwitchCount = intSwitchCount - 1;
    }
};

var saveMRU = function () {
    chrome.storage.local.set({ 'MRU': mru });
}

var initialize = function () {
    if (!initialized) {
        initialized = true;

        chrome.storage.local.get("MRU", function (result) {
            let savedMRU = []
            if (result["MRU"] != null) {
                savedMRU = result["MRU"];
            }

            let allTabs = new Set();
            chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, function (windows) {
                windows.forEach(function (window) {
                    window.tabs.forEach(function (tab) {
                        allTabs.add(tab.id);
                    });
                });
                for (const tabId of savedMRU) {
                    if (allTabs.has(tabId)) {
                        mru.push(tabId);
                        allTabs.delete(tabId);
                    }
                }
                mru = mru.concat(...allTabs);
                saveMRU();

                OLTlog("MRU after init: " + mru);
            });
        });
    }
};

var printTabInfo = function (tabId) {
    var info = "";
    chrome.tabs.get(tabId, function (tab) {
        info = "Tabid: " + tabId + " title: " + tab.title;
    });
    return info;
};

var printMRUSimple = function () {
    OLTlog("mru: " + mru);
};

initialize();

var quickSwitchActiveUsage = function () {
    if (quickActive == -1) {
        return;
    } else if (quickActive < 5) {
        quickActive++;
    } else if (quickActive >= 5) {
        quickActive = -1;
    }
};

var slowSwitchActiveUsage = function () {
    if (slowActive == -1) {
        return;
    } else if (slowActive < 5) {
        slowActive++;
    } else if (slowActive >= 5) {
        slowActive = -1;
    }
};
