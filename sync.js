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
  GOOGLE_CLIENT_ID: "71627427961-b5l2mbbji29td6genoojbc5bh6bhc0mc.apps.googleusercontent.com",
  SPREADSHEET_ID: "1cRHzVgbchkf1yCmD55w_OoWRmcNL4G4pAmlOs4t6XlE",
};

const SYNC_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// One row per record (not one giant JSON blob per cell) — Sheets caps any
// single cell at 50,000 characters, which a JSON dump of the whole task list
// blows past once you've got a few dozen tasks with notes on them.
const TASKS_TAB = "Tasks";
const PROJECTS_TAB = "Projects";
const CLEAR_ROWS = 20000;

const TASK_FIELDS = [
  "id", "title", "category", "projectId", "scheduledDate", "progress",
  "startDate", "multiDay", "done", "completedDate", "followUp", "quickTask",
  "extraMile", "comment", "createdAt", "updatedAt", "deleted",
];
const TASK_LAST_COL = "Q"; // one column per TASK_FIELDS entry, A.. — keep in sync with the list above

const PROJECT_FIELDS = ["id", "name", "archived", "parentId", "color", "lastUsedAt", "updatedAt"];
const PROJECT_LAST_COL = "G"; // one column per PROJECT_FIELDS entry, A.. — keep in sync with the list above

// How long to keep deleted-task tombstones around before pruning them for good.
// Needs to comfortably outlast "longest realistic gap between syncs on a device."
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

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

async function ensureSyncTabsExist() {
  const meta = await sheetsApi("?fields=sheets.properties.title");
  const titles = meta.sheets.map((s) => s.properties.title);
  const missing = [TASKS_TAB, PROJECTS_TAB].filter((t) => !titles.includes(t));
  if (missing.length) {
    await sheetsApi(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    });
  }
}

// --- Row <-> record conversion ---
// Sheets returns UNFORMATTED_VALUE cells as real strings/numbers/booleans
// already, so this is mostly just "fill in blanks safely," not string parsing.
function cell(v) {
  return v === null || v === undefined ? "" : v;
}

function taskToRow(t) {
  return [
    t.id, t.title, t.category, cell(t.projectId), cell(t.scheduledDate), t.progress || 0,
    cell(t.startDate), !!t.multiDay, !!t.done, cell(t.completedDate), !!t.followUp, !!t.quickTask,
    t.extraMile || "", t.comment || "", t.createdAt || "", t.updatedAt || 0, !!t.deleted,
  ];
}

function rowToTask(row) {
  const g = (i) => (row[i] === undefined || row[i] === "" ? null : row[i]);
  return {
    id: row[0],
    title: g(1) || "",
    category: g(2),
    projectId: g(3),
    scheduledDate: g(4),
    progress: Number(row[5]) || 0,
    startDate: g(6),
    multiDay: row[7] === true,
    done: row[8] === true,
    completedDate: g(9),
    followUp: row[10] === true,
    quickTask: row[11] === true,
    extraMile: g(12) || "",
    comment: g(13) || "",
    createdAt: g(14) || "",
    updatedAt: Number(row[15]) || 0,
    deleted: row[16] === true,
  };
}

function projectToRow(p) {
  return [p.id, p.name, !!p.archived, cell(p.parentId), p.color || "", p.lastUsedAt || 0, p.updatedAt || 0];
}

function rowToProject(row) {
  const g = (i) => (row[i] === undefined || row[i] === "" ? null : row[i]);
  return {
    id: row[0],
    name: g(1) || "",
    archived: row[2] === true,
    parentId: g(3),
    color: g(4) || "",
    lastUsedAt: Number(row[5]) || 0,
    updatedAt: Number(row[6]) || 0,
  };
}

async function fetchRemoteData() {
  const [taskData, projectData] = await Promise.all([
    sheetsApi(`/values/${encodeURIComponent(`${TASKS_TAB}!A2:${TASK_LAST_COL}${CLEAR_ROWS}`)}?valueRenderOption=UNFORMATTED_VALUE`),
    sheetsApi(`/values/${encodeURIComponent(`${PROJECTS_TAB}!A2:${PROJECT_LAST_COL}${CLEAR_ROWS}`)}?valueRenderOption=UNFORMATTED_VALUE`),
  ]);
  const taskRows = taskData.values || [];
  const projectRows = projectData.values || [];
  return {
    tasks: taskRows.filter((r) => r[0]).map(rowToTask),
    projects: projectRows.filter((r) => r[0]).map(rowToProject),
  };
}

async function writeRemoteData(mergedTasks, mergedProjects) {
  // Clear first so a shrinking dataset (deletions pruned, etc.) doesn't leave
  // stale trailing rows behind from a previous, larger sync.
  await Promise.all([
    sheetsApi(`/values/${encodeURIComponent(`${TASKS_TAB}!A1:${TASK_LAST_COL}${CLEAR_ROWS}`)}:clear`, { method: "POST" }),
    sheetsApi(`/values/${encodeURIComponent(`${PROJECTS_TAB}!A1:${PROJECT_LAST_COL}${CLEAR_ROWS}`)}:clear`, { method: "POST" }),
  ]);
  await Promise.all([
    sheetsApi(`/values/${encodeURIComponent(`${TASKS_TAB}!A1`)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [TASK_FIELDS, ...mergedTasks.map(taskToRow)] }),
    }),
    sheetsApi(`/values/${encodeURIComponent(`${PROJECTS_TAB}!A1`)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [PROJECT_FIELDS, ...mergedProjects.map(projectToRow)] }),
    }),
  ]);
}

// Per-record last-write-wins merge, keyed by id. A record present on only one
// side is kept as-is (that's how new tasks/projects created on either device
// show up on the other). A record on both sides keeps whichever copy has the
// newer updatedAt — this is also how deletes propagate, since deleting sets
// `deleted: true` and bumps updatedAt rather than removing the record outright.
function mergeById(localList, remoteList) {
  const merged = new Map();
  localList.forEach((item) => merged.set(item.id, item));
  remoteList.forEach((item) => {
    const existing = merged.get(item.id);
    if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
      merged.set(item.id, item);
    }
  });
  return [...merged.values()];
}

function pruneOldTombstones(taskList) {
  const cutoff = Date.now() - TOMBSTONE_RETENTION_MS;
  return taskList.filter((t) => !(t.deleted && (t.updatedAt || 0) < cutoff));
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
    await ensureSyncTabsExist();

    const remote = await fetchRemoteData();

    const mergedTasks = pruneOldTombstones(mergeById(tasks, remote.tasks));
    const mergedProjects = mergeById(projects, remote.projects);

    tasks = mergedTasks;
    projects = mergedProjects;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    bumpLocalUpdatedAt();
    render();

    await writeRemoteData(mergedTasks, mergedProjects);

    showSyncStatus("Synced ✓");
  } catch (err) {
    console.error(err);
    showSyncStatus(`Sync failed: ${err.message}`, true);
  }
}

document.getElementById("sync-btn").addEventListener("click", runSync);
