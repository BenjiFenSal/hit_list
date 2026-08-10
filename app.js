const STORAGE_KEY = "hitlist.tasks.v1";
const PROJECTS_KEY = "hitlist.projects.v1";
const META_KEY = "hitlist.meta.v1";

function bumpLocalUpdatedAt() {
  localStorage.setItem(META_KEY, JSON.stringify({ updatedAt: Date.now() }));
}

function getLocalUpdatedAt() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw).updatedAt : 0;
  } catch (e) {
    return 0;
  }
}

const CATEGORIES = [
  { id: "urgent-important", label: "Urgent & Important", icon: "🔥", tip: "Do these first — time-critical and high value" },
  { id: "important-not-urgent", label: "Important, Not Urgent", icon: "🎯", tip: "Schedule dedicated time — valuable but not time-critical" },
  { id: "urgent-not-important", label: "Urgent, Not Important", icon: "⚡", tip: "Handle quickly or delegate — time pressure, lower value" },
  { id: "neither", label: "Neither", icon: "💤", tip: "Low priority — reconsider if it's worth doing" },
  { id: "backburner", label: "Backburner", icon: "🧊", tip: "Ideas or notes you're logging, not on your active to-do list" },
];

const BOARD_CATEGORIES = CATEGORIES.filter((c) => c.id !== "backburner");
const BACKBURNER = CATEGORIES.find((c) => c.id === "backburner");

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  return dateToStr(new Date());
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to load tasks", e);
    return [];
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  bumpLocalUpdatedAt();
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to load projects", e);
    return [];
  }
}

function saveProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  bumpLocalUpdatedAt();
}

let tasks = loadTasks();
let projects = loadProjects();
let quickAddCategory = "urgent-important";
let quickAddIsQuickTask = false;

// Migrate legacy free-text task.project to projectId so renames stay linked.
tasks.forEach((task) => {
  if (task.project && !task.projectId) {
    const proj = getOrCreateProjectByName(task.project);
    task.projectId = proj.id;
  }
  delete task.project;
  // Migrate records from before per-record merge sync existed.
  if (task.updatedAt === undefined) {
    task.updatedAt = task.createdAt ? Date.parse(task.createdAt) || Date.now() : Date.now();
  }
  if (task.deleted === undefined) task.deleted = false;
});
projects.forEach((project) => {
  if (project.updatedAt === undefined) project.updatedAt = project.lastUsedAt || Date.now();
});
saveTasks(tasks);
saveProjects(projects);

// Active (non-deleted) tasks — deleted tasks are kept as tombstones so sync can
// propagate the deletion to other devices instead of a stale copy reviving it.
function activeTasks() {
  return tasks.filter((t) => !t.deleted);
}

function touchTask(task) {
  task.updatedAt = Date.now();
}

function touchProject(project) {
  project.updatedAt = Date.now();
}

function getOrCreateProjectByName(name) {
  const trimmed = name.trim();
  let project = projects.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (!project) {
    project = { id: crypto.randomUUID(), name: trimmed, archived: false, lastUsedAt: Date.now(), updatedAt: Date.now() };
    projects.push(project);
  } else {
    project.lastUsedAt = Date.now();
    project.archived = false;
    touchProject(project);
  }
  saveProjects(projects);
  return project;
}

function projectById(id) {
  return projects.find((p) => p.id === id) || null;
}

function recentProjects(limit = 5) {
  return projects
    .filter((p) => !p.archived)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit);
}

function daySpan(startDate, refDate) {
  const start = new Date(startDate + "T00:00:00");
  const ref = new Date(refDate + "T00:00:00");
  const diffDays = Math.round((ref - start) / 86400000);
  return diffDays + 1;
}

function isOverdue(task, today) {
  return !task.done && task.scheduledDate < today;
}

function updateTaskProgress(task, value) {
  const wasZero = task.progress === 0;
  task.progress = value;
  const today = todayStr();
  if (wasZero && value > 0 && !task.startDate) {
    task.startDate = today;
  }
  if (task.startDate && today > task.startDate) {
    task.multiDay = true;
  }
  if (value >= 100) {
    task.done = true;
    task.completedDate = today;
  } else {
    task.done = false;
    task.completedDate = null;
  }
  touchTask(task);
}

function addTask({ title, category, scheduledDate, projectId, comment, quickTask }) {
  const task = {
    id: crypto.randomUUID(),
    title,
    category,
    projectId: projectId || null,
    scheduledDate,
    progress: 0,
    startDate: null,
    multiDay: false,
    done: false,
    completedDate: null,
    followUp: false,
    quickTask: !!quickTask,
    extraMile: "",
    comment: comment || "",
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false,
  };
  tasks.push(task);
  saveTasks(tasks);
  render();
}

function deleteTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.deleted = true;
    touchTask(task);
  }
  saveTasks(tasks);
  render();
}

function formatDateBadge(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

function categoryFor(id) {
  return CATEGORIES.find((c) => c.id === id);
}

function buildCategoryPicker(container, selectedId, onSelect) {
  container.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-symbol";
    btn.dataset.category = cat.id;
    btn.dataset.tip = cat.label;
    btn.setAttribute("aria-label", cat.label);
    btn.setAttribute("aria-pressed", String(cat.id === selectedId));
    if (cat.id === selectedId) btn.classList.add("selected");
    btn.textContent = cat.icon;
    btn.addEventListener("click", () => onSelect(cat.id));
    container.appendChild(btn);
  });
}

function renderQuickAddPicker() {
  const container = document.getElementById("qa-category-picker");
  buildCategoryPicker(container, quickAddCategory, (id) => {
    quickAddCategory = id;
    document.getElementById("qa-category").value = id;
    renderQuickAddPicker();
  });
}

function renderQuickAddQuickToggle() {
  const btn = document.getElementById("qa-quick-toggle");
  btn.classList.toggle("selected", quickAddIsQuickTask);
  btn.setAttribute("aria-pressed", String(quickAddIsQuickTask));
}

let quickAddProjectId = null;

function setQuickAddProject(project) {
  quickAddProjectId = project ? project.id : null;
  document.getElementById("qa-project").value = project ? project.name : "";
  renderQaRecentProjects();
}

function resolveQuickAddProject() {
  const input = document.getElementById("qa-project");
  const value = input.value.trim();
  if (!value) {
    quickAddProjectId = null;
    return null;
  }
  const project = getOrCreateProjectByName(value);
  setQuickAddProject(project);
  return project;
}

function renderQaRecentProjects() {
  const container = document.getElementById("qa-recent-projects");
  container.innerHTML = "";
  recentProjects().forEach((p) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "project-chip-btn";
    if (p.id === quickAddProjectId) chip.classList.add("selected");
    chip.textContent = p.name;
    chip.addEventListener("click", () => setQuickAddProject(p));
    container.appendChild(chip);
  });
}

let filters = {
  search: "",
  category: "",
  project: "",
  status: "all",
  followUpOnly: false,
  quickOnly: false,
};

function renderFilterPicker() {
  const container = document.getElementById("filter-category-picker");
  container.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "category-symbol";
  allBtn.textContent = "All";
  allBtn.dataset.tip = "All categories";
  if (!filters.category) allBtn.classList.add("selected");
  allBtn.addEventListener("click", () => {
    filters.category = "";
    renderFilterPicker();
    renderList();
  });
  container.appendChild(allBtn);

  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-symbol";
    btn.dataset.tip = cat.label;
    btn.setAttribute("aria-label", cat.label);
    if (filters.category === cat.id) btn.classList.add("selected");
    btn.textContent = cat.icon;
    btn.addEventListener("click", () => {
      filters.category = filters.category === cat.id ? "" : cat.id;
      renderFilterPicker();
      renderList();
    });
    container.appendChild(btn);
  });
}

function renderProjectFilterSelect() {
  const filterSelect = document.getElementById("filter-project");
  const current = filterSelect.value;
  filterSelect.innerHTML = '<option value="">All projects</option>';
  [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.archived ? `${p.name} (archived)` : p.name;
      filterSelect.appendChild(opt);
    });
  filterSelect.value = current;
}

function renderRecentProjectChips(container, task) {
  container.innerHTML = "";
  recentProjects().forEach((p) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "project-chip-btn";
    chip.textContent = p.name;
    chip.addEventListener("click", () => {
      task.projectId = p.id;
      p.lastUsedAt = Date.now();
      touchTask(task);
      touchProject(p);
      saveProjects(projects);
      saveTasks(tasks);
      render();
    });
    container.appendChild(chip);
  });
}

