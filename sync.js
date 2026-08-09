// --- Google Sheets sync setup ---
// 1. Create a Google Cloud project (console.cloud.google.com) and enable the "Google Sheets API".
// 2. Configure the OAuth consent screen (External, Testing mode is fine for personal use)
//    and add your own Google account as a test user.
// 3. Create an OAuth 2.0 Client ID of type "Web application". Add both
//    http://localhost:8934 (or whatever you test with) and your real GitHub Pages
//    URL to "Authorized JavaScript origins".
// 4. Create a blank Google Sheet, open it, and copy the ID from its URL:
//    https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
// 5. Paste both values below.
const SYNC_CONFIG = {
  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  SPREADSHEET_ID: "YOUR_SPREADSHEET_ID",
};

const SYNC_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SYNC_SHEET_NAME = "HitListData";

let syncAccessToken = null;
let syncTokenClient = null;

function syncIsConfigured() {
  return (
    !SYNC_CONFIG.GOOGLE_CLIENT_ID.startsWith("YOUR_") &&
    !SYNC_CONFIG.SPREADSHEET_ID.startsWith("YOUR_")
  );
}

function showSyncStatus(text, isError) {
  const el = document.getElementById("sync-status");
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle("sync-status-error", !!isError);
  clearTimeout(showSyncStatus._timer);
  showSyncStatus._timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

function getSyncTokenClient() {
  if (syncTokenClient) return syncTokenClient;
  if (typeof google === "undefined" || !google.accounts) return null;
  syncTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: SYNC_CONFIG.GOOGLE_CLIENT_ID,
    scope: SYNC_SCOPE,
    callback: () => {}, // overridden per-request below
  });
  return syncTokenClient;
}

function requestSyncToken() {
  return new Promise((resolve, reject) => {
    const client = getSyncTokenClient();
    if (!client) {
      reject(new Error("Google sign-in isn't available (offline or blocked script)."));
      return;
    }
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      syncAccessToken = resp.access_token;
      resolve(syncAccessToken);
    };
    client.requestAccessToken({ prompt: syncAccessToken ? "" : "consent" });
  });
}

async function sheetsApi(path, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SYNC_CONFIG.SPREADSHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${syncAccessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function ensureSyncSheetExists() {
  const meta = await sheetsApi("?fields=sheets.properties.title");
  const exists = meta.sheets.some((s) => s.properties.title === SYNC_SHEET_NAME);
  if (!exists) {
    await sheetsApi(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: SYNC_SHEET_NAME } } }],
      }),
    });
  }
}

async function fetchRemoteUpdatedAt() {
  const data = await sheetsApi(`/values/${encodeURIComponent(SYNC_SHEET_NAME + "!B3")}`);
  const raw = data.values && data.values[0] && data.values[0][0];
  return raw ? Number(raw) : 0;
}

async function pullFromSheet() {
  const data = await sheetsApi(`/values/${encodeURIComponent(SYNC_SHEET_NAME + "!A1:B3")}`);
  const rows = data.values || [];
  const row = (label) => {
    const r = rows.find((r) => r[0] === label);
    return r ? r[1] : null;
  };
  const remoteTasks = JSON.parse(row("tasks") || "[]");
  const remoteProjects = JSON.parse(row("projects") || "[]");
  const remoteUpdatedAt = Number(row("updatedAt") || 0);

  tasks = remoteTasks;
  projects = remoteProjects;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  localStorage.setItem(META_KEY, JSON.stringify({ updatedAt: remoteUpdatedAt }));
  render();
}

async function pushToSheet() {
  const updatedAt = getLocalUpdatedAt() || Date.now();
  await sheetsApi(`/values/${encodeURIComponent(SYNC_SHEET_NAME + "!A1:B3")}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({
      values: [
        ["tasks", JSON.stringify(tasks)],
        ["projects", JSON.stringify(projects)],
        ["updatedAt", String(updatedAt)],
      ],
    }),
  });
}

async function runSync() {
  if (!syncIsConfigured()) {
    showSyncStatus("Sync isn't set up yet — see sync.js for setup steps.", true);
    return;
  }
  showSyncStatus("Signing in…");
  try {
    await requestSyncToken();
    showSyncStatus("Syncing…");
    await ensureSyncSheetExists();

    const remoteUpdatedAt = await fetchRemoteUpdatedAt();
    const localUpdatedAt = getLocalUpdatedAt();

    if (remoteUpdatedAt > localUpdatedAt) {
      await pullFromSheet();
      showSyncStatus("Synced — pulled latest from Sheet ✓");
    } else if (localUpdatedAt > remoteUpdatedAt) {
      await pushToSheet();
      showSyncStatus("Synced — pushed to Sheet ✓");
    } else {
      showSyncStatus("Already up to date ✓");
    }
  } catch (err) {
    console.error(err);
    showSyncStatus(`Sync failed: ${err.message}`, true);
  }
}

document.getElementById("sync-btn").addEventListener("click", runSync);
