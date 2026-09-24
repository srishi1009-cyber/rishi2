// ============================================================
// RISHI MUSIC - APP.JS
// ============================================================

const DB_NAME = "RishiMusicDB";
const DB_VERSION = 1;
const STORE_NAME = "tracks";

let db = null;
let songs = [];

let currentIndex = -1;
let currentObjectUrl = null;

let activeDirector = "all";
let searchQuery = "";

let isAutoAdvancing = false;

// Prevent multiple automatic next-song requests from racing each other.
let nextSongTimer = null;
let audioErrorRetries = 0;
const MAX_AUDIO_ERROR_RETRIES = 3;

const audio = document.getElementById("audioEngine");

// ============================================================
// INDEXED DB
// ============================================================

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function(event) {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = function() {
            db = request.result;
            resolve(db);
        };

        request.onerror = function() {
            reject(request.error);
        };
    });
}

// ============================================================
// SAVE TRACK
// ============================================================

function saveTrackToDB(track) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(track);

        request.onsuccess = function() {
            resolve(request.result);
        };

        request.onerror = function() {
            reject(request.error);
        };
    });
}

// ============================================================
// UPDATE TRACK
// ============================================================

function updateTrackInDB(track) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(track);

        request.onsuccess = function() {
            resolve();
        };

        request.onerror = function() {
            reject(request.error);
        };
    });
}

// ============================================================
// LOAD TRACKS
// ============================================================

function loadAllTracksFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = function() {
            resolve(request.result || []);
        };

        request.onerror = function() {
            reject(request.error);
        };
    });
}

// ============================================================
// DAILY PLAY HISTORY (Strict: Once per Day)
// ============================================================

const AUTO_HISTORY_PREFIX = "rishiMusicAutoPlayed_";

function getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTodayHistoryKey() {
    return AUTO_HISTORY_PREFIX + getTodayDate();
}

function getTodayPlayedSongs() {
    try {
        const saved = localStorage.getItem(getTodayHistoryKey());
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error("History error:", error);
        return [];
    }
}

function saveTodayPlayedSongs(list) {
    try {
        localStorage.setItem(getTodayHistoryKey(), JSON.stringify(list));
    } catch (error) {
        console.error("Could not save history:", error);
    }
}

// ============================================================
// SONG ID FOR HISTORY
// ============================================================

function getSongHistoryId(song) {
    if (song.id !== undefined && song.id !== null) {
        return "id_" + song.id;
    }
    return [
        song.title || "",
        song.artist || "",
        song.director || "",
        song.name || "",
        song.url || ""
    ].join("|");
}

// ============================================================
// MARK AUTOMATIC SONG AS PLAYED TODAY
// ============================================================

function markSongAutomaticallyPlayed(song) {
    const history = getTodayPlayedSongs();
    const id = getSongHistoryId(song);

    if (!history.includes(id)) {
        history.push(id);
        saveTodayPlayedSongs(history);
    }
}

// ============================================================
// REMOVE OLD HISTORY
// ============================================================

function cleanOldPlayHistory() {
    const todayKey = getTodayHistoryKey();
    const keysToDelete = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(AUTO_HISTORY_PREFIX) && key !== todayKey) {
            keysToDelete.push(key);
        }
    }

    keysToDelete.forEach(function(key) {
        localStorage.removeItem(key);
    });
}

// ============================================================
// GET MUSIC DIRECTOR
// ============================================================

function getSongDirector(song) {
    return String(
        song.director ||
        song.artist ||
        "Unknown Director"
    ).trim();
}

// ============================================================
// DISPLAY FILTER
// ============================================================

function getFilteredSongIndexes() {
    const result = [];
    const query = searchQuery.trim().toLowerCase();

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];

        if (activeDirector !== "all") {
            if (getSongDirector(song).toLowerCase() !== activeDirector.toLowerCase()) {
                continue;
            }
        }

        if (query) {
            const searchable = [
                song.title || "",
                song.name || "",
                song.artist || "",
                song.director || ""
            ].join(" ").toLowerCase();

            if (!searchable.includes(query)) {
                continue;
            }
        }

        result.push(i);
    }

    return result;
}