// Wraps a project text input with a click/search dropdown of existing projects.
// Selecting an option sets the input value and fires a native "change" event,
// so it reuses whatever change handler is already wired on that input.
function attachProjectAutocomplete(input) {
  const wrap = document.createElement("div");
  wrap.className = "project-autocomplete";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const dropdown = document.createElement("div");
  dropdown.className = "project-dropdown";
  dropdown.hidden = true;
  wrap.appendChild(dropdown);

  function renderOptions() {
    const query = input.value.trim().toLowerCase();
    const matches = projects
      .filter((p) => !p.archived)
      .filter((p) => p.name.toLowerCase().includes(query))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, 8);

    dropdown.innerHTML = "";
    if (matches.length === 0) {
      dropdown.hidden = true;
      return;
    }
    matches.forEach((p) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "project-dropdown-item";
      item.textContent = p.name;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus so the click registers before blur hides the dropdown
        input.value = p.name;
        dropdown.hidden = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      dropdown.appendChild(item);
    });
    dropdown.hidden = false;
  }

  input.addEventListener("focus", renderOptions);
  input.addEventListener("input", renderOptions);
  input.addEventListener("blur", () => {
    setTimeout(() => { dropdown.hidden = true; }, 150);
  });
}

function renderOverdueBanner() {
  const banner = document.getElementById("overdue-banner");
  const today = todayStr();
  const count = activeTasks().filter((t) => isOverdue(t, today)).length;
  if (count === 0) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.textContent = `⚠️ ${count} task${count === 1 ? "" : "s"} overdue — tap to view`;
}

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  const template = document.getElementById("task-card-template");
  const today = todayStr();

  const quadrantsWrap = document.createElement("div");
  quadrantsWrap.className = "quadrants-grid";

  BOARD_CATEGORIES.forEach((cat) => {
    quadrantsWrap.appendChild(buildQuadrant(cat, template, today));
  });
  board.appendChild(quadrantsWrap);

  const backburnerSection = buildQuadrant(BACKBURNER, template, today);
  backburnerSection.classList.add("backburner-section");
  board.appendChild(backburnerSection);
}

function buildQuadrant(cat, template, today) {
  const quadrant = document.createElement("section");
  quadrant.className = "quadrant";
  quadrant.dataset.category = cat.id;

  const heading = document.createElement("h2");
  heading.dataset.tip = cat.tip;
  heading.innerHTML = `<span class="cat-icon">${cat.icon}</span>`;
  heading.appendChild(document.createTextNode(cat.label));
  quadrant.appendChild(heading);

  const list = document.createElement("div");
  list.className = "quadrant-tasks";

  const catTasks = activeTasks()
    .filter((t) => t.category === cat.id && !t.done)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

  if (catTasks.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Nothing here";
    list.appendChild(hint);
  }

  catTasks.forEach((task) => {
    list.appendChild(buildTaskCard(task, template, today));
  });

  quadrant.appendChild(list);
  return quadrant;
}

