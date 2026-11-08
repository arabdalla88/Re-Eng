const STATUS_LABELS = {
  pending: "Pending Inspection",
  inspection: "Physical Inspection & Grading",
  listed: "Listed for Sale/Rent",
  closed: "Sold / Rented Out",
};
const STAGES = ["pending", "inspection", "listed", "closed"];
let csrfToken = "";
let listingTimer;
let allSubmissions = [];
const byId = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

async function initialize() {
  try {
    csrfToken = (await api("/api/csrf")).csrfToken;
  } catch {
    showToast("Couldn't connect to Re-Eng. Please refresh the page.");
  }
  bindNavigation();
  bindSubmissionForm();
  bindMarketplace();
  bindAdmin();
  const initialView = location.hash.slice(1);
  if (["marketplace", "submit", "admin"].includes(initialView)) showView(initialView);
  loadListings();
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showView("marketplace");
      byId("search-input").focus();
    }
    if (event.key === "Escape") document.querySelector(".main-nav").classList.remove("open");
  });
  window.addEventListener("popstate", () => {
    const requestedView = location.hash.slice(1);
    showView(["marketplace", "submit", "admin"].includes(requestedView) ? requestedView : "home", false);
  });
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((control) => {
    control.addEventListener("click", (event) => {
      const target = control.dataset.view;
      if (target === "home" && control.getAttribute("href") === "#how-it-works") {
        event.preventDefault();
        showView("home");
        requestAnimationFrame(() => document.getElementById("how-it-works").scrollIntoView({ behavior: "smooth" }));
      } else if (target === "home" && control.getAttribute("href") === "#about") {
        event.preventDefault();
        showView("home");
        requestAnimationFrame(() => document.getElementById("about").scrollIntoView({ behavior: "smooth" }));
      } else {
        event.preventDefault();
        showView(target);
      }
      document.querySelector(".main-nav").classList.remove("open");
      document.querySelector(".menu-toggle").setAttribute("aria-expanded", "false");
    });
  });
  document.querySelector(".menu-toggle").addEventListener("click", (event) => {
    const nav = document.querySelector(".main-nav");
    const open = nav.classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
}

function showView(name, updateHistory = true) {
  document.querySelectorAll(".view").forEach((view) => {
    const selected = view.id === `view-${name}`;
    view.hidden = !selected;
    view.classList.toggle("active", selected);
  });
  if (updateHistory && location.hash !== `#${name}`) history.pushState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "marketplace") loadListings();
  if (name === "admin") loadAdmin();
}

async function loadListings() {
  const query = new URLSearchParams();
  const category = byId("category-filter")?.value;
  const listingType = byId("type-filter")?.value;
  const search = byId("search-input")?.value.trim();
  if (category) query.set("category", category);
  if (listingType) query.set("type", listingType);
  if (search) query.set("q", search);
  const suffix = query.size ? `?${query}` : "";
  const featured = byId("featured-listings");
  const results = byId("marketplace-listings");
  try {
    const { listings } = await api(`/api/listings${suffix}`);
    renderListings(featured, listings.slice(0, 3));
    if (results) {
      renderListings(results, listings);
      byId("results-count").textContent = `${listings.length} ${listings.length === 1 ? "tool" : "tools"} ready for another round`;
      byId("marketplace-empty").hidden = listings.length > 0;
    }
  } catch {
    featured.innerHTML = '<div class="loading-note">The marketplace is taking a breather. Try refreshing in a moment.</div>';
    if (results) {
      results.innerHTML = "";
      byId("results-count").textContent = "Couldn't load the marketplace.";
    }
  }
}