// ============================================================
// AUTOMATIC PLAYLIST
// ============================================================

function getAutomaticSongIndexes() {
    const result = [];

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];

        if (activeDirector !== "all") {
            if (getSongDirector(song).toLowerCase() !== activeDirector.toLowerCase()) {
                continue;
            }
        }

        result.push(i);
    }

    return result;
}

// ============================================================
// GET NEXT AUTOMATIC SONG (Variant Random Manner, Strictly No Daily Repeats)
// ============================================================

function getNextAutomaticSongIndex() {
    const automaticIndexes = getAutomaticSongIndexes();

    if (automaticIndexes.length === 0) {
        console.log("No songs available for this selection.");
        return -1;
    }

    const history = getTodayPlayedSongs();

    // Filter strictly to songs that have NOT played today
    let available = automaticIndexes.filter(function(index) {
        const id = getSongHistoryId(songs[index]);
        return !history.includes(id);
    });

    // If every song in this selection has played today, stop playback until tomorrow
    if (available.length === 0) {
        console.log("All songs in this selection have already played today. No repeats allowed.");
        return -1;
    }

    // VARIANT MANNER SELECTION:
    // 1. Filter out the current song
    let candidates = available;
    if (available.length > 1) {
        const withoutCurrent = available.filter(index => index !== currentIndex);
        if (withoutCurrent.length > 0) {
            candidates = withoutCurrent;
        }
    }

    // 2. If possible, vary the music director from the previous track
    if (candidates.length > 1 && currentIndex !== -1 && songs[currentIndex]) {
        const currentDirector = getSongDirector(songs[currentIndex]).toLowerCase();
        const differentDirectorCandidates = candidates.filter(index => {
            return getSongDirector(songs[index]).toLowerCase() !== currentDirector;
        });

        // Use different director candidates if available to maximize musical variance
        if (differentDirectorCandidates.length > 0) {
            candidates = differentDirectorCandidates;
        }
    }

    // 3. Cryptographically strong / variant shuffle pick
    const randomArray = new Uint32Array(1);
    window.crypto.getRandomValues(randomArray);
    const chosenIndex = candidates[randomArray[0] % candidates.length];

    return chosenIndex;
}

// ============================================================
// FORMAT TIME
// ============================================================

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return minutes + ":" + String(remaining).padStart(2, "0");
}

// ============================================================
// WAIT FOR AUDIO TO BE READY
// ============================================================

function waitForAudioReady() {
    return new Promise(function(resolve, reject) {
        if (audio.readyState >= 2) {
            resolve();
            return;
        }

        let finished = false;
        const timeout = setTimeout(function() {
            if (finished) return;
            finished = true;
            cleanup();
            reject(new Error("Audio loading timeout"));
        }, 8000);

        function cleanup() {
            clearTimeout(timeout);
            audio.removeEventListener("canplay", onReady);
            audio.removeEventListener("loadeddata", onReady);
            audio.removeEventListener("error", onError);
        }

        function onReady() {
            if (finished) return;
            finished = true;
            cleanup();
            resolve();
        }

        function onError() {
            if (finished) return;
            finished = true;
            cleanup();
            reject(new Error("Audio loading error"));
        }

        audio.addEventListener("canplay", onReady, { once: true });
        audio.addEventListener("loadeddata", onReady, { once: true });
        audio.addEventListener("error", onError, { once: true });
    });
}

// ============================================================
// UPDATE MEDIA SESSION (AirPods / Lock Screen)
// ============================================================

function updateMediaSession(song) {
    if (!("mediaSession" in navigator)) return;

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || song.name || "Unknown Song",
            artist: getSongDirector(song),
            album: "Rishi Music"
        });

        updateMediaPositionState();
    } catch (error) {
        console.log("Media Session error:", error);
    }
}