function buildTaskCard(task, template, today) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;

  if (task.scheduledDate > today) {
    node.classList.add("upcoming");
  }
  if (isOverdue(task, today)) {
    node.classList.add("overdue");
  }

  node.querySelector(".date-badge").textContent = formatDateBadge(task.scheduledDate);

  node.querySelector(".overdue-badge").hidden = !isOverdue(task, today);

  const multidayBadge = node.querySelector(".multiday-badge");
  if (task.multiDay && task.startDate) {
    multidayBadge.hidden = false;
    multidayBadge.querySelector(".day-count").textContent = daySpan(task.startDate, today);
  }

  const followupBadge = node.querySelector(".followup-badge");
  followupBadge.hidden = !task.followUp;

  const quickBadge = node.querySelector(".quick-badge");
  quickBadge.hidden = !task.quickTask;

  const flagToggleBtn = node.querySelector(".flag-toggle-btn");
  flagToggleBtn.classList.toggle("flagged", !!task.followUp);
  flagToggleBtn.setAttribute("aria-pressed", String(!!task.followUp));
  flagToggleBtn.addEventListener("click", () => {
    task.followUp = !task.followUp;
    touchTask(task);
    saveTasks(tasks);
    render();
  });

  node.querySelector(".task-title").textContent = task.title;

  const projectChip = node.querySelector(".project-chip");
  const project = task.projectId ? projectById(task.projectId) : null;
  if (project) {
    projectChip.hidden = false;
    projectChip.textContent = project.archived ? `${project.name} (archived)` : project.name;
  }

  const slider = node.querySelector(".progress-slider");
  const valueLabel = node.querySelector(".progress-value");
  slider.value = task.progress;
  valueLabel.textContent = task.progress + "%";

  slider.addEventListener("input", () => {
    valueLabel.textContent = slider.value + "%";
  });
  slider.addEventListener("change", () => {
    updateTaskProgress(task, Number(slider.value));
    saveTasks(tasks);
    render();
  });

  node.querySelector(".expand-btn").addEventListener("click", () => {
    const details = node.querySelector(".task-card-details");
    details.hidden = !details.hidden;
  });

  node.querySelector(".drag-handle").addEventListener("pointerdown", (e) => startDrag(e, task, node));

  const projectInput = node.querySelector(".project-input");
  projectInput.value = project ? project.name : "";
  projectInput.addEventListener("change", () => {
    const value = projectInput.value.trim();
    task.projectId = value ? getOrCreateProjectByName(value).id : null;
    touchTask(task);
    saveTasks(tasks);
    render();
  });
  attachProjectAutocomplete(projectInput);

  renderRecentProjectChips(node.querySelector(".recent-projects"), task);

  const extraMileInput = node.querySelector(".extra-mile-input");
  extraMileInput.value = task.extraMile || "";
  extraMileInput.addEventListener("change", () => {
    task.extraMile = extraMileInput.value;
    touchTask(task);
    saveTasks(tasks);
  });

  const commentInput = node.querySelector(".comment-input");
  commentInput.value = task.comment || "";
  commentInput.addEventListener("change", () => {
    task.comment = commentInput.value;
    touchTask(task);
    saveTasks(tasks);
  });

  const followupCheck = node.querySelector(".followup-check");
  followupCheck.checked = task.followUp;
  followupCheck.addEventListener("change", () => {
    task.followUp = followupCheck.checked;
    touchTask(task);
    saveTasks(tasks);
    render();
  });

  const quickCheck = node.querySelector(".quick-check");
  quickCheck.checked = task.quickTask;
  quickCheck.addEventListener("change", () => {
    task.quickTask = quickCheck.checked;
    touchTask(task);
    saveTasks(tasks);
    render();
  });

  const dateInput = node.querySelector(".date-input");
  dateInput.value = task.scheduledDate;
  dateInput.addEventListener("change", () => {
    task.scheduledDate = dateInput.value;
    touchTask(task);
    saveTasks(tasks);
    render();
  });

  node.querySelector(".mark-done-btn").addEventListener("click", () => {
    updateTaskProgress(task, 100);
    saveTasks(tasks);
    render();
  });

  node.querySelector(".delete-btn").addEventListener("click", () => {
    if (confirm(`Delete "${task.title}"?`)) {
      deleteTask(task.id);
    }
  });

  return node;
}

function renderArchive() {
  const archive = document.getElementById("archive");
  archive.innerHTML = "";

  const done = activeTasks()
    .filter((t) => t.done)
    .sort((a, b) => (b.completedDate || "").localeCompare(a.completedDate || ""));

  const list = document.createElement("div");
  list.className = "archive-list";

  if (done.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "No completed tasks yet";
    list.appendChild(hint);
  }

  done.forEach((task) => {
    const item = document.createElement("div");
    item.className = "archive-item";

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = task.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    const catLabel = categoryFor(task.category)?.label || task.category;
    const project = task.projectId ? projectById(task.projectId) : null;
    const projectPart = project ? ` · ${project.name}` : "";
    meta.textContent = `${catLabel}${projectPart} · Completed ${formatDateBadge(task.completedDate || task.scheduledDate)}${task.multiDay ? " · multi-day" : ""}`;
    info.appendChild(title);
    info.appendChild(meta);

    const restoreBtn = document.createElement("button");
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", () => {
      task.done = false;
      task.progress = 90;
      task.completedDate = null;
      touchTask(task);
      saveTasks(tasks);
      render();
    });

    item.appendChild(info);
    item.appendChild(restoreBtn);
    list.appendChild(item);
  });

  archive.appendChild(list);
}