function renderListings(container, listings) {
  if (!container) return;
  if (!listings.length) {
    container.innerHTML = container.id === "featured-listings"
      ? '<div class="loading-note">New tools are being inspected now. Check back soon.</div>'
      : "";
    return;
  }
  container.innerHTML = listings.map((item, index) => {
    const image = item.photos?.length
      ? `<img class="listing-photo" src="${escapeHtml(item.photos[0])}" alt="${escapeHtml(item.name)}">`
      : `<span class="product-mark ${categoryClass(item.category)}" aria-hidden="true">${categorySymbol(item.category)}</span>`;
    const price = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(item.askingPrice);
    return `<article class="listing-card">
      <div class="listing-image tone-${index % 4}">${image}<span class="condition-pill">GRADE ${escapeHtml(item.grade)}</span></div>
      <div class="listing-detail">
        <div class="listing-category"><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.listingType)}</span></div>
        <h3>${escapeHtml(item.name)}</h3>
        <p class="listing-description">${escapeHtml(item.description)}</p>
        <div class="listing-bottom"><span class="listing-price"><strong>${price}</strong><small>${item.listingType === "Rent" ? "per day · rental" : "one-time · sale"}</small></span><span class="listing-place">${escapeHtml(item.location)}</span></div>
      </div>
    </article>`;
  }).join("");
}

function categoryClass(category) {
  return category === "Mechanical" ? "mechanical" : category === "Architecture" ? "architecture" : "electronics";
}

function categorySymbol(category) {
  return category === "Mechanical" ? "⚙" : category === "Architecture" ? "⌑" : "V";
}

function bindMarketplace() {
  ["search-input", "category-filter", "type-filter"].forEach((id) => {
    byId(id).addEventListener(id === "search-input" ? "input" : "change", () => {
      clearTimeout(listingTimer);
      listingTimer = setTimeout(loadListings, id === "search-input" ? 220 : 0);
    });
  });
  byId("clear-filters").addEventListener("click", () => {
    byId("search-input").value = "";
    byId("category-filter").value = "";
    byId("type-filter").value = "";
    loadListings();
  });
  document.querySelector(".search-box kbd").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
}

function bindSubmissionForm() {
  const form = byId("submission-form");
  const photoInput = form.elements.photos;
  photoInput.addEventListener("change", () => {
    const files = [...photoInput.files];
    const list = byId("file-list");
    if (files.length > 3) {
      photoInput.value = "";
      list.textContent = "Choose up to 3 photos.";
      list.classList.add("error");
      return;
    }
    if (files.some((file) => file.size > 4 * 1024 * 1024)) {
      photoInput.value = "";
      list.textContent = "Each photo must be 4 MB or smaller.";
      list.classList.add("error");
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > 4 * 1024 * 1024) {
      photoInput.value = "";
      list.textContent = "All photos together must total 4 MB or less.";
      list.classList.add("error");
      return;
    }
    list.classList.remove("error");
    list.textContent = files.map((file) => file.name).join(" · ");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = byId("form-message");
    const button = form.querySelector('button[type="submit"]');
    const photos = [...photoInput.files];
    if (
      photos.length > 3
      || photos.some((file) => file.size > 4 * 1024 * 1024)
      || photos.reduce((total, file) => total + file.size, 0) > 4 * 1024 * 1024
    ) {
      message.textContent = "Please choose up to 3 photos, 4 MB total.";
      message.classList.add("error");
      return;
    }
    button.disabled = true;
    button.textContent = "Sending for review…";
    message.textContent = "";
    message.classList.remove("error");
    try {
      const result = await api("/api/submissions", { method: "POST", body: new FormData(form) });
      form.reset();
      byId("file-list").textContent = "";
      message.textContent = `You're all set! Your tool is now Pending Inspection. Our team will be in touch. Reference #${result.id}.`;
      showToast("Submission received — thanks for giving good gear another life.");
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    } finally {
      button.disabled = false;
      button.innerHTML = 'Send for review <span>↗</span>';
    }
  });
}