function updateMediaPositionState() {
    if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
            navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate,
                position: audio.currentTime
            });
        } catch (e) {}
    }
}

// ============================================================
// PLAY SONG
// ============================================================

async function playSongAtIndex(index, automatic = false) {
    if (index < 0 || index >= songs.length) return false;

    const song = songs[index];
    if (!song) return false;

    currentIndex = index;
    audioErrorRetries = 0;

    const oldObjectUrl = currentObjectUrl;
    currentObjectUrl = null;

    let source = null;

    if (song.blob) {
        try {
            currentObjectUrl = URL.createObjectURL(song.blob);
            source = currentObjectUrl;
        } catch (error) {
            console.error("Could not create audio URL:", error);
            return false;
        }
    } else if (song.url) {
        source = song.url;
    } else {
        console.error("No audio source:", song);
        return false;
    }

    try {
        audio.pause();
    } catch (e) {}

    audio.src = source;
    audio.currentTime = 0;
    audio.load();

    // Revoke old object URL asynchronously to avoid cutting off browser decoder streams
    if (oldObjectUrl && oldObjectUrl !== currentObjectUrl) {
        setTimeout(function() {
            try {
                URL.revokeObjectURL(oldObjectUrl);
            } catch (err) {}
        }, 1200);
    }

    // UI text
    const titleElement = document.getElementById("playerTitle");
    const artistElement = document.getElementById("playerArtist");
    if (titleElement) titleElement.textContent = song.title || song.name || "Unknown Song";
    if (artistElement) artistElement.textContent = getSongDirector(song);

    // Record to history if played automatically
    if (automatic) {
        markSongAutomaticallyPlayed(song);
    }

    updateMediaSession(song);

    try {
        await waitForAudioReady();
    } catch (error) {
        console.error("Audio could not become ready:", error);
        return false;
    }

    try {
        await audio.play();
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
        }
        updatePlayButton();
        renderSongList();
        return true;
    } catch (error) {
        console.error("Could not play:", song.title, error);
        updatePlayButton();
        return false;
    }
}

// ============================================================
// PLAY NEXT AUTOMATIC SONG
// ============================================================

async function playNextAutomaticSong() {
    if (isAutoAdvancing) return;

    if (nextSongTimer) {
        clearTimeout(nextSongTimer);
        nextSongTimer = null;
    }

    isAutoAdvancing = true;

    try {
        let attempts = 0;
        const maximumAttempts = Math.max(getAutomaticSongIndexes().length, 1);

        while (attempts < maximumAttempts) {
            attempts++;
            const nextIndex = getNextAutomaticSongIndex();

            if (nextIndex === -1) {
                console.log("No unplayed song remains today. Automatic playback stopped.");
                audio.pause();
                updatePlayButton();
                return;
            }

            console.log("Next automatic song (variant):", songs[nextIndex].title, "| Director:", getSongDirector(songs[nextIndex]));
            const played = await playSongAtIndex(nextIndex, true);
            if (played) return;

            console.log("Track failed. Attempting next candidate...");
        }

        console.log("Could not find a playable song.");
    } finally {
        isAutoAdvancing = false;
    }
}

// ============================================================
// PLAY / PAUSE
// ============================================================

function togglePlay() {
    if (!audio.src || currentIndex === -1) {
        playNextAutomaticSong();
        return;
    }

    if (audio.paused) {
        audio.play()
            .then(function() {
                if ("mediaSession" in navigator) {
                    navigator.mediaSession.playbackState = "playing";
                }
                updatePlayButton();
            })
            .catch(async function(error) {
                console.error("Play error:", error);
                await playNextAutomaticSong();
            });
    } else {
        audio.pause();
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
        }
        updatePlayButton();
    }
}

// ============================================================
// NEXT & PREVIOUS BUTTONS
// ============================================================