function taskMatchesFilters(task, today) {
  if (filters.category && task.category !== filters.category) return false;
  if (filters.project && task.projectId !== filters.project) return false;
  if (filters.status === "active" && task.done) return false;
  if (filters.status === "done" && !task.done) return false;
  if (filters.status === "overdue" && !isOverdue(task, today)) return false;
  if (filters.followUpOnly && !task.followUp) return false;
  if (filters.quickOnly && !task.quickTask) return false;
  if (filters.search && !task.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
  return true;
}

function renderList() {
  const tbody = document.getElementById("list-table-body");
  tbody.innerHTML = "";
  const today = todayStr();

  const filtered = activeTasks()
    .filter((t) => taskMatchesFilters(t, today))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "empty-hint";
    td.textContent = "No tasks match these filters";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((task) => {
    const tr = document.createElement("tr");
    if (task.done) tr.classList.add("row-done");

    const titleTd = document.createElement("td");
    titleTd.textContent = task.title;
    tr.appendChild(titleTd);

    const catTd = document.createElement("td");
    const cat = categoryFor(task.category);
    catTd.innerHTML = `<span class="cat-icon">${cat.icon}</span> ${cat.label}`;
    tr.appendChild(catTd);

    const projTd = document.createElement("td");
    const project = task.projectId ? projectById(task.projectId) : null;
    projTd.textContent = project ? project.name : "—";
    tr.appendChild(projTd);

    const progTd = document.createElement("td");
    progTd.textContent = task.done ? "Done" : task.progress + "%";
    tr.appendChild(progTd);

    const dateTd = document.createElement("td");
    dateTd.textContent = formatDateBadge(task.scheduledDate);
    tr.appendChild(dateTd);

    const flagsTd = document.createElement("td");
    const flags = [];
    if (isOverdue(task, today)) flags.push("Overdue");
    if (task.followUp) flags.push("Follow-Up");
    if (task.quickTask) flags.push("Quick");
    if (task.multiDay) flags.push(`Day ${daySpan(task.startDate, today)}`);
    flagsTd.textContent = flags.join(" · ") || "—";
    tr.appendChild(flagsTd);

    tbody.appendChild(tr);
  });
}

function taskCountForProject(projectId) {
  return activeTasks().filter((t) => t.projectId === projectId).length;
}

function renderProjectRow(project, container) {
  const row = document.createElement("div");
  row.className = "project-row";

  const nameWrap = document.createElement("div");
  nameWrap.className = "project-row-name";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = project.name;
  const countSpan = document.createElement("span");
  countSpan.className = "project-row-count";
  countSpan.textContent = `${taskCountForProject(project.id)} task${taskCountForProject(project.id) === 1 ? "" : "s"}`;
  nameWrap.appendChild(nameSpan);
  nameWrap.appendChild(countSpan);

  const actions = document.createElement("div");
  actions.className = "project-row-actions";

  const editBtn = document.createElement("button");
  editBtn.textContent = "Rename";
  editBtn.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = project.name;
    input.className = "project-rename-input";
    nameWrap.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const value = input.value.trim();
      if (value) {
        project.name = value;
        touchProject(project);
        saveProjects(projects);
      }
      render();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = project.name; input.blur(); }
    });
  });

  const archiveBtn = document.createElement("button");
  archiveBtn.textContent = project.archived ? "Restore" : "Archive";
  archiveBtn.addEventListener("click", () => {
    project.archived = !project.archived;
    touchProject(project);
    saveProjects(projects);
    render();
  });

  actions.appendChild(editBtn);
  actions.appendChild(archiveBtn);

  row.appendChild(nameWrap);
  row.appendChild(actions);
  container.appendChild(row);
}

function renderProjectsView() {
  const activeList = document.getElementById("active-projects-list");
  const archivedList = document.getElementById("archived-projects-list");
  activeList.innerHTML = "";
  archivedList.innerHTML = "";

  const active = projects.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
  const archived = projects.filter((p) => p.archived).sort((a, b) => a.name.localeCompare(b.name));

  if (active.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "No active projects yet";
    activeList.appendChild(hint);
  } else {
    active.forEach((p) => renderProjectRow(p, activeList));
  }

  if (archived.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "No archived projects";
    archivedList.appendChild(hint);
  } else {
    archived.forEach((p) => renderProjectRow(p, archivedList));
  }
}

function switchView(view) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("board").hidden = view !== "board";
  document.getElementById("today-view").hidden = view !== "today";
  document.getElementById("yesterday-view").hidden = view !== "yesterday";
  document.getElementById("flagged-view").hidden = view !== "flagged";
  document.getElementById("list-view").hidden = view !== "list";
  document.getElementById("analytics-view").hidden = view !== "analytics";
  document.getElementById("projects-view").hidden = view !== "projects";
  document.getElementById("archive").hidden = view !== "archive";
}

// --- Drag and drop between quadrants (pointer-based so it works with touch too) ---
let dragState = null;

function startDrag(e, task, node) {
  e.preventDefault();
  const rect = node.getBoundingClientRect();
  dragState = {
    task,
    node,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
  };
  node.classList.add("dragging");
  node.style.width = rect.width + "px";
  node.style.left = rect.left + "px";
  node.style.top = rect.top + "px";
  document.body.appendChild(node);
  document.querySelectorAll(".quadrant").forEach((q) => q.classList.add("drop-target"));
}

document.addEventListener("pointermove", (e) => {
  if (!dragState) return;
  dragState.node.style.left = (e.clientX - dragState.offsetX) + "px";
  dragState.node.style.top = (e.clientY - dragState.offsetY) + "px";
  document.querySelectorAll(".quadrant").forEach((q) => q.classList.remove("drop-hover"));
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const quadrant = el && el.closest(".quadrant");
  if (quadrant) quadrant.classList.add("drop-hover");
});