function bindAdmin() {
  byId("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("login-message");
    message.classList.remove("error");
    message.textContent = "";
    try {
      const result = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.elements.password.value }),
      });
      csrfToken = result.csrfToken;
      form.reset();
      setAdminState(true);
      await loadAdmin();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  });
  byId("admin-logout").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
      setAdminState(false);
    } catch (error) {
      showToast(error.message);
    }
  });
  byId("admin-status-filter").addEventListener("change", renderAdminSubmissions);
  byId("admin-submissions").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-id]");
    if (!button) return;
    const id = button.dataset.saveId;
    const card = button.closest(".submission-card");
    const payload = { status: card.querySelector("[name=status]").value };
    const grade = card.querySelector("[name=grade]").value;
    const listingType = card.querySelector("[name=listing_type]").value;
    const price = card.querySelector("[name=asking_price]").value;
    if (grade) payload.grade = grade;
    if (listingType) payload.listing_type = listingType;
    if (price) payload.asking_price = Number(price);
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await api(`/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showToast("Submission updated.");
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = "Save changes";
    }
  });
}

async function loadAdmin() {
  try {
    const sessionState = await api("/api/admin/session");
    setAdminState(sessionState.authenticated);
    if (!sessionState.authenticated) return;
    const data = await api("/api/admin/submissions");
    allSubmissions = data.submissions;
    renderAdminStats(data.counts);
    renderAdminSubmissions();
    byId("admin-error").textContent = "";
  } catch (error) {
    byId("admin-error").textContent = error.message;
  }
}

function setAdminState(authenticated) {
  byId("admin-login-card").hidden = authenticated;
  byId("admin-dashboard").hidden = !authenticated;
  byId("admin-logout").hidden = !authenticated;
}

function renderAdminStats(counts) {
  byId("dashboard-stats").innerHTML = STAGES.map((status) =>
    `<div class="stat-card ${status === "pending" ? "active" : ""}"><span>${STATUS_LABELS[status]}</span><strong>${counts[status] || 0}</strong></div>`
  ).join("");
}

function renderAdminSubmissions() {
  const selected = byId("admin-status-filter").value;
  const submissions = allSubmissions.filter((item) => !selected || item.status === selected);
  const list = byId("admin-submissions");
  byId("admin-empty").hidden = submissions.length > 0;
  list.innerHTML = submissions.map((item) => {
    const thumbnail = item.photos?.length
      ? `<img src="${escapeHtml(item.photos[0])}" alt="">`
      : `<span>${categorySymbol(item.category)}</span>`;
    const statusOptions = STAGES.map((status) => `<option value="${status}" ${status === item.status ? "selected" : ""}>${STATUS_LABELS[status]}</option>`).join("");
    const gradeOptions = ["", "A", "B", "C", "For parts"].map((grade) => `<option value="${grade}" ${grade === (item.grade || "") ? "selected" : ""}>${grade || "Choose grade"}</option>`).join("");
    const typeOptions = ["", "Sale", "Rent"].map((type) => `<option value="${type}" ${type === (item.listingType || "") ? "selected" : ""}>${type || "Choose type"}</option>`).join("");
    return `<article class="submission-card">
      <div class="submission-card-main">
        <div class="submission-thumb">${thumbnail}</div>
        <div><div class="submission-titleline"><h3>${escapeHtml(item.name)}</h3><span class="submission-category">${escapeHtml(item.category)}</span></div>
          <div class="submission-meta"><span>${escapeHtml(item.condition)} condition</span><span>⌖ ${escapeHtml(item.location)}</span><span>${formatDate(item.createdAt)}</span></div>
        </div>
        <span class="submission-status ${item.status}">${STATUS_LABELS[item.status]}</span>
      </div>
      <p class="submission-description">${escapeHtml(item.description)}</p>
      <div class="submission-contact"><span>Contact: ${escapeHtml(item.contactName)}</span><a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>${item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ""}</div>
      <div class="submission-actions">
        <label class="admin-control"><span>Workflow stage</span><select name="status">${statusOptions}</select></label>
        <label class="admin-control"><span>Inspection grade</span><select name="grade">${gradeOptions}</select></label>
        <label class="admin-control"><span>Sale / rent</span><select name="listing_type">${typeOptions}</select></label>
        <label class="admin-control"><span>Price · USD</span><input name="asking_price" type="number" min="0.01" max="1000000" step="0.01" value="${item.askingPrice || ""}" placeholder="0.00"></label>
        <button class="admin-save" data-save-id="${item.id}">Save changes</button>
      </div>
    </article>`;
  }).join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

let toastTimer;
function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3800);
}

initialize();