function nextSong() {
    playNextAutomaticSong();
}

function prevSong() {
    const filteredIndexes = getFilteredSongIndexes();
    if (filteredIndexes.length === 0) return;

    const position = filteredIndexes.indexOf(currentIndex);
    let previousIndex;

    if (position <= 0) {
        previousIndex = filteredIndexes[filteredIndexes.length - 1];
    } else {
        previousIndex = filteredIndexes[position - 1];
    }

    playSongAtIndex(previousIndex, false);
}

// ============================================================
// PLAY BUTTON UI
// ============================================================

function updatePlayButton() {
    const playButton = document.getElementById("playBtn");
    if (!playButton) return;
    playButton.textContent = audio.paused ? "▶" : "❚❚";
}

// ============================================================
// AUDIO EVENTS
// ============================================================

audio.addEventListener("play", function() {
    audioErrorRetries = 0;
    if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
    }
    updatePlayButton();
});

audio.addEventListener("pause", function() {
    if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
    }
    updatePlayButton();
});

audio.addEventListener("canplay", function() {
    audioErrorRetries = 0;
});

// VERY IMPORTANT: Automatic next track when finished
audio.addEventListener("ended", function() {
    console.log("Track completed. Switching to next unplayed track...");
    clearTimeout(nextSongTimer);
    nextSongTimer = setTimeout(function() {
        nextSongTimer = null;
        playNextAutomaticSong();
    }, 100);
});

audio.addEventListener("error", function() {
    console.error("Audio error occurred.");
    audioErrorRetries++;

    if (audioErrorRetries > MAX_AUDIO_ERROR_RETRIES) {
        audioErrorRetries = 0;
        if (!isAutoAdvancing) {
            playNextAutomaticSong();
        }
        return;
    }

    if (!isAutoAdvancing) {
        playNextAutomaticSong();
    }
});

audio.addEventListener("loadedmetadata", function() {
    const totalTime = document.getElementById("totalTime");
    if (totalTime) {
        totalTime.textContent = formatTime(audio.duration);
    }
    updateMediaPositionState();
});

audio.addEventListener("timeupdate", function() {
    const progressBar = document.getElementById("progressBar");
    const currentTime = document.getElementById("currentTime");

    if (currentTime) {
        currentTime.textContent = formatTime(audio.currentTime);
    }

    if (progressBar && Number.isFinite(audio.duration) && audio.duration > 0) {
        progressBar.value = (audio.currentTime / audio.duration) * 100;
    }
});

// ============================================================
// PROGRESS SEEK
// ============================================================

const progressBar = document.getElementById("progressBar");

if (progressBar) {
    progressBar.addEventListener("input", function() {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = (progressBar.value / 100) * audio.duration;
            updateMediaPositionState();
        }
    });
}

// ============================================================
// DIRECTORS
// ============================================================

function getDirectors() {
    const directors = new Set();
    songs.forEach(function(song) {
        const director = getSongDirector(song);
        if (director && director !== "Unknown Director") {
            directors.add(director);
        }
    });

    return Array.from(directors).sort(function(a, b) {
        return a.localeCompare(b);
    });
}

// ============================================================
// UPDATE DIRECTOR FILTER
// ============================================================

function updateDirectorFilter() {
    const filter = document.getElementById("directorFilter");
    if (!filter) return;

    const oldValue = activeDirector;
    filter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All";
    filter.appendChild(allOption);

    getDirectors().forEach(function(director) {
        const option = document.createElement("option");
        option.value = director;
        option.textContent = director;
        filter.appendChild(option);
    });

    const exists = Array.from(filter.options).some(function(option) {
        return option.value === oldValue;
    });

    if (exists) {
        filter.value = oldValue;
    } else {
        filter.value = "all";
        activeDirector = "all";
    }
}

// ============================================================
// RENDER SONG LIST
// ============================================================