function endDrag(e, commit) {
  if (!dragState) return;
  if (commit) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const quadrant = el && el.closest(".quadrant");
    if (quadrant && quadrant.dataset.category && quadrant.dataset.category !== dragState.task.category) {
      dragState.task.category = quadrant.dataset.category;
      touchTask(dragState.task);
      saveTasks(tasks);
    }
  }
  dragState.node.remove();
  document.querySelectorAll(".quadrant").forEach((q) => q.classList.remove("drop-hover", "drop-target"));
  dragState = null;
  render();
}

document.addEventListener("pointerup", (e) => endDrag(e, true));
document.addEventListener("pointercancel", (e) => endDrag(e, false));

// --- Today's / Yesterday's Hit List ---
function renderDayChecklist(containerId, targetDate, includeOverdueUpTo, emptyMessage) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const today = todayStr();

  const items = activeTasks()
    .filter((t) => {
      const dueForTarget = includeOverdueUpTo ? t.scheduledDate <= targetDate : t.scheduledDate === targetDate;
      return (dueForTarget && !t.done) || t.completedDate === targetDate;
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.scheduledDate.localeCompare(b.scheduledDate);
    });

  if (items.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyMessage;
    container.appendChild(hint);
    return;
  }

  items.forEach((task) => {
    const row = document.createElement("div");
    row.className = "today-row" + (task.done ? " today-row-done" : "");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "today-check";
    check.setAttribute("aria-label", task.done ? "Mark not done" : "Mark done");
    check.textContent = task.done ? "✓" : "";
    check.addEventListener("click", () => {
      if (task.done) {
        task.done = false;
        task.progress = 90;
        task.completedDate = null;
        touchTask(task);
      } else {
        updateTaskProgress(task, 100);
      }
      saveTasks(tasks);
      render();
    });
    row.appendChild(check);

    const cat = categoryFor(task.category);
    const catIcon = document.createElement("span");
    catIcon.className = "cat-icon";
    catIcon.dataset.tip = cat.label;
    catIcon.textContent = cat.icon;
    row.appendChild(catIcon);

    const title = document.createElement("span");
    title.className = "today-title";
    title.textContent = task.title;
    row.appendChild(title);

    const project = task.projectId ? projectById(task.projectId) : null;
    if (project) {
      const chip = document.createElement("span");
      chip.className = "project-chip today-project-chip";
      chip.textContent = project.name;
      row.appendChild(chip);
    }

    if (task.quickTask) {
      const badge = document.createElement("span");
      badge.className = "quick-badge";
      badge.dataset.tip = "Quick task — a fast win";
      badge.textContent = "⏱️ Quick";
      row.appendChild(badge);
    }

    if (!task.done && isOverdue(task, today)) {
      const badge = document.createElement("span");
      badge.className = "overdue-badge";
      badge.dataset.tip = "Past its scheduled date and not yet done";
      badge.textContent = "Overdue";
      row.appendChild(badge);
    }

    container.appendChild(row);
  });
}

function renderTodayView() {
  renderDayChecklist("today-list", todayStr(), true, "Nothing due today. Nice.");
}

function renderYesterdayView() {
  renderDayChecklist("yesterday-list", addDays(todayStr(), -1), false, "Nothing was due yesterday.");
}

function renderFlaggedView() {
  const container = document.getElementById("flagged-list");
  container.innerHTML = "";

  const items = activeTasks()
    .filter((t) => t.followUp)
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  if (items.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Nothing flagged right now.";
    container.appendChild(hint);
    return;
  }

  items.forEach((task) => {
    const row = document.createElement("div");
    row.className = "today-row" + (task.done ? " today-row-done" : "");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "today-check";
    check.setAttribute("aria-label", task.done ? "Mark not done" : "Mark done");
    check.textContent = task.done ? "✓" : "";
    check.addEventListener("click", () => {
      if (task.done) {
        task.done = false;
        task.progress = 90;
        task.completedDate = null;
        touchTask(task);
      } else {
        updateTaskProgress(task, 100);
      }
      saveTasks(tasks);
      render();
    });
    row.appendChild(check);

    const cat = categoryFor(task.category);
    const catIcon = document.createElement("span");
    catIcon.className = "cat-icon";
    catIcon.dataset.tip = cat.label;
    catIcon.textContent = cat.icon;
    row.appendChild(catIcon);

    const title = document.createElement("span");
    title.className = "today-title";
    title.textContent = task.title;
    row.appendChild(title);

    const project = task.projectId ? projectById(task.projectId) : null;
    if (project) {
      const chip = document.createElement("span");
      chip.className = "project-chip today-project-chip";
      chip.textContent = project.name;
      row.appendChild(chip);
    }

    const unflagBtn = document.createElement("button");
    unflagBtn.type = "button";
    unflagBtn.className = "unflag-btn";
    unflagBtn.dataset.tip = "Resolved — clear this flag";
    unflagBtn.textContent = "🚩 Clear";
    unflagBtn.addEventListener("click", () => {
      task.followUp = false;
      touchTask(task);
      saveTasks(tasks);
      render();
    });
    row.appendChild(unflagBtn);

    container.appendChild(row);
  });
}

// --- Analytics ---
const RANGE_OPTIONS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "custom", label: "Custom" },
];

let analyticsRange = { mode: "week", start: null, end: null };

function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return dateToStr(d);
}

function computeRangeBounds() {
  const today = todayStr();
  if (analyticsRange.mode === "day") return { start: today, end: today };
  if (analyticsRange.mode === "week") return { start: addDays(today, -6), end: today };
  if (analyticsRange.mode === "month") return { start: addDays(today, -29), end: today };
  return {
    start: analyticsRange.start || addDays(today, -6),
    end: analyticsRange.end || today,
  };
}

function daysBetween(a, b) {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}

function renderRangePicker() {
  const container = document.getElementById("range-picker");
  container.innerHTML = "";
  RANGE_OPTIONS.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "range-btn";
    btn.textContent = opt.label;
    if (analyticsRange.mode === opt.id) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      analyticsRange.mode = opt.id;
      renderRangePicker();
      renderAnalytics();
    });
    container.appendChild(btn);
  });
  document.getElementById("custom-range-inputs").hidden = analyticsRange.mode !== "custom";
}

function renderAnalytics() {
  const { start, end } = computeRangeBounds();
  const startInput = document.getElementById("range-start");
  const endInput = document.getElementById("range-end");
  if (!startInput.value) startInput.value = analyticsRange.start || start;
  if (!endInput.value) endInput.value = analyticsRange.end || end;

  const completed = activeTasks().filter((t) => t.done && t.completedDate && t.completedDate >= start && t.completedDate <= end);
  const currentlyOverdue = activeTasks().filter((t) => isOverdue(t, todayStr())).length;

  const timesToComplete = completed
    .map((t) => daysBetween(t.startDate || t.createdAt.slice(0, 10), t.completedDate))
    .filter((n) => n >= 0);
  const avgTime = timesToComplete.length
    ? (timesToComplete.reduce((a, b) => a + b, 0) / timesToComplete.length).toFixed(1)
    : "—";

  const followUpCompleted = completed.filter((t) => t.followUp).length;

  const stats = document.getElementById("analytics-stats");
  stats.innerHTML = "";
  [
    { label: "Completed", value: completed.length, tip: "Tasks marked done within the selected range" },
    { label: "Avg. time to complete", value: timesToComplete.length ? `${avgTime}d` : "—", tip: "Average days between a task's Start Date and its completion" },
    { label: "Currently overdue", value: currentlyOverdue, tip: "Open tasks past their scheduled date, as of today (not range-limited)" },
    { label: "Follow-ups completed", value: followUpCompleted, tip: "Completed tasks in range that were flagged Follow-Up" },
  ].forEach((s) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.dataset.tip = s.tip;
    const val = document.createElement("div");
    val.className = "stat-value";
    val.textContent = s.value;
    const label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = s.label;
    card.appendChild(val);
    card.appendChild(label);
    stats.appendChild(card);
  });

  renderTrendChart(completed, start, end);
  renderBreakdown(document.getElementById("breakdown-category"), completed, (t) => {
    const cat = categoryFor(t.category);
    return { key: cat.label, prefix: cat.icon + " " };
  });
  renderBreakdown(document.getElementById("breakdown-project"), completed, (t) => {
    const p = t.projectId ? projectById(t.projectId) : null;
    return { key: p ? p.name : "No project", prefix: "" };
  });
}

function renderTrendChart(completed, start, end) {
  const chart = document.getElementById("trend-chart");
  chart.innerHTML = "";

  const dayCount = daysBetween(start, end) + 1;
  const counts = [];
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(start, i);
    const count = completed.filter((t) => t.completedDate === date).length;
    counts.push({ date, count });
  }
  const max = Math.max(1, ...counts.map((c) => c.count));

  counts.forEach((c) => {
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.dataset.tip = `${formatDateBadge(c.date)}: ${c.count} completed`;
    const fill = document.createElement("div");
    fill.className = "trend-bar-fill";
    fill.style.height = `${(c.count / max) * 100}%`;
    bar.appendChild(fill);
    chart.appendChild(bar);
  });
}