function renderSongList() {
    const container = document.getElementById("songListContainer");
    if (!container) return;

    const filteredIndexes = getFilteredSongIndexes();
    container.innerHTML = "";

    if (filteredIndexes.length === 0) {
        const empty = document.createElement("div");
        empty.style.padding = "30px";
        empty.style.color = "#777";
        empty.textContent = "No songs found.";
        container.appendChild(empty);
        return;
    }

    filteredIndexes.forEach(function(index) {
        const song = songs[index];
        const card = document.createElement("div");
        card.className = "song-card";

        if (index === currentIndex) {
            card.classList.add("active");
        }

        const info = document.createElement("div");
        info.className = "song-info";

        const icon = document.createElement("span");
        icon.className = "song-icon";
        icon.textContent = "♫";

        const meta = document.createElement("div");
        meta.className = "song-meta";

        const title = document.createElement("h4");
        title.textContent = song.title || song.name || "Unknown Song";

        const director = document.createElement("p");
        director.textContent = getSongDirector(song);

        meta.appendChild(title);
        meta.appendChild(director);
        info.appendChild(icon);
        info.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "song-actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", function(event) {
            event.stopPropagation();
            editSong(index);
        });

        const playMini = document.createElement("button");
        playMini.type = "button";
        playMini.className = "play-mini";
        playMini.textContent = "▶";
        playMini.addEventListener("click", function(event) {
            event.stopPropagation();
            playSongAtIndex(index, false);
        });

        actions.appendChild(editButton);
        actions.appendChild(playMini);

        card.appendChild(info);
        card.appendChild(actions);

        card.addEventListener("click", function() {
            playSongAtIndex(index, false);
        });

        container.appendChild(card);
    });
}

// ============================================================
// EDIT SONG
// ============================================================

async function editSong(index) {
    const song = songs[index];
    if (!song) return;

    const newTitle = prompt("Enter song name:", song.title || song.name || "");
    if (newTitle === null) return;
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) {
        alert("Song name cannot be empty.");
        return;
    }

    const newDirector = prompt("Enter music director name:", getSongDirector(song));
    if (newDirector === null) return;
    const cleanDirector = newDirector.trim();
    if (!cleanDirector) {
        alert("Music director cannot be empty.");
        return;
    }

    song.title = cleanTitle;
    song.director = cleanDirector;
    song.artist = cleanDirector;

    if (song.id !== undefined && song.id !== null) {
        try {
            await updateTrackInDB(song);
        } catch (error) {
            console.error("Update error:", error);
        }
    }

    updateDirectorFilter();
    renderSongList();

    if (currentIndex === index) {
        const titleElement = document.getElementById("playerTitle");
        const artistElement = document.getElementById("playerArtist");
        if (titleElement) titleElement.textContent = song.title;
        if (artistElement) artistElement.textContent = song.director;
        updateMediaSession(song);
    }
}

// ============================================================
// IMPORT TRACK
// ============================================================

const audioFileInput = document.getElementById("audioFileInput");

if (audioFileInput) {
    audioFileInput.addEventListener("change", async function(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        for (const file of files) {
            const defaultName = file.name.replace(/\.[^/.]+$/, "");
            const songName = prompt("Enter song name:", defaultName);
            if (songName === null) continue;

            const cleanSongName = songName.trim();
            if (!cleanSongName) {
                alert("Song name cannot be empty.");
                continue;
            }

            const directorName = prompt("Enter music director name:", "");
            if (directorName === null) continue;

            const cleanDirector = directorName.trim();
            if (!cleanDirector) {
                alert("Music director cannot be empty.");
                continue;
            }

            const track = {
                title: cleanSongName,
                name: file.name,
                artist: cleanDirector,
                director: cleanDirector,
                blob: file,
                type: file.type,
                createdAt: Date.now()
            };

            try {
                const id = await saveTrackToDB(track);
                track.id = id;
                songs.push(track);
            } catch (error) {
                console.error("Import error:", error);
                alert("Could not save " + cleanSongName);
            }
        }

        updateDirectorFilter();
        renderSongList();
        audioFileInput.value = "";
    });
}