function renderBreakdown(container, completed, groupFn) {
  container.innerHTML = "";
  const counts = new Map();
  const prefixes = new Map();
  completed.forEach((t) => {
    const { key, prefix } = groupFn(t);
    counts.set(key, (counts.get(key) || 0) + 1);
    prefixes.set(key, prefix || "");
  });

  if (counts.size === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "No completed tasks in this range";
    container.appendChild(hint);
    return;
  }

  const max = Math.max(...counts.values());
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, count]) => {
      const row = document.createElement("div");
      row.className = "breakdown-row";

      const label = document.createElement("div");
      label.className = "breakdown-label";
      label.textContent = prefixes.get(key) + key;

      const barWrap = document.createElement("div");
      barWrap.className = "breakdown-bar-wrap";
      const bar = document.createElement("div");
      bar.className = "breakdown-bar";
      bar.style.width = `${(count / max) * 100}%`;
      barWrap.appendChild(bar);

      const countEl = document.createElement("div");
      countEl.className = "breakdown-count";
      countEl.textContent = count;

      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(countEl);
      container.appendChild(row);
    });
}

function render() {
  renderQuickAddPicker();
  renderQuickAddQuickToggle();
  renderProjectFilterSelect();
  renderQaRecentProjects();
  renderBoard();
  renderTodayView();
  renderYesterdayView();
  renderFlaggedView();
  renderArchive();
  renderFilterPicker();
  renderList();
  renderProjectsView();
  renderOverdueBanner();
  renderRangePicker();
  renderAnalytics();
}

document.getElementById("quick-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = document.getElementById("qa-title").value.trim();
  const comment = document.getElementById("qa-description").value.trim();
  const category = quickAddCategory;
  const scheduledDate = document.getElementById("qa-date").value;
  if (!title || !scheduledDate) return;
  const project = resolveQuickAddProject();
  addTask({ title, category, scheduledDate, projectId: project ? project.id : null, comment, quickTask: quickAddIsQuickTask });
  e.target.reset();
  quickAddProjectId = null;
  quickAddIsQuickTask = false;
  document.getElementById("qa-date").value = todayStr();
  renderQaRecentProjects();
  renderQuickAddQuickToggle();
});

document.getElementById("qa-date").value = todayStr();

document.getElementById("qa-quick-toggle").addEventListener("click", () => {
  quickAddIsQuickTask = !quickAddIsQuickTask;
  renderQuickAddQuickToggle();
});

document.getElementById("qa-project").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    resolveQuickAddProject();
  }
});

document.getElementById("qa-project").addEventListener("change", () => {
  resolveQuickAddProject();
});

attachProjectAutocomplete(document.getElementById("qa-project"));

document.getElementById("filter-search").addEventListener("input", (e) => {
  filters.search = e.target.value;
  renderList();
});

document.getElementById("filter-project").addEventListener("change", (e) => {
  filters.project = e.target.value;
  renderList();
});

document.getElementById("filter-status").addEventListener("change", (e) => {
  filters.status = e.target.value;
  renderList();
});

document.getElementById("filter-followup").addEventListener("change", (e) => {
  filters.followUpOnly = e.target.checked;
  renderList();
});

document.getElementById("filter-quick").addEventListener("change", (e) => {
  filters.quickOnly = e.target.checked;
  renderList();
});

document.getElementById("range-start").addEventListener("change", (e) => {
  analyticsRange.start = e.target.value;
  renderAnalytics();
});

document.getElementById("range-end").addEventListener("change", (e) => {
  analyticsRange.end = e.target.value;
  renderAnalytics();
});

document.getElementById("add-project-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("new-project-name");
  const name = input.value.trim();
  if (!name) return;
  getOrCreateProjectByName(name);
  input.value = "";
  render();
});

document.getElementById("overdue-banner").addEventListener("click", () => {
  filters.status = "overdue";
  document.getElementById("filter-status").value = "overdue";
  switchView("list");
  renderList();
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW register failed", e));
  });
}

const THEME_KEY = "hitlist.theme";

function currentTheme() {
  return localStorage.getItem(THEME_KEY) || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById("theme-toggle").textContent = theme === "dark" ? "☀️" : "🌙";
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
});

setTheme(currentTheme());

render();