// ============================================================
// SEARCH & FILTERS
// ============================================================

const searchInput = document.getElementById("searchInput");
if (searchInput) {
    searchInput.addEventListener("input", function() {
        searchQuery = searchInput.value;
        renderSongList();
    });
}

const directorFilter = document.getElementById("directorFilter");
if (directorFilter) {
    directorFilter.addEventListener("change", function() {
        activeDirector = directorFilter.value;
        if (activeDirector.toLowerCase() === "all") {
            activeDirector = "all";
        }

        const viewTitle = document.getElementById("viewTitle");
        if (viewTitle) {
            viewTitle.textContent = activeDirector === "all" ? "All Songs" : activeDirector + " Songs";
        }

        renderSongList();
        console.log("Automatic playlist changed to:", activeDirector);
    });
}

// ============================================================
// PLAYER CONTROLS
// ============================================================

const playBtn = document.getElementById("playBtn");
const nextBtn = document.getElementById("nextBtn");
const prevBtn = document.getElementById("prevBtn");

if (playBtn) playBtn.addEventListener("click", togglePlay);
if (nextBtn) nextBtn.addEventListener("click", nextSong);
if (prevBtn) prevBtn.addEventListener("click", prevSong);

// ============================================================
// MEDIA SESSION (AIRPODS / HEADSET HARDWARE CONTROLS)
// ============================================================

if ("mediaSession" in navigator) {
    try {
        // Single squeeze: Play
        navigator.mediaSession.setActionHandler("play", function() {
            togglePlay();
        });

        // Single squeeze: Pause
        navigator.mediaSession.setActionHandler("pause", function() {
            togglePlay();
        });

        // Double squeeze: Next Track
        navigator.mediaSession.setActionHandler("nexttrack", function() {
            nextSong();
        });

        // Triple squeeze: Previous Track
        navigator.mediaSession.setActionHandler("previoustrack", function() {
            prevSong();
        });

        // Seek forward / backward controls
        navigator.mediaSession.setActionHandler("seekforward", function(details) {
            const skipTime = details.seekOffset || 10;
            audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
            updateMediaPositionState();
        });

        navigator.mediaSession.setActionHandler("seekbackward", function(details) {
            const skipTime = details.seekOffset || 10;
            audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
            updateMediaPositionState();
        });

        // Scrubbing on lock screen / watch
        navigator.mediaSession.setActionHandler("seekto", function(details) {
            if (details.seekTime !== undefined && Number.isFinite(details.seekTime)) {
                audio.currentTime = details.seekTime;
                updateMediaPositionState();
            }
        });

        navigator.mediaSession.setActionHandler("stop", function() {
            audio.pause();
            audio.currentTime = 0;
            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "none";
            }
            updatePlayButton();
        });
    } catch (error) {
        console.log("Media Session handler registration error:", error);
    }
}

// ============================================================
// SERVICE WORKER
// ============================================================

if ("serviceWorker" in navigator) {
    window.addEventListener("load", function() {
        navigator.serviceWorker
            .register("./sw.js")
            .then(function(registration) {
                console.log("Service Worker registered:", registration.scope);
            })
            .catch(function(error) {
                console.error("Service Worker error:", error);
            });
    });
}

// ============================================================
// INITIALIZE
// ============================================================

document.addEventListener("DOMContentLoaded", async function() {
    try {
        await openDatabase();
        cleanOldPlayHistory();
        songs = await loadAllTracksFromDB();

        // Initial variant display shuffle
        songs.sort(function() {
            return Math.random() - 0.5;
        });

        updateDirectorFilter();
        renderSongList();
        updatePlayButton();

        console.log("Rishi Music loaded:", songs.length, "songs");
    } catch (error) {
        console.error("Rishi Music initialization failed:", error);
    }
});
